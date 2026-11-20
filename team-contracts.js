'use strict';
(() => {
  const repo = 'yixi1120/voiceharness-interface-map';
  const git = 'https://github.com/' + repo;
  const site = 'https://yixi1120.github.io/voiceharness-interface-map/';
  const api =
    'https://api.github.com/repos/' + repo + '/contents/contracts?ref=main';
  const wb = window.mapWorkbench,
    esc = wb.escapeText,
    shared = window.sharedScenarios;
  const $ = (id) => document.getElementById(id);
  const clean = (d) => shared.clean(d);
  const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
  const file = (issue, version) =>
    'contracts/' + issue + '-v' + version + '.json';
  const positive = (n) => Number.isSafeInteger(n) && n > 0 && n <= 999999999;
  const panel = document.createElement('dialog');
  panel.className = 'publish-dialog';
  panel.id = 'teamContracts';
  document.body.append(panel);
  let generation = 0;
  function screen(title, body) {
    generation++;
    panel.innerHTML =
      '<div class="lab-heading"><h2>' +
      esc(title) +
      '</h2><button id="teamClose">关闭</button></div>' +
      body +
      '<p id="teamStatus" role="status"></p>';
    $('teamClose').onclick = () => panel.close();
    if (!panel.open) panel.showModal();
    return generation;
  }
  function current(token) {
    return token === generation && panel.open;
  }
  function fail(token, e) {
    if (current(token)) $('teamStatus').textContent = e.message;
  }
  async function fetchPublic(url) {
    return fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
  }
  async function record(issue, version) {
    if (!positive(issue) || !positive(version))
      throw Error('方案编号或版本无效');
    // On localhost also read the public registry; private working copies are never uploaded.
    // Pages error pages can omit CORS headers. Local previews use the same
    // repository's raw files so a missing next version is observable as 404.
    const origin =
      location.origin === new URL(site).origin
        ? site
        : 'https://raw.githubusercontent.com/' + repo + '/main/';
    const url = new URL(file(issue, version), origin);
    const r = await fetchPublic(url);
    if (r.status === 404) return null;
    if (!r.ok) throw Error('团队约定暂时无法读取，请刷新重试。');
    const data = await r.json();
    if (
      data.schema !== 1 ||
      data.issue !== issue ||
      data.version !== version ||
      typeof data.title !== 'string' ||
      !data.title.trim() ||
      data.title.length > 300 ||
      data.state !== 'approved'
    )
      throw Error('团队约定的编号或版本未通过校验。');
    return {
      schema: 1,
      issue,
      version,
      title: data.title,
      state: 'approved',
      draft: clean(data.draft),
    };
  }
  async function history(issue) {
    const versions = [];
    for (let n = 1; n <= 1000; n++) {
      const value = await record(issue, n);
      if (!value) return versions;
      versions.push(value);
    }
    throw Error('版本数量超过读取上限。');
  }
  async function catalog() {
    let names,
      archived = false;
    try {
      const r = await fetchPublic(api);
      if (!r.ok) throw Error('目录暂时无法读取。');
      const items = await r.json();
      names = items.filter((f) => f.type === 'file').map((f) => f.name);
    } catch {
      const r = await fetchPublic(site + 'release.json');
      if (!r.ok) throw Error('目录暂时无法读取，可以输入共享方案编号直接查。');
      names = (await r.json()).contractFiles;
      if (!Array.isArray(names))
        throw Error('目录暂时无法读取，可以输入共享方案编号直接查。');
      archived = true;
    }
    const latest = new Map();
    for (const name of names) {
      const m = /^([1-9]\d{0,8})-v([1-9]\d{0,8})\.json$/.exec(name);
      if (m) latest.set(+m[1], Math.max(latest.get(+m[1]) || 0, +m[2]));
    }
    return { latest, archived };
  }
  function directory() {
    const token = screen(
      '团队约定',
      '<p>全组共用的紫色版本。点开可看约定的接口和连线。</p><div id="teamList">正在读取…</div><label>按共享方案编号查看<input id="teamNumber" type="number" min="1"></label><button id="teamFind">查看团队约定</button>',
    );
    $('teamFind').onclick = () => openIssue(Number($('teamNumber').value));
    (async () => {
      const { latest, archived } = await catalog();
      if (!current(token)) return;
      if (archived)
        $('teamStatus').textContent =
          '显示网站发布时的目录。点开可直接查最新已发布版本。';
      $('teamList').textContent = '';
      for (const [issue, version] of [...latest].sort((a, b) => b[0] - a[0])) {
        const button = document.createElement('button');
        button.className = 'rv-badge rv-approved';
        button.textContent = '#' + issue + ' · 紫色 · 已约定 v' + version;
        button.onclick = () => openIssue(issue);
        $('teamList').append(button);
      }
      if (!latest.size) $('teamList').textContent = '暂时没有已发布的约定。';
    })().catch((e) => {
      if (current(token)) $('teamList').textContent = e.message;
    });
  }
  function preview(v) {
    wb.previewSharedChanges(
      v.draft,
      '团队约定 #' + v.issue + ' · 紫色 v' + v.version,
      'approved',
    );
    panel.close();
  }
  async function openIssue(issue) {
    const token = screen(
      '团队约定',
      '#' + esc(issue) + ' · 正在读取已发布的版本…',
    );
    try {
      const versions = await history(issue);
      if (!current(token)) return;
      if (!versions.length) {
        screen('团队约定', '#' + esc(issue) + ' 尚未发布紫色约定。');
        return;
      }
      function show(v) {
        const active = v === versions.at(-1);
        screen(
          '团队约定 #' + issue,
          '<p class="rv-badge rv-approved">' +
            (active ? '当前约定' : '历史约定') +
            ' · 紫色 v' +
            v.version +
            '</p><h3>' +
            esc(v.title) +
            '</h3>' +
            '<p>新增或修改 ' +
            v.draft.nodes.length +
            ' 个节点、' +
            v.draft.edges.length +
            ' 条连线。删除 ' +
            v.draft.removedNodes.length +
            ' 个节点、' +
            v.draft.removedEdges.length +
            ' 条连线。</p>' +
            '<div class="lab-row"><button id="teamGraph">看紫色接口图</button><button id="teamDiff">查看修改前后</button><button id="teamImport">复制约定到本地审核</button></div>' +
            '<label>版本<select id="teamVersion">' +
            versions
              .map(
                (x) =>
                  '<option value="' +
                  x.version +
                  '">v' +
                  x.version +
                  '</option>',
              )
              .join('') +
            '</select></label>' +
            '<p><a href="' +
            git +
            '/issues/' +
            issue +
            '" target="_blank" rel="noreferrer">原始模拟方案 ↗</a> · <a href="' +
            git +
            '/commits/main/' +
            file(issue, v.version) +
            '" target="_blank" rel="noreferrer">发布记录 ↗</a></p>',
        );
        $('teamVersion').value = String(v.version);
        $('teamVersion').onchange = () =>
          show(versions[Number($('teamVersion').value) - 1]);
        $('teamGraph').onclick = () => {
          try {
            preview(v);
          } catch (e) {
            $('teamStatus').textContent = e.message;
          }
        };
        $('teamDiff').onclick = () => {
          try {
            wb.scenario(v.draft);
            panel.close();
            window.ScenarioCompare.open(
              v.draft,
              v.title + ' · 团队约定 v' + v.version,
            );
          } catch (e) {
            $('teamStatus').textContent = e.message;
          }
        };
        $('teamImport').onclick = () => {
          try {
            wb.scenario(v.draft);
            panel.close();
            window.interfaceReview.importContract(v);
          } catch (e) {
            screen('团队约定', esc(e.message));
          }
        };
      }
      show(versions.at(-1));
    } catch (e) {
      fail(token, e);
    }
  }
  function publish(plan, v) {
    // Legacy cards imported from an Issue used "#N title". Verify the complete
    // source draft or a known contract ancestor before accepting that hint.
    const guess =
      plan.issue || Number(/^#([1-9]\d*)\s/.exec(plan.title)?.[1]) || '';
    const token = screen(
      '发布紫色团队约定',
      '<p>选择这份草稿对应的共享方案。网站会核对原始内容和上一版团队约定。</p><label>共享方案编号<input id="teamSource" type="number" min="1" value="' +
        esc(guess) +
        '"></label><button id="teamPrepare">核对并预览</button><div id="teamHandoff"></div>',
    );
    $('teamPrepare').onclick = async () => {
      const issue = Number($('teamSource').value);
      if (!positive(issue)) {
        fail(token, Error('请先提交共享方案，再填写 GitHub 方案编号。'));
        return;
      }
      $('teamPrepare').disabled = true;
      $('teamSource').disabled = true;
      $('teamHandoff').replaceChildren();
      $('teamStatus').textContent = '正在核对…';
      try {
        const [source, versions] = await Promise.all([
          shared.readIssue(issue),
          history(issue),
        ]);
        if (!current(token)) return;
        if (!source.draft) throw Error('这条 Issue 不是模拟方案。');
        const latest = versions.at(-1);
        const ancestor = plan.versions.filter(
          (x) =>
            x.n < v.n && (x.state === 'approved' || x.state === 'verified'),
        );
        if (latest && same(latest.draft, v.draft)) {
          $('teamStatus').textContent = '此版本已对全组可见。';
          showLink(issue);
          return;
        }
        if (
          latest
            ? !ancestor.some((x) => same(x.draft, latest.draft))
            : !same(v.draft, source.draft)
        )
          throw Error(
            latest
              ? '当前本地记录没有基于最新团队约定。请打开团队约定，复制到本地后再修订。'
              : '首次发布须与共享方案里的草稿一致。请先将这一版作为共享方案提交。',
          );
        const payload = {
          schema: 1,
          issue,
          version: versions.length + 1,
          state: 'approved',
          title: source.title,
          draft: clean(v.draft),
        };
        const json = JSON.stringify(payload, null, 2) + '\n';
        if (
          /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|\/Users\/|\/var\/folders\//.test(
            json,
          )
        )
          throw Error('公开内容检查发现疑似私有路径或凭据。请检查接口字段。');
        $('teamHandoff').innerHTML =
          '<p>将公开 #' +
          issue +
          ' 的紫色 v' +
          payload.version +
          '。请核对下面的接口说明，再用有地图仓库写权限的 GitHub 账号提交。</p><textarea id="teamJson" readonly rows="6"></textarea><div class="lab-row"><button id="teamCopy" class="rv-approved">发布紫色约定 · 复制 JSON 文件内容</button><a id="teamGit" target="_blank" rel="noreferrer">到 GitHub 新建此版本 ↗</a></div><p>把 JSON 粘贴到新建的 <code>' +
          file(issue, payload.version) +
          '</code> 文件，点 Commit changes。合入 main 并完成 Pages 部署后，所有人都能看到。若文件已存在，请重新读取团队约定。</p>';
        $('teamJson').value = json;
        $('teamGit').href =
          git +
          '/new/main?' +
          new URLSearchParams({ filename: file(issue, payload.version) });
        $('teamCopy').onclick = async () => {
          try {
            await navigator.clipboard.writeText(json);
            $('teamStatus').textContent =
              '已复制紫色约定 JSON，请粘贴到 GitHub 新建文件的编辑框。';
          } catch {
            $('teamJson').select();
            $('teamStatus').textContent =
              '请按 ⌘C 或 Ctrl+C 复制紫色约定 JSON，粘贴到 GitHub 新建文件的编辑框。';
          }
        };
        $('teamStatus').textContent = '';
        showLink(issue);
      } catch (e) {
        fail(token, e);
      } finally {
        if (current(token)) {
          $('teamPrepare').disabled = false;
          $('teamSource').disabled = false;
        }
      }
    };
    $('teamSource').oninput = () => {
      $('teamHandoff').replaceChildren();
      $('teamStatus').textContent = '';
    };
  }
  function showLink(issue) {
    const a = document.createElement('a');
    a.href = site + '#contract=' + issue;
    a.textContent = '打开团队可见的约定';
    a.target = '_blank';
    a.rel = 'noreferrer';
    $('teamHandoff').append(a);
  }
  const button = document.createElement('button');
  button.textContent = '团队约定';
  button.id = 'labContracts';
  $('labShared').before(button);
  button.onclick = directory;
  function deepLink() {
    const m = /^#contract=([1-9]\d{0,8})$/.exec(location.hash);
    if (m) openIssue(+m[1]);
  }
  window.addEventListener('hashchange', deepLink);
  deepLink();
  window.teamContracts = { openIssue, publish, history, catalog, directory };
})();
