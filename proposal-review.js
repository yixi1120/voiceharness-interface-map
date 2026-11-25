'use strict';
(() => {
  const wb = window.mapWorkbench;
  const base = wb.getBase();
  const esc = wb.escapeText;
  const $ = (id) => document.getElementById(id);
  const key = 'vh-local-review-v1:' + base.meta.referenceCommit;
  const revisionKey = key + ':editing';
  const labels = {
    pending: '黄色 · 待审核',
    approved: '本机已审核',
    verified: '绿色 · 已复测',
  };
  const changeNames = { added: '新增', modified: '修改', removed: '删除' };
  const read = () =>
    JSON.parse(localStorage.getItem(key) || '{"plans":[],"owners":{}}');
  const editing = () =>
    JSON.parse(sessionStorage.getItem(revisionKey) || 'null');
  const current = (plan) =>
    plan.versions.findLast((v) => v.state !== 'pending');
  const moduleName = (n) => n?.label || '未登记模块';
  const value = (id) => $(id).value.trim();
  const list = (items) =>
    items.length
      ? '<ul>' + items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
      : '<p>无</p>';
  function screen(title, html) {
    wb.dialog(title, html + '<p id="rvError" role="status"></p>');
  }
  function fail(error) {
    if ($('rvError')) $('rvError').textContent = error.message;
    else alert(error.message);
  }
  // Check the exact state the reviewer saw inside a cross-tab write lock.
  async function save(snapshot, edit, after) {
    try {
      await navigator.locks.request(key, () => {
        const state = read();
        if (JSON.stringify(state) !== JSON.stringify(snapshot))
          throw Error('另一页已更新审核记录。请重新打开方案，核对后再保存。');
        edit(state);
        localStorage.setItem(key, JSON.stringify(state));
      });
      after();
    } catch (e) {
      fail(e);
    }
  }
  function delta(oldGraph, graph, draft) {
    return window.ScenarioCompare.calculate(oldGraph, graph, draft).rows.filter(
      (r) => r.type !== 'review',
    );
  }
  function analyse(oldGraph, graph, draft) {
    const rows = delta(oldGraph, graph, draft);
    const changes = [],
      links = new Set(),
      modules = new Map();
    const changedNodes = new Set(
      rows.filter((r) => r.group === 'nodes').map((r) => r.id),
    );
    const changedEdges = new Set(
      rows.filter((r) => r.group === 'edges').map((r) => r.id),
    );
    for (const g of [oldGraph, graph]) {
      const nodes = new Map(g.nodes.map((n) => [n.id, n]));
      function include(n) {
        if (n) modules.set(n.module, moduleName(nodes.get(n.module)));
      }
      for (const id of changedNodes) include(nodes.get(id));
      for (const e of g.edges) {
        if (
          !changedNodes.has(e.source) &&
          !changedNodes.has(e.target) &&
          !changedEdges.has(e.id)
        )
          continue;
        const from = nodes.get(e.source),
          to = nodes.get(e.target);
        include(from);
        include(to);
        links.add(
          from.label + ' → ' + to.label + ' · ' + e.type + ' · ' + e.label,
        );
      }
    }
    for (const r of rows) {
      const item = r.after || r.before;
      changes.push(
        changeNames[r.type] +
          ' ' +
          item.label +
          '（' +
          (r.group === 'nodes' ? '节点' : '连线') +
          ' · ' +
          r.id +
          '）',
      );
    }
    return { changes, links: [...links], modules, rows };
  }
  function badge(v) {
    return (
      '<span class="rv-badge rv-' + v.state + '">' + labels[v.state] + '</span>'
    );
  }
  function directory() {
    const state = read();
    let context = editing();
    if (context && !state.plans.some((p) => p.id === context.id)) {
      sessionStorage.removeItem(revisionKey);
      context = null;
    }
    screen(
      '本地方案审核',
      '<p>审核记录保存在当前浏览器。全组共用的紫色版本在「团队约定」。本机审完后，点「发布或查看紫色团队约定」共享。</p>' +
        '<div class="lab-row"><button id="rvNew">' +
        (context ? '提交当前修订草稿' : '提交当前草稿') +
        '</button><button id="rvOwners">模块负责人</button><button id="rvTeamList">查看团队约定</button>' +
        (context ? '<button id="rvDetach">退出修订关联</button>' : '') +
        '</div>' +
        (state.plans.length
          ? state.plans
              .toReversed()
              .map((p) => {
                const contract = current(p),
                  last = p.versions.at(-1);
                return (
                  '<article class="shared-card"><strong>' +
                  esc(p.title) +
                  '</strong><p>创建于 ' +
                  esc(new Date(p.versions[0].created).toLocaleString()) +
                  ' · ' +
                  esc(p.versions[0].author) +
                  '</p><p>' +
                  (contract
                    ? '当前约定 v' + contract.n + ' ' + badge(contract)
                    : '尚待首次审核') +
                  (last.state === 'pending' ? ' · 待审 v' + last.n : '') +
                  '</p>' +
                  p.versions
                    .toReversed()
                    .map(
                      (v) =>
                        '<button data-plan="' +
                        esc(p.id) +
                        '" data-version="' +
                        v.n +
                        '">查看 v' +
                        v.n +
                        ' · ' +
                        (v.supersededBy
                          ? '旧稿，已由 v' + v.supersededBy + ' 接替'
                          : labels[v.state]) +
                        '</button>',
                    )
                    .join(' ') +
                  ' <button type="button" data-delete-plan="' +
                  esc(p.id) +
                  '">删除</button></article>'
                );
              })
              .join('')
          : '<p>还没有本地审核记录。可先在“模拟改图”里保存一个改动。</p>'),
    );
    $('rvNew').onclick = () => start(wb.getDraft(), '', '', context);
    $('rvOwners').onclick = () => owners(directory);
    $('rvTeamList').onclick = () => window.teamContracts.directory();
    if (context)
      $('rvDetach').onclick = () => {
        sessionStorage.removeItem(revisionKey);
        directory();
      };
    for (const b of $('labDialog').querySelectorAll('[data-plan]'))
      b.onclick = () => detail(b.dataset.plan, Number(b.dataset.version));
    for (const button of $('labDialog').querySelectorAll(
      '[data-delete-plan]',
    )) {
      button.onclick = () => {
        const plan = state.plans.find(
          (p) => p.id === button.dataset.deletePlan,
        );
        const created = new Date(plan.versions[0].created).toLocaleString();
        if (
          !confirm(
            `删除这条本地审核记录及其全部 ${plan.versions.length} 个版本？\n${plan.title}\n创建于 ${created} · ${plan.versions[0].author}`,
          )
        )
          return;
        save(
          state,
          (next) => {
            next.plans = next.plans.filter((p) => p.id !== plan.id);
          },
          directory,
        );
      };
    }
  }
  function owners(back, extra = []) {
    const state = read();
    const modules = new Map(
      base.nodes.filter((n) => n.kind === 'module').map((n) => [n.id, n.label]),
    );
    for (const [id, name] of extra) modules.set(id, name);
    screen(
      '模块负责人',
      '<p>每个模块可填一人或多人。暂时空着的会在影响清单里标为“待登记”。</p>' +
        [...modules]
          .map(
            ([id, name]) =>
              '<label>' +
              esc(name) +
              '<input data-owner="' +
              esc(id) +
              '" maxlength="120" value="' +
              esc(Object.hasOwn(state.owners, id) ? state.owners[id] : '') +
              '"></label>',
          )
          .join('') +
        '<button id="rvSaveOwners">保存负责人</button> <button id="rvBack">返回</button>',
    );
    $('rvBack').onclick = back;
    $('rvSaveOwners').onclick = () => {
      const pairs = [...$('labDialog').querySelectorAll('[data-owner]')].map(
        (el) => [el.dataset.owner, el.value.trim()],
      );
      save(
        state,
        (s) => {
          s.owners = { ...s.owners, ...Object.fromEntries(pairs) };
        },
        back,
      );
    };
  }
  function start(draft, author = '', title = '', context = null, issue = null) {
    const state = read();
    try {
      const plan = context && state.plans.find((p) => p.id === context.id);
      const parent = plan?.versions.find((v) => v.n === context.n);
      if (
        context &&
        (!plan ||
          (current(plan)?.n || null) !== context.n ||
          (context.replaces
            ? plan.versions.at(-1).n !== context.replaces ||
              plan.versions.at(-1).state !== 'pending'
            : plan.versions.at(-1).state === 'pending'))
      )
        throw Error('已有待审修订或当前约定已变化，请回审核列表核对。');
      const graph = wb.scenario(draft);
      if (
        context?.replaces &&
        !delta(wb.scenario(plan.versions.at(-1).draft), graph, draft).length
      )
        throw Error('待审内容与上一稿相同，请先修改再重新提交。');
      const impact = analyse(
        parent ? wb.scenario(parent.draft) : base,
        graph,
        draft,
      );
      if (!impact.changes.length)
        throw Error('没有实质修改。请先在“模拟改图”保存一个节点或连线的变化。');
      screen(
        parent ? '提交黄色修订' : '提交本地方案',
        '<form id="rvSubmit"><label>方案名称<input id="rvTitle" maxlength="120" required ' +
          (plan ? 'readonly' : '') +
          ' value="' +
          esc(plan?.title || title) +
          '"></label>' +
          '<label>修改人<input id="rvAuthor" maxlength="80" required value="' +
          esc(author || '') +
          '"></label><p>此次变更</p>' +
          list(impact.changes) +
          (parent
            ? '<p>本次修订基于 v' +
              parent.n +
              '。新版本审核通过前，原约定继续有效。</p>'
            : '') +
          '<button>保存为黄色待审</button></form>',
      );
      $('rvSubmit').onsubmit = (e) => {
        e.preventDefault();
        const who = value('rvAuthor'),
          name = value('rvTitle');
        if (!who || !name) return fail(Error('请填写方案名称和修改人。'));
        const id = plan?.id || crypto.randomUUID(),
          n = plan ? plan.versions.length + 1 : 1;
        save(
          state,
          (s) => {
            let target = s.plans.find((p) => p.id === id);
            if (!target) {
              target = { id, title: name, versions: [], issue };
              s.plans.push(target);
            }
            if (context?.replaces) target.versions.at(-1).supersededBy = n;
            target.versions.push({
              n,
              parent: parent?.n || null,
              author: who,
              created: new Date().toISOString(),
              state: 'pending',
              draft: structuredClone(draft),
              supplement: '',
            });
          },
          () => {
            if (context) sessionStorage.removeItem(revisionKey);
            detail(id, n);
          },
        );
      };
    } catch (e) {
      directory();
      fail(e);
    }
  }
  function detail(id, n) {
    const state = read(),
      plan = state.plans.find((p) => p.id === id),
      v = plan?.versions.find((x) => x.n === n);
    if (!v) return directory();
    const parent = plan.versions.find((x) => x.n === v.parent);
    const graph = wb.scenario(v.draft),
      before = parent ? wb.scenario(parent.draft) : base;
    const impact = analyse(before, graph, v.draft);
    const people = [...impact.modules].map(
      ([mid, name]) =>
        name +
        ' · ' +
        ((Object.hasOwn(state.owners, mid) && state.owners[mid]) ||
          '负责人待登记'),
    );
    const active = current(plan)?.n === v.n;
    const title = plan.title + ' v' + n;
    const notify =
      '【接口变更】' +
      title +
      ' · ' +
      labels[v.state] +
      '\n修改人：' +
      v.author +
      '\n改动：' +
      impact.changes.join('、') +
      (impact.links.length
        ? '\n直接关联：' + impact.links.join('；')
        : '\n直接关联：地图暂未收录，请核对') +
      '\n可能需要对接：' +
      people.join('、') +
      (v.supplement ? '\n人工补充：' + v.supplement : '');
    screen(
      title,
      '<p>' +
        badge(v) +
        ' · 修改人 ' +
        esc(v.author) +
        ' · ' +
        esc(new Date(v.created).toLocaleString()) +
        (v.reviewer ? ' · 审核人 ' + esc(v.reviewer) : '') +
        (v.supersededBy
          ? ' · 旧稿，已由 v' + v.supersededBy + ' 接替'
          : v.state === 'pending' && parent
            ? ' · 当前仍按 v' + parent.n + ' 开发'
            : v.state !== 'pending' && !active
              ? ' · 历史版本'
              : '') +
        '</p>' +
        '<div class="lab-row"><button id="rvGraph">在图上查看此版本</button><button id="rvList">审核列表</button></div>' +
        '<h3>这版改了什么</h3>' +
        list(impact.changes) +
        impact.rows
          .filter((r) => r.type === 'modified')
          .map(
            (r) =>
              '<details><summary>' +
              esc(r.after.label) +
              ' · 改前 / 改后</summary>' +
              list(
                r.changed
                  .filter((k) => k !== 'status')
                  .map(
                    (k) =>
                      k +
                      '：' +
                      (r.before[k] || '（空）') +
                      ' → ' +
                      (r.after[k] || '（空）'),
                  ),
              ) +
              '</details>',
          )
          .join('') +
        '<details><summary>直接上下游（修改前后两版的连线）</summary>' +
        (impact.links.length
          ? list(impact.links)
          : '<p>图中未收录直接连线，请修改人核对。</p>') +
        '</details>' +
        '<h3>可能受影响的负责人</h3>' +
        list(people) +
        '<button id="rvEditOwners">登记负责人</button>' +
        '<label>人工补充涉及的人或接口<textarea id="rvExtra" maxlength="2000">' +
        esc(v.supplement) +
        '</textarea></label>' +
        '<button id="rvExtraSave">保存补充</button><details open><summary>通知文案</summary><textarea id="rvNotice" readonly>' +
        esc(notify) +
        '</textarea><button id="rvCopy">复制通知</button></details>' +
        (v.state === 'pending' && !v.supersededBy
          ? '<form id="rvApprove"><label>审核人<input id="rvReviewer" required maxlength="80"></label><button>本机审核通过</button></form>'
          : '') +
        (active
          ? '<button id="rvTeamPublish">发布或查看紫色团队约定</button><p>本机审核已保存；发布到团队约定后，其他人可在网站上看到。</p>'
          : '') +
        (active && v.state === 'approved'
          ? '<form id="rvVerify"><h3>实现与复测核对</h3><label>核对人<input id="rvVerifier" required maxlength="80"></label><label>实现位置（提交、PR 或源码定位）<input id="rvSource" required maxlength="300"></label><label>通过的复测用例及结果<input id="rvTest" required maxlength="500"></label><button>确认核对通过，标为绿色</button></form>'
          : '') +
        (v.check
          ? '<p>核对人 ' +
            esc(v.check.who) +
            ' · 实现 ' +
            esc(v.check.source) +
            ' · 复测 ' +
            esc(v.check.test) +
            '</p>'
          : '') +
        ((v.state === 'pending' && !v.supersededBy) ||
        (active && plan.versions.at(-1).state !== 'pending')
          ? '<button id="rvRevise">基于此版继续修订</button>'
          : ''),
    );
    if ($('rvTeamPublish'))
      $('rvTeamPublish').onclick = () => window.teamContracts.publish(plan, v);
    $('rvList').onclick = directory;
    $('rvEditOwners').onclick = () =>
      owners(() => detail(id, n), impact.modules);
    const change = (fn) =>
      save(
        state,
        (s) =>
          fn(s.plans.find((p) => p.id === id).versions.find((x) => x.n === n)),
        () => detail(id, n),
      );
    $('rvExtraSave').onclick = () => {
      const note = value('rvExtra');
      change((x) => {
        x.supplement = note;
      });
    };
    $('rvCopy').onclick = async () => {
      if (value('rvExtra') !== v.supplement)
        return fail(Error('请先保存人工补充，再复制通知。'));
      try {
        await navigator.clipboard.writeText(notify);
        $('rvError').textContent = '已复制，可粘贴到组里。';
      } catch {
        $('rvNotice').select();
        $('rvError').textContent = '请按 ⌘C 或 Ctrl+C 复制选中文字。';
      }
    };
    if ($('rvApprove'))
      $('rvApprove').onsubmit = (e) => {
        e.preventDefault();
        const who = value('rvReviewer');
        if (!who) return fail(Error('请填写审核人。'));
        change((x) => {
          x.reviewer = who;
          x.approvedAt = new Date().toISOString();
          x.supplement = value('rvExtra');
          x.state = 'approved';
        });
      };
    if ($('rvVerify'))
      $('rvVerify').onsubmit = (e) => {
        e.preventDefault();
        const who = value('rvVerifier'),
          source = value('rvSource'),
          test = value('rvTest');
        if (!who || !source || !test)
          return fail(Error('请补全实现位置、核对人和通过的复测记录。'));
        change((x) => {
          x.check = { who, source, test, at: new Date().toISOString() };
          x.state = 'verified';
        });
      };
    if ($('rvRevise'))
      $('rvRevise').onclick = () => {
        if (
          !confirm('把此版本复制到当前模拟草稿？如需保留其他草稿，请先导出。')
        )
          return;
        wb.adoptShared(v.draft);
        sessionStorage.setItem(
          revisionKey,
          JSON.stringify(
            v.state === 'pending'
              ? { id, n: v.parent, replaces: v.n }
              : { id, n },
          ),
        );
        $('labDraft').click();
      };
    $('rvGraph').onclick = () => {
      const report = window.ScenarioCompare.calculate(before, graph, v.draft);
      const overlay = window.ScenarioCompare.overlayGraph(
        before,
        graph,
        report,
      );
      if (parent && v.state === 'pending') {
        const marks = overlay.meta.diffOverlay;
        for (const r of delta(base, before, parent.draft)) {
          if (
            r.type !== 'removed' &&
            (!marks[r.group][r.id] || marks[r.group][r.id] === 'review')
          )
            marks[r.group][r.id] = parent.state;
        }
      }
      if (v.state !== 'pending' && parent) {
        for (const r of delta(base, graph, v.draft)) {
          if (r.type !== 'removed')
            overlay.meta.diffOverlay[r.group][r.id] = v.state;
        }
      }
      for (const r of report.rows) {
        const marks = overlay.meta.diffOverlay[r.group];
        if (r.type === 'review') {
          if (marks[r.id] === 'review') delete marks[r.id];
        } else if (r.type !== 'removed') marks[r.id] = v.state;
      }
      overlay.meta.reviewLabel = title + ' · ' + labels[v.state];
      overlay.meta.modeLabel = overlay.meta.reviewLabel;
      $('compareViewBar').hidden = true;
      wb.previewReview(overlay, v.draft, overlay.meta.reviewLabel);
    };
  }
  const button = document.createElement('button');
  button.id = 'labReview';
  button.textContent = '方案审核';
  $('labShared').after(button);
  button.onclick = directory;
  window.interfaceReview = {
    ownersFor(commit) {
      try {
        return (
          JSON.parse(
            localStorage.getItem('vh-local-review-v1:' + commit) || '{}',
          )?.owners || {}
        );
      } catch {
        return {};
      }
    },
    start,
    importContract(record) {
      const state = read();
      const id = crypto.randomUUID();
      const plan = {
        id,
        issue: record.issue,
        title: '#' + record.issue + ' ' + record.title,
        versions: [
          {
            n: 1,
            parent: null,
            author: '团队约定 v' + record.version,
            created: new Date().toISOString(),
            state: 'approved',
            draft: record.draft,
            supplement: '',
          },
        ],
      };
      save(
        state,
        (s) => s.plans.push(plan),
        () => detail(id, 1),
      );
    },
  };
})();
