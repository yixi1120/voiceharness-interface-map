'use strict';
(() => {
  const REPO = 'yixi1120/voiceharness-interface-map',
    API = 'https://api.github.com/repos/' + REPO,
    WEB = 'https://github.com/' + REPO,
    MARK = '<!-- voiceharness-scenario:v1 -->';
  const $ = (s) => panel.querySelector(s),
    esc = (s) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c],
      );
  const panel = document.createElement('dialog');
  panel.id = 'sharedDialog';
  panel.className = 'publish-dialog';
  document.body.append(panel);
  let timer = null,
    sequence = 0,
    loaded = [],
    nextPage = 1,
    hasMore = false,
    loading = false,
    loadSequence = -1;
  function clean(d) {
    if (!d || d.schema !== 1 || !/^[a-f0-9]{40}$/.test(d.baseCommit))
      throw Error('方案版本无效');
    const out = { schema: 1, baseCommit: d.baseCommit };
    for (const k of ['nodes', 'edges', 'removedNodes', 'removedEdges']) {
      if (!Array.isArray(d[k]) || d[k].length > 2000)
        throw Error('方案格式无效或过大');
      out[k] = k.startsWith('removed')
        ? d[k].map((id) => {
            if (typeof id !== 'string' || !/^[\w.-]{1,120}$/.test(id))
              throw Error('删除项ID无效');
            return id;
          })
        : d[k].map((item) => {
            const keys =
              k === 'nodes'
                ? [
                    'id',
                    'kind',
                    'parent',
                    'module',
                    'label',
                    'summary',
                    'signature',
                    'input',
                    'output',
                    'errors',
                  ]
                : ['id', 'source', 'target', 'type', 'label'];
            const v = {};
            for (const key of keys)
              if (Object.hasOwn(item, key)) {
                if (typeof item[key] !== 'string' || item[key].length > 10000)
                  throw Error('字段格式无效');
                v[key] = item[key];
              }
            if (!/^[\w.-]{1,120}$/.test(v.id)) throw Error('ID无效');
            return v;
          });
    }
    if (new TextEncoder().encode(JSON.stringify(out)).length > 40000)
      throw Error('共享方案超过40 KB，请拆成几个小方案提交。');
    return out;
  }
  function encode(d) {
    return btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(clean(d))), (x) =>
        String.fromCharCode(x),
      ).join(''),
    );
  }
  function bodyFor(d, note) {
    return `${MARK}\n这是接口地图的模拟方案，尚未实现或核验；关闭此记录也不表示代码已合入。\n\n说明：${note}\n\n基线：${d.baseCommit}\n\n请保留下方数据块，地图据此恢复方案。\n\n\`\`\`vh-scenario-v1\n${encode(d)}\n\`\`\`\n`;
  }
  function parseIssue(issue) {
    if (
      issue.pull_request ||
      typeof issue.body !== 'string' ||
      !issue.body.includes(MARK)
    )
      return null;
    if (issue.body.length > 65000) throw Error('方案正文过大');
    const matches = [
      ...issue.body.matchAll(/```vh-scenario-v1\s+([A-Za-z0-9+/=]+)\s+```/g),
    ];
    if (matches.length !== 1) throw Error('方案数据块缺失或重复');
    const match = matches[0];
    if (!match) throw Error('缺少完整方案数据块');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(match[1]), (x) => x.charCodeAt(0)),
    );
    return clean(JSON.parse(raw));
  }
  function show(title, html) {
    sequence++;
    clearTimeout(timer);
    panel.innerHTML = `<div class="lab-heading"><h2>${esc(title)}</h2><button id="sharedClose">关闭</button></div>${html}<p id="sharedStatus" role="status"></p>`;
    $('#sharedClose').onclick = () => panel.close();
    if (!panel.open) panel.showModal();
  }
  function fail(e) {
    const el = $('#sharedStatus');
    if (el) el.textContent = e.message || String(e);
  }
  // Cache only public responses for this repository, never credentials or drafts.
  const CACHE_KEY = 'voiceharness-shared-read-v1:' + REPO,
    FRESH_MS = 60000,
    MAX_AGE_MS = 7 * 86400000,
    pending = new Map();
  let cache = new Map(),
    cooldownUntil = 0;
  function validEndpoint(key) {
    return (
      /^\/issues\/[1-9][0-9]*$/.test(key) ||
      /^\/issues\?state=all&sort=created&direction=desc&per_page=50&page=[1-9][0-9]*$/.test(
        key,
      )
    );
  }
  function validData(key, data) {
    const validIssue = (i) =>
      i &&
      Number.isSafeInteger(i.number) &&
      i.number > 0 &&
      typeof i.title === 'string' &&
      (i.body == null || typeof i.body === 'string');
    return key.includes('?')
      ? Array.isArray(data) && data.length <= 50 && data.every(validIssue)
      : validIssue(data) && data.number === Number(key.split('/').pop());
  }
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw || raw.length > 1500000) return;
      const saved = JSON.parse(raw),
        now = Date.now();
      if (Array.isArray(saved.entries))
        for (const [key, item] of saved.entries.slice(-30)) {
          if (
            validEndpoint(key) &&
            item &&
            Number.isFinite(item.at) &&
            item.at <= now &&
            now - item.at <= MAX_AGE_MS &&
            validData(key, item.data)
          )
            cache.set(key, item);
        }
      if (
        Number.isFinite(saved.cooldownUntil) &&
        saved.cooldownUntil > now &&
        saved.cooldownUntil <= now + 86400000
      )
        cooldownUntil = saved.cooldownUntil;
    } catch {
      /* Storage may be disabled or contain an obsolete cache. */
    }
  }
  function persist() {
    try {
      let entries = [...cache]
        .filter(([, item]) => Date.now() - item.at <= MAX_AGE_MS)
        .slice(-30);
      while (entries.length && JSON.stringify(entries).length > 1400000)
        entries.shift();
      cache = new Map(entries);
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ entries, cooldownUntil }),
      );
    } catch {
      /* Reading still works without persistent storage. */
    }
  }
  readCache();
  function remember(endpoint, data, at = Date.now()) {
    cache.delete(endpoint);
    cache.set(endpoint, { at, data });
    persist();
  }
  function cached(endpoint) {
    const item = cache.get(endpoint);
    return item && Date.now() - item.at <= MAX_AGE_MS ? item : null;
  }
  function cacheResult(item, reason = '') {
    return {
      data: item.data,
      stale: Boolean(reason),
      notice: `${reason ? reason + ' ' : ''}显示本机缓存（${new Date(item.at).toLocaleString()}），可能不是最新版本。可点“刷新方案”检查更新。`,
    };
  }
  function cooldownMessage() {
    return `GitHub 暂时限制访问频率，请在 ${new Date(cooldownUntil).toLocaleTimeString()} 后重试。等待期间可直接打开 GitHub 记录，复制正文后在这里预览。`;
  }
  async function get(endpoint, force = false) {
    if (!validEndpoint(endpoint)) throw Error('方案地址无效');
    const item = cached(endpoint);
    if (item && Date.now() - item.at < (force ? 3000 : FRESH_MS))
      return cacheResult(item);
    if (Date.now() < cooldownUntil) {
      if (item) return cacheResult(item, cooldownMessage());
      throw Error(cooldownMessage());
    }
    if (pending.has(endpoint)) return pending.get(endpoint);
    const request = (async () => {
      try {
        const r = await fetch(API + endpoint, {
          headers: { Accept: 'application/vnd.github+json' },
          credentials: 'omit',
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) {
          let message = '';
          try {
            message = String((await r.json()).message || '');
          } catch {
            /* No JSON body. */
          }
          const limited =
            r.status === 429 ||
            (r.status === 403 &&
              (r.headers.get('x-ratelimit-remaining') === '0' ||
                r.headers.has('retry-after') ||
                /rate limit|secondary limit|abuse detection/i.test(message)));
          if (limited) {
            const retry = Number(r.headers.get('retry-after')),
              reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
            cooldownUntil = Math.max(
              Date.now() + 60000,
              Number.isFinite(retry) && retry > 0
                ? Date.now() + retry * 1000
                : 0,
              r.headers.get('x-ratelimit-remaining') === '0' &&
                Number.isFinite(reset)
                ? reset
                : 0,
            );
            persist();
            throw Error(cooldownMessage());
          }
          const error = Error(
            r.status === 404
              ? '没有找到此方案，可能已删除或无法公开访问，请核对 GitHub 记录。'
              : r.status === 403
                ? 'GitHub 拒绝了本次读取（403），暂未确认是限流。请直接打开 GitHub 记录检查访问情况。'
                : `暂时无法读取 GitHub（${r.status}），请稍后重试。`,
          );
          // A deleted or inaccessible record must not silently reappear from cache.
          if (r.status === 404 || r.status === 401) {
            cache.delete(endpoint);
            for (const key of cache.keys())
              if (key.includes('?')) cache.delete(key);
            persist();
            error.noCache = true;
          }
          throw error;
        }
        const data = await r.json();
        if (!validData(endpoint, data))
          throw Error('GitHub 返回的方案格式不正确，请直接查看原记录。');
        remember(endpoint, data);
        // A list already contains Issue bodies. Opening a card need not refetch it.
        if (Array.isArray(data))
          for (const issue of data) {
            if (!issue.pull_request && issue.body?.includes(MARK))
              remember('/issues/' + issue.number, issue);
          }
        return { data, notice: '' };
      } catch (e) {
        const message =
          e.name === 'TimeoutError'
            ? '读取 GitHub 超时，请稍后重试。'
            : e instanceof TypeError
              ? '无法连接 GitHub，请检查网络后重试。'
              : e.message;
        if (item && !e.noCache) return cacheResult(item, message);
        throw Error(message);
      }
    })();
    pending.set(endpoint, request);
    try {
      return await request;
    } finally {
      pending.delete(endpoint);
    }
  }
  function parsePasted(value) {
    const text = value.trim();
    if (!text || text.length > 65000)
      throw Error('请复制完整方案正文或 vh-scenario-v1 代码块（最多 65 KB）。');
    if (text.includes('```vh-scenario-v1')) {
      const draft = parseIssue({ body: MARK + '\n' + text });
      if (draft) return draft;
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      let data;
      try {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(text.replace(/\s/g, '')), (x) =>
            x.charCodeAt(0),
          ),
        );
        data = JSON.parse(raw);
      } catch {
        throw Error('方案数据无法读取，请复制完整的 vh-scenario-v1 代码块。');
      }
      return clean(data);
    }
    throw Error(
      '请复制完整方案正文，或 GitHub 中 vh-scenario-v1 代码块的内容。',
    );
  }
  function recovery(number) {
    const target = number ? WEB + '/issues/' + number : WEB + '/issues';
    const box = document.createElement('div');
    box.innerHTML = `<p><a href="${target}" target="_blank" rel="noreferrer">直接打开 GitHub 记录 ↗</a> <button id="sharedRetry">重试读取</button></p><details><summary>暂时读不了？粘贴方案正文继续预览</summary><p>在 GitHub 打开对应 Issue，找到 vh-scenario-v1 代码块，点击代码块的复制按钮，再粘贴到下方；也支持完整正文。不会提交或覆盖本机草稿。</p><textarea id="sharedPaste" rows="6" maxlength="65000" aria-label="完整方案正文或方案代码块"></textarea><button id="sharedPastePreview">读取粘贴的方案</button></details>`;
    panel.append(box);
    $('#sharedRetry').onclick = () =>
      number ? open(number, true) : refresh(false, true);
    $('#sharedPastePreview').onclick = () => {
      try {
        const issue = {
          number,
          title: '手动粘贴的方案',
          body: $('#sharedPaste').value,
        };
        const draft = parsePasted(issue.body);
        if (!draft)
          throw Error('请复制完整的接口地图方案正文，包括标记和数据块。');
        displayIssue(
          issue,
          draft,
          '来自手动粘贴，未核验提交账号或最新版本。请对照 GitHub 原记录确认。',
          true,
        );
      } catch (e) {
        fail(e);
      }
    };
  }
  function changes(d) {
    return (
      '<details><summary>查看修改清单</summary><ul>' +
      [
        ...d.nodes.map((n) => '新增/修改节点：' + n.label + ' (' + n.id + ')'),
        ...d.edges.map(
          (e) =>
            '新增/修改关系：' +
            e.source +
            ' → ' +
            e.target +
            ' · ' +
            e.type +
            ' · ' +
            e.label,
        ),
        ...d.removedNodes.map((id) => '拟删除节点：' + id),
        ...d.removedEdges.map((id) => '拟删除关系：' + id),
      ]
        .map((x) => '<li>' + esc(x) + '</li>')
        .join('') +
      '</ul></details>'
    );
  }
  function summary(d) {
    return `${d.nodes.length} 个新增/修改节点 · ${d.edges.length} 条新增/修改连线 · ${d.removedNodes.length} 个删除节点 · ${d.removedEdges.length} 条删除连线`;
  }
  function submit() {
    let d;
    try {
      d = clean(window.mapWorkbench.getDraft());
      window.mapWorkbench.scenario(d);
      if (
        !['nodes', 'edges', 'removedNodes', 'removedEdges'].some(
          (k) => d[k].length,
        )
      )
        throw Error('先在“模拟改图”中保存一些修改，再提交共享方案。');
    } catch (e) {
      show('提交共享方案', '');
      fail(e);
      return;
    }
    show(
      '提交共享方案',
      `<p>提交后，所有人都可在本网站的“共享方案”打开查看。需要用你自己的 GitHub 账号确认提交；不需要提供令牌。</p><p>${esc(summary(d))}</p><label>方案名称<input id="shareTitle" maxlength="100" placeholder="例如：语音打断接口调整"></label><label>修改说明<textarea id="shareNote" maxlength="2000" placeholder="说明改了什么，希望大家确认什么"></textarea></label><p class="hint">只提交模拟修改项，不上传完整地图或业务源码。此展示仓库公开，请勿在说明或接口字段中填写源码正文、密钥或私人数据。</p><label class="publish-check"><input type="checkbox" id="shareAck">我确认这些接口说明可以公开，准备提交给大家查看。</label><button id="sharePrepare" disabled>生成提交内容</button><div id="shareHandoff"></div>`,
    );
    $('#shareAck').onchange = () => {
      $('#sharePrepare').disabled = !$('#shareAck').checked;
      $('#shareHandoff').innerHTML = '';
    };
    for (const field of ['#shareTitle', '#shareNote'])
      $(field).oninput = () => {
        $('#shareHandoff').innerHTML = '';
      };
    $('#sharePrepare').onclick = () => {
      try {
        const title = $('#shareTitle').value.trim(),
          note = $('#shareNote').value.trim();
        if (!title) throw Error('请填写方案名称');
        if (note.includes('```vh-scenario-v1'))
          throw Error('修改说明中不能嵌入方案数据块');
        const body = bodyFor(d, note),
          scan = JSON.stringify(d) + title + note;
        if (
          /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(
            scan,
          )
        )
          throw Error('内容疑似包含密钥，请移除后再提交。');
        const params = new URLSearchParams({
          title: '[模拟方案] ' + title,
          body,
        });
        let link = WEB + '/issues/new?' + params;
        const long = link.length > 6000;
        if (long)
          link =
            WEB +
            '/issues/new?' +
            new URLSearchParams({ title: '[模拟方案] ' + title });
        $('#shareHandoff').innerHTML =
          `<p>${long ? '方案较大，请先复制黄色草稿正文，再粘贴到 GitHub 新 Issue 的描述框。' : '打开 GitHub 后，标题和内容已填好；检查后点击 Create / Submit new issue 完成提交。'}</p><details ${long ? 'open' : ''}><summary>查看将提交到 GitHub Issue 的草稿正文</summary><textarea id="shareBody" readonly rows="7"></textarea></details><button id="copyShareBody" class="rv-pending">提交黄色草稿 · 复制 Issue 正文</button> <a id="openGitHubSubmit" class="share-link" href="${esc(link)}" target="_blank" rel="noreferrer">${long ? '打开 GitHub 新 Issue 并粘贴' : '前往 GitHub 确认提交'} ↗</a><p>打开提交页面还不算同步成功。GitHub 创建记录后，回这里点“查看共享方案”；你和卢同学都能看到。</p><button id="shareAfterSubmit">查看共享方案</button>`;
        $('#shareBody').value = body;
        $('#copyShareBody').onclick = async () => {
          try {
            await navigator.clipboard.writeText(body);
            $('#sharedStatus').textContent =
              '已复制黄色草稿正文，请粘贴到 GitHub Issue 的描述框。';
          } catch {
            $('#shareBody').focus();
            $('#shareBody').select();
            $('#sharedStatus').textContent =
              '请按 Ctrl+C / ⌘C 复制黄色草稿正文，粘贴到 GitHub Issue 的描述框。';
          }
        };
        $('#shareAfterSubmit').onclick = list;
      } catch (e) {
        fail(e);
      }
    };
  }
  function sharedReviewStatus(issue, draft, versions) {
    if (versions.at(-1)?.state === 'withdrawn')
      return { label: '团队约定已撤下' };
    const match = versions.findLast(
      (v) => JSON.stringify(v.draft) === JSON.stringify(draft),
    );
    if (match) {
      const historical = match.version !== versions.at(-1).version;
      return {
        state: 'approved',
        label:
          '紫色 · ' +
          (historical ? '历史约定' : '已约定') +
          ' v' +
          match.version,
      };
    }
    if (issue.state === 'closed') return { label: '已关闭' };
    return { state: 'pending', label: '黄色 · 待审核' };
  }
  function showReviewStatus(element, status) {
    element.className = status.state ? 'rv-badge rv-' + status.state : '';
    element.textContent = status.label;
  }
  function renderList() {
    const container = $('#sharedList');
    if (!container) return;
    container.innerHTML = loaded.length
      ? loaded
          .map(
            (i) =>
              `<article class="shared-card"><strong>${esc(i.title)}</strong><p>#${i.number} · ${esc(i.user?.login || '未知账号')} · <span data-review-status>读取审核状态…</span> · ${esc(i.updated_at?.slice(0, 10))}</p><button data-proposal="${i.number}">查看方案</button> <a href="${WEB}/issues/${i.number}" target="_blank" rel="noreferrer">GitHub 记录 ↗</a></article>`,
          )
          .join('')
      : '<p>已加载的记录中还没有共享方案。模拟改图后，点“提交共享方案”开始。</p>';
    container
      .querySelectorAll('[data-proposal]')
      .forEach((b) => (b.onclick = () => open(Number(b.dataset.proposal))));
    if (window.teamContracts && loaded.length) {
      const listTicket = sequence;
      window.teamContracts
        .catalog()
        .catch(() => ({ latest: new Map(), archived: true }))
        .then(({ latest, archived }) => {
          if (sequence !== listTicket || !panel.open) return;
          for (const issue of loaded) {
            const opener = container.querySelector(
              '[data-proposal="' + issue.number + '"]',
            );
            const badge = opener.parentElement.querySelector(
              '[data-review-status]',
            );
            const apply = (versions) => {
              if (!opener.isConnected || sequence !== listTicket) return;
              const status = sharedReviewStatus(
                issue,
                parseIssue(issue),
                versions,
              );
              showReviewStatus(badge, status);
              if (!versions.length || versions.at(-1).state === 'withdrawn')
                return;
              const approved = document.createElement('button');
              approved.dataset.team = String(issue.number);
              approved.className = 'rv-badge rv-approved';
              approved.textContent = '紫色团队约定 v' + versions.at(-1).version;
              approved.onclick = () => {
                panel.close();
                window.teamContracts.openIssue(issue.number);
              };
              opener.after(approved);
            };
            const versions =
              latest.has(issue.number) || archived
                ? window.teamContracts.history(issue.number)
                : Promise.resolve([]);
            versions.then(apply).catch(() => {
              showReviewStatus(badge, { label: '审核状态暂未核实' });
            });
          }
        });
    }
    $('#sharedMore').hidden = !hasMore;
  }
  async function refresh(append = false, force = false) {
    if (loading && loadSequence === sequence) return;
    loading = true;
    loadSequence = sequence;
    const ticket = sequence;
    clearTimeout(timer);
    $('#sharedStatus').textContent = '正在读取共享方案…';
    try {
      const page = append ? nextPage : 1;
      const result = await get(
        `/issues?state=all&sort=created&direction=desc&per_page=50&page=${page}`,
        force,
      );
      const items = result.data;
      if (ticket !== sequence || !panel.open) return;
      if (!Array.isArray(items)) throw Error('GitHub 返回格式不正确');
      const matches = items.filter(
        (i) =>
          !i.pull_request &&
          i.body?.includes(MARK) &&
          Number.isSafeInteger(i.number),
      );
      loaded = append
        ? [
            ...new Map(
              [...loaded, ...matches].map((i) => [i.number, i]),
            ).values(),
          ]
        : matches;
      nextPage = page + 1;
      hasMore = items.length === 50;
      renderList();
      $('#sharedStatus').textContent =
        `已读取 ${loaded.length} 个方案。${result.notice || '已从 GitHub 获取最新记录。'} 提交不会修改正式图。`;
    } catch (e) {
      if (ticket === sequence) {
        fail(e);
        if (!$('#sharedRetry')) recovery();
      }
    } finally {
      if (loadSequence === ticket) loading = false;
    }
  }
  function list() {
    show(
      '共享方案',
      `<p>这里读取地图仓库里的模拟方案。任何人都可查看，作者以 GitHub 账号为准；查看不会覆盖你的本机草稿。</p><div class="lab-row"><button id="sharedRefresh">刷新方案</button><button id="sharedSubmit">提交我的草稿</button><a href="${WEB}/issues" target="_blank" rel="noreferrer">在 GitHub 查看 ↗</a></div><label>按方案编号打开<input id="proposalNumber" type="number" min="1" placeholder="例如 12"></label><button id="openProposalNumber">打开此方案</button><div id="sharedList"></div><button id="sharedMore" hidden>加载更早记录</button>`,
    );
    loaded = [];
    nextPage = 1;
    hasMore = false;
    $('#sharedRefresh').onclick = () => refresh(false, true);
    $('#sharedSubmit').onclick = submit;
    $('#sharedMore').onclick = () => refresh(true);
    $('#openProposalNumber').onclick = () => {
      const n = Number($('#proposalNumber').value);
      if (Number.isSafeInteger(n) && n > 0) open(n);
      else fail(Error('请输入有效编号'));
    };
    refresh();
  }
  async function open(number, force = false) {
    if (!Number.isSafeInteger(number) || number < 1) return;
    show('读取共享方案', `<p>正在读取 #${number}…</p>`);
    const ticket = sequence;
    try {
      const result = await get('/issues/' + number, force);
      const issue = result.data;
      if (ticket !== sequence || !panel.open) return;
      const d = parseIssue(issue);
      if (!d) throw Error('此记录不是接口地图模拟方案');
      displayIssue(issue, d, result.notice);
    } catch (e) {
      if (ticket === sequence) {
        fail(e);
        recovery(number);
      }
    }
  }
  function displayIssue(issue, d, notice = '', manual = false) {
    const number = issue.number;
    const label = manual ? '手动粘贴的方案' : '#' + number + ' ' + issue.title;
    let incompatible = '';
    try {
      window.mapWorkbench.scenario(d);
    } catch (e) {
      incompatible = e.message;
    }
    show(
      manual ? '手动粘贴的方案' : '共享方案 #' + number,
      `<h3>${esc(issue.title)}</h3><p>${manual ? '手动粘贴，账号未核验' : '提交账号：' + esc(issue.user?.login)} · <span id="sharedReviewStatus">${manual ? '手动预览' : '读取审核状态…'}</span><br>基线：<code>${esc(d.baseCommit)}</code></p><p>${esc(summary(d))}</p>${changes(d)}<p>${incompatible ? '当前图无法套用此方案：' + esc(incompatible) : '可以在图上预览。所有改动仍标为 Proposed，正式图和你原有的草稿不会改变。'}</p><div class="lab-row"><button id="compareShared" ${incompatible ? 'disabled' : ''}>修改前后对比</button><button id="previewShared" ${incompatible ? 'disabled' : ''}>在图上预览</button><button id="adoptShared" ${incompatible ? 'disabled' : ''}>复制到我的草稿继续改</button><button id="downloadShared">下载方案</button><button id="sharedRefresh">刷新方案</button><button id="backShared">返回列表</button></div><p><a href="${WEB}/issues${number ? '/' + number : ''}" target="_blank" rel="noreferrer">查看说明 / 讨论 / 编辑 / 关闭记录 ↗</a></p><button id="copyProposalLink">复制本网站方案链接</button>`,
    );
    let review = null;
    const previewButton = $('#previewShared');
    if (!manual && window.teamContracts) {
      const button = document.createElement('button');
      button.textContent = '查看团队约定';
      $('#compareShared').before(button);
      button.onclick = () => {
        panel.close();
        window.teamContracts.openIssue(number);
      };
      const badge = $('#sharedReviewStatus');
      previewButton.disabled = true;
      window.teamContracts
        .history(number)
        .then((versions) => {
          const status = sharedReviewStatus(issue, d, versions);
          showReviewStatus(badge, status);
          const latest = versions.at(-1);
          if (latest?.state === 'withdrawn') {
            button.textContent = '查看撤下记录';
          } else if (latest) {
            button.textContent = '查看紫色团队约定 v' + latest.version;
            button.className = 'rv-badge rv-approved';
          }
          review = status;
        })
        .catch(() => {
          showReviewStatus(badge, { label: '审核状态暂未核实' });
        })
        .finally(() => {
          previewButton.disabled = Boolean(incompatible);
        });
    }
    if (window.interfaceReview && !incompatible) {
      const button = document.createElement('button');
      button.textContent = '加入本地审核';
      $('#compareShared').before(button);
      button.onclick = () => {
        panel.close();
        window.interfaceReview.start(
          d,
          manual ? '' : issue.user?.login,
          label,
          null,
          manual ? null : number,
        );
      };
    }
    $('#compareShared').onclick = () => {
      panel.close();
      window.ScenarioCompare.open(d, label);
    };
    const detailTicket = sequence;
    previewButton.onclick = () => {
      const status = review;
      if (!panel.open || sequence !== detailTicket) return;
      if (status?.state) {
        window.mapWorkbench.previewSharedChanges(
          d,
          label + ' · ' + status.label,
          status.state,
        );
      } else {
        window.mapWorkbench.previewShared(d, label);
      }
      panel.close();
    };
    $('#adoptShared').onclick = () => {
      if (
        !confirm(
          '这会替换你当前浏览器的模拟草稿。需要保留时，请先导出原草稿。继续？',
        )
      )
        return;
      try {
        window.mapWorkbench.adoptShared(d);
        panel.close();
      } catch (e) {
        fail(e);
      }
    };
    $('#downloadShared').onclick = () => {
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(d, null, 2)], {
            type: 'application/json',
          }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = `voiceharness-proposal-${number}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $('#sharedRefresh').onclick = () => open(number, true);
    $('#backShared').onclick = list;
    $('#copyProposalLink').onclick = async () => {
      const url =
        'https://yixi1120.github.io/voiceharness-interface-map/#proposal=' +
        number;
      try {
        await navigator.clipboard.writeText(url);
        $('#sharedStatus').textContent = '已复制方案链接。';
      } catch {
        $('#sharedStatus').textContent = url;
      }
    };
    if (manual) {
      $('#copyProposalLink').hidden = true;
      $('#sharedRefresh').hidden = true;
    }
    $('#sharedStatus').textContent = notice;
  }
  panel.addEventListener('close', () => {
    sequence++;
    clearTimeout(timer);
  });
  window.addEventListener('map-share-list', list);
  window.addEventListener('map-share-submit', submit);
  // Returning from GitHub must not repeatedly spend the anonymous API quota.
  // Explicit refresh checks for edits; reopening uses the short-lived cache.
  function deepLink() {
    const m = location.hash.match(/^#proposal=([1-9][0-9]{0,8})$/);
    if (m) open(Number(m[1]));
  }
  window.addEventListener('hashchange', deepLink);
  deepLink();
  window.sharedScenarios = {
    clean,
    bodyFor,
    parseIssue,
    async readIssue(number) {
      const { data, stale } = await get('/issues/' + number, true);
      if (stale) throw Error('请在可连接 GitHub 时核对共享方案。');
      return { title: data.title, draft: parseIssue(data) };
    },
  };
})();
