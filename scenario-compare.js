'use strict';
(() => {
  const esc = (s) =>
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
  const fields = {
    label: '名称 / 说明',
    kind: '层级',
    module: '所属模块',
    parent: '所属组件 / 父节点',
    summary: '用途',
    signature: '函数签名',
    input: '输入',
    output: '输出',
    errors: '错误与取消',
    componentType: '组件类型',
    visibility: '可见范围',
    route: '路径',
    source: '起点',
    target: '终点',
    type: '关系类型',
    status: '实现状态',
  };
  const nodeFields = [
    'label',
    'kind',
    'module',
    'parent',
    'summary',
    'signature',
    'input',
    'output',
    'errors',
    'componentType',
    'visibility',
    'route',
  ];
  const edgeFields = ['source', 'target', 'type', 'label', 'route'];
  const names = {
    added: '新增',
    modified: '修改',
    removed: '删除',
    review: '仅状态变化',
  };
  function equal(a, b) {
    return JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
  }
  function calculate(before, after, draft) {
    const rows = [];
    for (const [group, keys] of [
      ['nodes', nodeFields],
      ['edges', edgeFields],
    ]) {
      const old = new Map(before[group].map((x) => [x.id, x])),
        next = new Map(after[group].map((x) => [x.id, x]));
      for (const id of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(id),
          b = next.get(id),
          changed =
            a && b
              ? keys.filter((k) => !equal(a[k], b[k]))
              : keys.filter((k) => (a || b)[k] !== undefined);
        const statusChanged = a && b && !equal(a.status, b.status);
        if (a && b && !changed.length && !statusChanged) continue;
        const type = !a
          ? 'added'
          : !b
            ? 'removed'
            : changed.length
              ? 'modified'
              : 'review';
        let reason = '';
        if (type === 'removed')
          reason =
            group === 'nodes'
              ? draft.removedNodes.includes(id)
                ? '方案直接删除此节点'
                : '随父节点删除'
              : draft.removedEdges.includes(id)
                ? '方案直接删除此连线'
                : '随节点删除而移除的关联连线';
        if (type === 'review')
          reason =
            group === 'edges'
              ? '端点或连线被模拟调整，关联状态变为 Proposed；关系内容本身未改。'
              : '字段内容未变，但模拟保存使该节点变为 Proposed。';
        rows.push({
          id,
          group,
          type,
          before: a || null,
          after: b || null,
          changed: statusChanged ? [...changed, 'status'] : changed,
          reason,
        });
      }
    }
    return {
      rows,
      counts: Object.fromEntries(
        Object.keys(names).map((k) => [
          k,
          rows.filter((r) => r.type === k).length,
        ]),
      ),
      nodeCounts: Object.fromEntries(
        Object.keys(names).map((k) => [
          k,
          rows.filter((r) => r.group === 'nodes' && r.type === k).length,
        ]),
      ),
      edgeCounts: Object.fromEntries(
        Object.keys(names).map((k) => [
          k,
          rows.filter((r) => r.group === 'edges' && r.type === k).length,
        ]),
      ),
    };
  }
  function overlayGraph(before, after, report) {
    const g = structuredClone(after),
      nodeIds = new Set(g.nodes.map((n) => n.id)),
      edgeIds = new Set(g.edges.map((e) => e.id));
    for (const row of report.rows)
      if (row.type === 'removed') {
        if (row.group === 'nodes' && !nodeIds.has(row.id)) {
          g.nodes.push(structuredClone(row.before));
          nodeIds.add(row.id);
        }
        if (row.group === 'edges' && !edgeIds.has(row.id)) {
          g.edges.push(structuredClone(row.before));
          edgeIds.add(row.id);
        }
      }
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    g.hierarchy = g.nodes
      .filter((n) => n.parent)
      .map((n) => ({
        source: n.parent,
        target: n.id,
        type: byId.get(n.parent)?.kind === 'component' ? 'Defines' : 'Contains',
      }));
    g.meta.diffOverlay = {
      nodes: Object.fromEntries(
        report.rows
          .filter((r) => r.group === 'nodes')
          .map((r) => [r.id, r.type]),
      ),
      edges: Object.fromEntries(
        report.rows
          .filter((r) => r.group === 'edges')
          .map((r) => [r.id, r.type]),
      ),
    };
    g.meta.overlayOverview = true;
    g.meta.sourceBasis =
      '模拟方案增删对照；含已删除旧节点/旧连线，仅作参考，不是修改后的实现图。';
    return g;
  }
  const panel = document.createElement('dialog');
  panel.id = 'compareDialog';
  document.body.append(panel);
  const strip = document.createElement('div');
  strip.id = 'compareViewBar';
  strip.hidden = true;
  document.getElementById('labBar').after(strip);
  const $ = (id) => panel.querySelector('#' + id);
  let current = null,
    selected = '',
    filter = 'all',
    query = '';
  function key(r) {
    return r.group + ':' + r.id;
  }
  function nodeName(id, g) {
    const n = g.nodes.find((x) => x.id === id);
    return n ? n.label + ' · ' + id : id;
  }
  function label(r) {
    const v = r.after || r.before,
      g = r.after ? current.after : current.before;
    return r.group === 'nodes'
      ? v.label
      : nodeName(v.source, g).split(' · ')[0] +
          ' → ' +
          nodeName(v.target, g).split(' · ')[0];
  }
  function value(v, k, g) {
    if (!v) return '—';
    const x = v[k];
    if (x === undefined || x === '') return '未填写';
    if (['module', 'parent', 'source', 'target'].includes(k))
      return nodeName(x, g);
    return typeof x === 'string' ? x : JSON.stringify(x);
  }
  function list() {
    const items = current.report.rows.filter(
      (r) =>
        (filter === 'all' || r.type === filter) &&
        (label(r) + ' ' + r.id).toLowerCase().includes(query.toLowerCase()),
    );
    $('compareList').innerHTML = items.length
      ? items
          .map(
            (r) =>
              `<button class="compare-item ${key(r) === selected ? 'selected' : ''}" data-row="${esc(key(r))}"><span class="diff-tag ${r.type}">${names[r.type]}</span> ${r.group === 'nodes' ? '节点' : '连线'}<strong>${esc(label(r))}</strong><small>${esc(r.id)}</small></button>`,
          )
          .join('')
      : '<p>没有符合条件的变化。</p>';
    $('compareList')
      .querySelectorAll('[data-row]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            selected = b.dataset.row;
            list();
            detail();
          }),
      );
  }
  function detail() {
    const r = current.report.rows.find((x) => key(x) === selected);
    if (!r) {
      $('compareDetail').innerHTML =
        '<p>这里会逐项显示原来的内容和模拟后的内容。未修改的项目不列入清单。</p>';
      return;
    }
    const keys = r.group === 'nodes' ? nodeFields : edgeFields,
      visible = [...keys, 'status'].filter(
        (k) => r.before?.[k] !== undefined || r.after?.[k] !== undefined,
      );
    $('compareDetail').innerHTML =
      `<h3><span class="diff-tag ${r.type}">${names[r.type]}</span> ${esc(label(r))}</h3><p class="compare-reason">${esc(r.reason || (r.type === 'added' ? '原地图未收录此项；这是本次拟议新增，不代表原业务代码一定不存在。' : r.type === 'modified' ? '高亮字段是这次的具体变化。' : '方案删除，不代表业务代码已经删除。'))}</p><div class="compare-table-wrap diff-${r.type}"><table><thead><tr><th>字段</th><th>修改前 · 基线图</th><th>修改后 · 拟议方案</th></tr></thead><tbody>${!r.before || !r.after ? `<tr><th>是否存在</th><td>${r.before ? '原图中存在' : '原图未收录'}</td><td>${r.after ? '方案中存在' : '方案中已移除'}</td></tr>` : ''}${visible.map((k) => `<tr class="${r.changed.includes(k) || !r.before || !r.after ? 'field-changed' : ''}"><th>${esc(fields[k])}</th><td>${esc(value(r.before, k, current.before))}</td><td>${esc(value(r.after, k, current.after))}</td></tr>`).join('')}</tbody></table></div><div class="lab-row compare-actions"><button id="compareCombined">增删同图（含删除项）</button><button id="compareBefore" ${!r.before ? 'disabled' : ''}>图中看修改前</button><button id="compareAfter" ${!r.after ? 'disabled' : ''}>图中看修改后</button></div><p class="hint">包含 / 归属变化看父节点字段；调用、数据流和事件变化看连线清单，两者分开比较。</p>`;
    $('compareCombined').onclick = () => graph('changes');
    $('compareBefore').onclick = () => graph('before');
    $('compareAfter').onclick = () => graph('after');
  }
  function counts(c) {
    return `新增 ${c.added} · 修改 ${c.modified} · 删除 ${c.removed} · 仅状态变化 ${c.review}`;
  }
  function render() {
    panel.innerHTML = `<div class="lab-heading"><div><h2>修改前后对比</h2><p>${esc(current.title)}</p></div><button id="closeCompare">关闭</button></div><p class="compare-note">对照基线 <code>${esc(current.before.meta.referenceCommit.slice(0, 12))}</code> 中已收录的接口说明。右侧为模拟方案，不是已实现的新版本代码；本机草稿不会被覆盖。</p><div id="compareCounts"><strong>节点：${counts(current.report.nodeCounts)}</strong><strong>连线：${counts(current.report.edgeCounts)}</strong></div><div class="compare-legend"><span class="diff-tag added">绿色＋ 新增</span><span class="diff-tag removed">红色虚线－ 删除（旧内容）</span><span class="diff-tag modified">土黄色～ 修改</span><span class="diff-tag review">蓝灰色 · 仅状态变化</span><button id="compareAllChanges">查看增删同图</button></div><div class="compare-tools"><label>筛选<select id="compareFilter"><option value="all">全部变化</option>${Object.entries(
      names,
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join(
        '',
      )}</select></label><label>查找变化<input id="compareSearch" placeholder="接口、连线或 ID"></label></div><div class="compare-columns"><nav id="compareList" aria-label="变更清单"></nav><section id="compareDetail" aria-live="polite"></section></div>`;
    $('compareAllChanges').onclick = () => graph('changes');
    $('closeCompare').onclick = () => panel.close();
    $('compareFilter').value = filter;
    $('compareSearch').value = query;
    $('compareFilter').onchange = (e) => {
      filter = e.target.value;
      list();
    };
    $('compareSearch').oninput = (e) => {
      query = e.target.value;
      list();
    };
    list();
    detail();
    if (!panel.open) panel.showModal();
  }
  function graph(side) {
    const r = current.report.rows.find((x) => key(x) === selected),
      g =
        side === 'changes'
          ? overlayGraph(current.before, current.after, current.report)
          : structuredClone(current[side]),
      item = r?.[side];
    if (side !== 'changes') {
      g.meta.diffOverlay = {
        nodes: Object.fromEntries(
          current.report.rows
            .filter((x) => x.group === 'nodes' && x[side])
            .map((x) => [x.id, x.type]),
        ),
        edges: Object.fromEntries(
          current.report.rows
            .filter((x) => x.group === 'edges' && x[side])
            .map((x) => [x.id, x.type]),
        ),
      };
    }
    g.meta.modeLabel = `对比 · ${side === 'changes' ? '增删同图（含删除旧内容）' : side === 'before' ? '修改前（基线图）' : '修改后（拟议方案）'} · ${current.title}`;
    window.mapWorkbench.showComparison(g, g.meta.modeLabel);
    if (side !== 'changes' && r && item) {
      if (r.group === 'nodes') window.interfaceMap.select(r.id);
      else window.interfaceMap.select(item.target);
    } else if (side !== 'changes' && r) {
      const other = r.before || r.after,
        parent = other.parent || other.source;
      if (g.nodes.some((n) => n.id === parent))
        window.interfaceMap.select(parent);
    }
    panel.close();
    strip.hidden = false;
    strip.innerHTML = `<strong>${side === 'changes' ? '增删同图：红色为已删除参考项' : side === 'before' ? '正在看修改前' : '正在看修改后'}：${esc(r ? label(r) : current.title)}</strong><button id="compareSwitchChanges" aria-pressed="${side === 'changes'}">增删同图</button><button id="compareSwitchBefore" aria-pressed="${side === 'before'}">修改前</button><button id="compareSwitchAfter" aria-pressed="${side === 'after'}">修改后</button><button id="returnCompare">返回变更清单</button><button id="exitCompare">退出对比</button>`;
    document.getElementById('compareSwitchChanges').onclick = () =>
      graph('changes');
    document.getElementById('compareSwitchBefore').onclick = () =>
      graph('before');
    document.getElementById('compareSwitchAfter').onclick = () =>
      graph('after');
    document.getElementById('returnCompare').onclick = render;
    document.getElementById('exitCompare').onclick = () => {
      strip.hidden = true;
      document.getElementById('labBase').click();
    };
  }
  function open(d, title) {
    const before = window.mapWorkbench.getBase(),
      after = window.mapWorkbench.scenario(d); // Validate commit and ownership before opening any comparison.
    current = {
      before,
      after,
      title,
      draft: structuredClone(d),
      report: calculate(before, after, d),
    };
    filter = 'all';
    query = '';
    selected = current.report.rows[0] ? key(current.report.rows[0]) : '';
    render();
  }
  // A normal map action ends the graph comparison; opening a comparison never writes draft storage.
  for (const id of ['labBase', 'labDraft', 'labShared', 'labUpdate'])
    document.getElementById(id)?.addEventListener('click', () => {
      strip.hidden = true;
    });
  window.ScenarioCompare = {
    open,
    calculate,
    overlayGraph,
    openCurrent() {
      if (current && window.mapWorkbench.getMode() === 'compare') {
        render();
        return;
      }
      const t = window.mapWorkbench.getComparisonTarget();
      open(t.draft, t.title);
    },
    getReport: () => (current ? structuredClone(current.report) : null),
  };
})();
