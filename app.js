'use strict';
(() => {
  const D = window.GRAPH_DATA;
  const $ = (id) => document.getElementById(id),
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
  const N = new Map(D.nodes.map((n) => [n.id, n])),
    M = D.nodes.filter((n) => n.kind === 'module'),
    E = new Map(D.edges.map((e) => [e.id, e]));
  const COLORS = {
    Calls: '#347365',
    'Data Flow': '#426faa',
    'Emits / Handles': '#a06d35',
    'Depends On': '#7d6b98',
    'Proposed Integration': '#ad7b24',
  };
  const DIFF = {
    added: { color: '#24704b', fill: '#e2f4e8', label: '＋ 新增' },
    removed: { color: '#bf3e4c', fill: '#fde8eb', label: '－ 已删除' },
    modified: { color: '#a57621', fill: '#fff1d2', label: '～ 修改' },
    review: { color: '#58718c', fill: '#eaf0f6', label: '仅状态变化' },
  };
  const diffNode = (n) => DIFF[D.meta.diffOverlay?.nodes[n.id]],
    diffEdge = (e) => DIFF[D.meta.diffOverlay?.edges[e.id]];
  const DASH = {
    Calls: '',
    'Data Flow': '6 3',
    'Emits / Handles': '2 3',
    'Depends On': '7 4 2 4',
    'Proposed Integration': '9 5',
  };
  const state = {
    expanded: new Set(),
    components: new Set(),
    selected: null,
    focus: '',
    tour: '',
    filters: new Set(D.meta.relations),
    proposed: false,
    diffOverview: false,
    allEdges: false,
    query: '',
    zoom: 1,
    tx: 0,
    ty: 0,
    positions: new Map(),
    renderNodes: [],
    renderEdges: [],
    box: { w: 1000, h: 700 },
  };
  let drag = null,
    sourceRef = null,
    toastTimer;
  const kids = (id) => D.nodes.filter((n) => n.parent === id);
  const statusBadge = (s) =>
    `<span class="badge ${s.toLowerCase()}">${s}</span>`;
  const evidenceLinks = (ids) =>
    (ids || [])
      .map((id) => {
        const e = D.evidence[id];
        return `<button class="evidence-link" data-evidence="${esc(id)}">${e.kind === 'source' ? `${esc(e.path)}<br>L${e.line}–${e.endLine}` : `协作建议 · 段落 ${e.paragraph}`} ↗</button>`;
      })
      .join('');
  const nodeLink = (id, caption = '') =>
    `<button class="link-node" data-node="${esc(id)}">${esc(N.get(id)?.label || id)}<span>${esc(caption || N.get(N.get(id)?.parent)?.label || '')}</span></button>`;
  function toast(s) {
    $('toast').textContent = s;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
  }
  function validEdge(e) {
    return (
      state.filters.has(e.type) &&
      (state.proposed ||
        e.status !== 'Proposed' ||
        D.meta.diffOverlay?.edges[e.id])
    );
  }
  function updateTree() {
    const q = state.query.toLowerCase();
    if (q) {
      const hits = D.nodes.filter(
        (n) =>
          (state.proposed || n.status !== 'Proposed') &&
          `${n.label} ${n.id} ${n.signature || ''} ${n.summary}`
            .toLowerCase()
            .includes(q),
      );
      $('tree').innerHTML =
        `<div class="tree-results"><p class="hint">${hits.length} 个匹配项</p>${hits.map((n) => `<div class="group">${esc(N.get(n.module).label)} · ${esc(n.kind)}</div><button class="tree-api ${n.id === state.selected ? 'selected' : ''}" data-node="${n.id}">${esc(n.label)}${n.status === 'Proposed' ? ' <small>建议</small>' : ''}</button>`).join('')}</div>`;
      return;
    }
    $('tree').innerHTML = M.map(
      (m) =>
        `<div class="tree-module"><button class="toggle" data-expand="${m.id}" aria-label="${state.expanded.has(m.id) ? '折叠' : '展开'}${esc(m.label)}">${state.expanded.has(m.id) ? '−' : '＋'}</button><button data-focus="${m.id}">${esc(m.label)}</button></div>${
          state.expanded.has(m.id)
            ? kids(m.id)
                .filter((n) => state.proposed || n.status !== 'Proposed')
                .map((c) =>
                  c.kind === 'component'
                    ? `<details ${state.components.has(c.id) ? 'open' : ''} data-component="${c.id}"><summary>${esc(c.label)} <small>(${kids(c.id).length})</small></summary>${kids(
                        c.id,
                      )
                        .map(
                          (n) =>
                            `<button class="tree-api ${state.selected === n.id ? 'selected' : ''}" data-node="${n.id}">${esc(n.label)}</button>`,
                        )
                        .join('')}</details>`
                    : `<button class="tree-api" data-node="${c.id}">${esc(c.label)} <small>建议</small></button>`,
                )
                .join('')
            : ''
        }`,
    ).join('');
  }
  function choose(id) {
    const n = N.get(id);
    if (!n) return;
    if (n.status === 'Proposed') {
      state.proposed = true;
      $('proposed').checked = true;
    }
    if (n.kind === 'module') {
      toggleModule(id);
      return;
    }
    if (n.kind === 'component') {
      state.diffOverview = false;
      state.focus = n.module;
      state.expanded.add(n.module);
      if (state.components.has(id)) state.components.delete(id);
      else state.components.add(id);
      state.selected = null;
      state.tour = '';
      render(true);
      detailNode(n);
      return;
    }
    state.expanded.add(n.module);
    if (n.parent !== n.module) state.components.add(n.parent);
    state.selected = id;
    state.tour = '';
    $('focus').value = state.focus;
    render(true);
    detailNode(n);
  }
  function toggleModule(id) {
    state.diffOverview = false;
    state.selected = null;
    state.tour = '';
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    if (state.focus && state.focus !== id) state.focus = '';
    render(true);
    detailNode(N.get(id));
  }
  function focus(id) {
    state.diffOverview = false;
    state.focus = id;
    state.selected = null;
    state.tour = '';
    if (id) state.expanded.add(id);
    $('focus').value = id;
    render(true);
    if (id) detailNode(N.get(id));
    else intro();
  }
  function overview() {
    state.diffOverview = !!D.meta.overlayOverview;
    state.focus = '';
    state.tour = '';
    state.selected = null;
    state.expanded.clear();
    state.components.clear();
    if (state.diffOverview) {
      const affected = new Set(
        Object.keys(D.meta.diffOverlay.nodes).map((id) => N.get(id)?.module),
      );
      for (const e of D.edges)
        if (D.meta.diffOverlay.edges[e.id]) {
          affected.add(N.get(e.source)?.module);
          affected.add(N.get(e.target)?.module);
        }
      for (const m of M) if (affected.has(m.id)) state.expanded.add(m.id);
      for (const n of D.nodes)
        if (n.kind === 'component' && affected.has(n.module))
          state.components.add(n.id);
      state.proposed = true;
      $('proposed').checked = true;
    }
    $('focus').value = '';
    state.query = '';
    $('search').value = '';
    render(true);
    intro();
  }
  function addNode(id, x, y, w = 245, h = 64, extra = {}) {
    const n = N.get(id);
    if (!n) return;
    state.renderNodes.push({ ...n, x, y, w, h, ...extra });
  }
  function layoutNeighborhood() {
    const id = state.selected;
    const rel = D.edges.filter(
      (e) => validEdge(e) && (e.source === id || e.target === id),
    );
    const before = [
      ...new Set(rel.filter((e) => e.target === id).map((e) => e.source)),
    ].filter((x) => x !== id);
    const after = [
      ...new Set(rel.filter((e) => e.source === id).map((e) => e.target)),
    ].filter((x) => x !== id && !before.includes(x));
    const rows = Math.max(before.length, after.length, 1),
      cy = 50 + Math.max(0, rows - 1) * 57;
    addNode(id, 365, cy, 270, 90, { selected: true });
    before.forEach((n, i) => addNode(n, 25, 45 + i * 115, 260, 80));
    after.forEach((n, i) => addNode(n, 715, 45 + i * 115, 260, 80));
    const linked = new Set([id, ...before, ...after]);
    const n = N.get(id);
    kids(n.parent)
      .filter((x) => !linked.has(x.id))
      .slice(0, 5)
      .forEach((s, i) =>
        addNode(s.id, 365, cy + 130 + i * 60, 270, 46, {
          dim: true,
          sibling: true,
        }),
      );
    state.renderEdges = rel.map((e) => ({ ...e, originals: [e.id] }));
  }
  function layoutChanges() {
    layoutHierarchy();
  }
  function layoutTour() {
    const tour = D.tours.find((t) => t.id === state.tour),
      ids = tour.nodes.filter(
        (id) => state.proposed || N.get(id).status !== 'Proposed',
      );
    ids.forEach((id, i) =>
      addNode(id, 30 + (i % 3) * 350, 35 + Math.floor(i / 3) * 155, 270, 85),
    );
    const set = new Set(ids);
    state.renderEdges = D.edges
      .filter((e) => validEdge(e) && set.has(e.source) && set.has(e.target))
      .map((e) => ({ ...e, originals: [e.id] }));
  }
  function layoutHierarchy() {
    let shownModules = state.focus ? M.filter((m) => m.id === state.focus) : M;
    if (state.focus) {
      const related = new Set();
      for (const e of D.edges.filter(validEdge)) {
        const a = N.get(e.source).module,
          b = N.get(e.target).module;
        if (a === state.focus && b !== a) related.add(b);
        if (b === state.focus && a !== b) related.add(a);
      }
      shownModules = [...shownModules, ...M.filter((m) => related.has(m.id))];
    }
    const layouts = [];
    for (const m of shownModules) {
      const expanded =
        state.expanded.has(m.id) && (state.focus ? m.id === state.focus : true);
      const children = [];
      let h = 90,
        w = 280;
      if (expanded && D.meta.overlayOverview) {
        w = 580;
        let y = 85;
        for (const c of kids(m.id).filter(
          (n) => state.proposed || n.status !== 'Proposed',
        )) {
          children.push({ id: c.id, x: 20, y, w: 540, h: 62 });
          y += 76;
          if (c.kind === 'component' && state.components.has(c.id)) {
            const list = kids(c.id);
            list.forEach((n, i) =>
              children.push({
                id: n.id,
                x: 28 + (i % 2) * 274,
                y: y + Math.floor(i / 2) * 76,
                w: 258,
                h: 64,
              }),
            );
            y += Math.ceil(list.length / 2) * 76 + 12;
          }
        }
        h = y + 12;
      } else if (expanded) {
        w = 580;
        const ycols = [85, 85];
        kids(m.id)
          .filter((n) => state.proposed || n.status !== 'Proposed')
          .forEach((c) => {
            const col = ycols[0] <= ycols[1] ? 0 : 1;
            const x = 20 + col * 280;
            let y = ycols[col];
            children.push({ id: c.id, x, y, w: 260, h: 62 });
            y += 72;
            if (c.kind === 'component' && state.components.has(c.id)) {
              kids(c.id).forEach((n) => {
                children.push({ id: n.id, x: x + 8, y, w: 244, h: 46 });
                y += 54;
              });
            }
            ycols[col] = y + 14;
          });
        h = Math.max(...ycols) + 12;
      }
      layouts.push({ m, w, h, children, expanded });
    }
    // Focus is centered; global columns follow the runtime topology.
    if (state.focus) {
      const first = layouts[0];
      addNode(first.m.id, 350, 30, first.w, first.h, {
        container: first.expanded,
      });
      first.children.forEach((c) =>
        addNode(c.id, 350 + c.x, 30 + c.y, c.w, c.h),
      );
      const left = layouts.slice(1).filter((_, i) => i % 2 === 0),
        right = layouts.slice(1).filter((_, i) => i % 2 === 1);
      left.forEach((b, i) => addNode(b.m.id, 20, 45 + i * 150, b.w, b.h));
      right.forEach((b, i) => addNode(b.m.id, 980, 45 + i * 150, b.w, b.h));
    } else {
      const order = [
        ['web'],
        ['memory', 'live', 'backend'],
        ['voice', 'eff', 'safety'],
      ];
      const known = new Set(order.flat());
      const extra = layouts
        .filter((x) => !known.has(x.m.id))
        .map((x) => x.m.id);
      if (extra.length) order.push(extra);
      let y = 25;
      for (const row of order) {
        const bs = row
          .map((id) => layouts.find((x) => x.m.id === id))
          .filter(Boolean);
        if (!bs.length) continue;
        const total = bs.reduce((s, b) => s + b.w, 0) + (bs.length - 1) * 90;
        let x = (Math.max(1140, total) - total) / 2 + 20;
        for (const b of bs) {
          addNode(b.m.id, x, y, b.w, b.h, { container: b.expanded });
          b.children.forEach((c) => addNode(c.id, x + c.x, y + c.y, c.w, c.h));
          x += b.w + 90;
        }
        y += Math.max(...bs.map((b) => b.h)) + 100;
      }
    }
    const visible = new Set(state.renderNodes.map((n) => n.id));
    function representative(id) {
      let n = N.get(id);
      while (n && !visible.has(n.id)) n = N.get(n.parent);
      return n?.id;
    }
    const groups = new Map();
    for (const e of D.edges.filter(validEdge)) {
      const s = representative(e.source),
        t = representative(e.target);
      if (!s || !t || s === t) continue;
      const sn = N.get(s),
        tn = N.get(t);
      if (!state.allEdges && sn.module === tn.module && !diffEdge(e)) continue;
      const key = [
        s,
        t,
        e.type,
        e.status,
        D.meta.diffOverlay?.edges[e.id] || '',
      ].join('|');
      let g = groups.get(key);
      if (!g) {
        g = { ...e, source: s, target: t, originals: [] };
        groups.set(key, g);
      }
      g.originals.push(e.id);
    }
    state.renderEdges = [...groups.values()].map((g) => ({
      ...g,
      label:
        g.originals.length > 1
          ? `${g.type} · ${g.originals.length} 条关系`
          : g.label,
    }));
    if (!state.allEdges) {
      const chosen = new Map();
      const rank = {
        Calls: 0,
        'Data Flow': 1,
        'Emits / Handles': 2,
        'Depends On': 3,
        'Proposed Integration': 4,
      };
      const mainPairs = new Set([
        'web|live',
        'live|web',
        'voice|eff',
        'live|eff',
        'live|memory',
        'memory|live',
        'eff|live',
        'eff|voice',
        'live|backend',
        'backend|live',
        'live|safety',
        'safety|live',
        'safety|backend',
        'backend|safety',
      ]);
      for (const e of state.renderEdges) {
        const pair = e.source + '|' + e.target;
        if (
          !state.focus &&
          !state.expanded.size &&
          !mainPairs.has(pair) &&
          e.status !== 'Proposed'
        )
          continue;
        const preferred = {
          'backend|live': 'Emits / Handles',
          'voice|eff': 'Emits / Handles',
          'eff|live': 'Emits / Handles',
          'safety|live': 'Data Flow',
        };
        const score = (x) => (x.type === preferred[pair] ? -1 : rank[x.type]);
        const key =
          pair + '|' + e.status + '|' + (D.meta.diffOverlay?.edges[e.id] || '');
        const old = chosen.get(key);
        if (!old || score(e) < score(old)) chosen.set(key, e);
      }
      state.renderEdges = [...chosen.values()];
      const labels = {
        'web|live': '装配与 Host 回调',
        'live|web': '状态 / 字幕 / 音频',
        'voice|eff': '语音事件 / 恢复请求',
        'live|eff': '音频 / 回执 / 上下文代理',
        'live|memory': '附加 / 检索 / 发布',
        'memory|live': '记忆文本与回执',
        'eff|live': '语音 / 恢复 / 压缩事件',
        'eff|voice': '传输 / 上下文装载',
        'live|backend': '提交 / 订阅 / 取消',
        'backend|live': '任务与授权事件',
        'live|safety': '工具分发与审批',
        'safety|live': '工具 / 审批回执',
        'safety|backend': '投递授权决定',
        'backend|safety': '授权投递回执',
      };
      const expected = {
        'voice|eff': 'Emits / Handles',
        'eff|live': 'Emits / Handles',
        'safety|live': 'Data Flow',
        'backend|safety': 'Data Flow',
        'backend|live': 'Emits / Handles',
        'memory|live': 'Data Flow',
      };
      if (!state.focus && !state.expanded.size)
        state.renderEdges = state.renderEdges.map((e) => {
          const pair = e.source + '|' + e.target;
          return {
            ...e,
            label:
              e.type === (expected[pair] || 'Calls')
                ? labels[pair] || e.label
                : e.label,
          };
        });
    }
  }
  function render(autoFit = false) {
    state.renderNodes = [];
    state.renderEdges = [];
    if (state.selected && !state.allEdges) layoutNeighborhood();
    else if (state.tour) layoutTour();
    else if (state.diffOverview) layoutChanges();
    else layoutHierarchy();
    if (!autoFit)
      for (const n of state.renderNodes) {
        const p = state.positions.get(n.id);
        if (p) {
          n.x = p.x;
          n.y = p.y;
        }
      }
    else state.positions.clear();
    state.box = {
      w: Math.max(800, ...state.renderNodes.map((n) => n.x + n.w)) + 30,
      h: Math.max(430, ...state.renderNodes.map((n) => n.y + n.h)) + 40,
    };
    draw();
    updateTree();
    updateHeader();
    if (autoFit) fit();
  }
  function draw() {
    const selected = state.selected;
    const neighbors = new Set([selected]);
    if (selected)
      for (const e of D.edges.filter(validEdge)) {
        if (e.source === selected) neighbors.add(e.target);
        if (e.target === selected) neighbors.add(e.source);
      }
    const byId = new Map(state.renderNodes.map((n) => [n.id, n]));
    $('backgrounds').innerHTML = state.renderNodes
      .filter((n) => n.container)
      .map(
        (n) =>
          `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="#f1f6ee" stroke="#aabeb0"/>`,
      )
      .join('');
    $('nodes').innerHTML = state.renderNodes
      .map((n) => {
        const dim =
          n.dim ||
          (selected &&
            state.allEdges &&
            !neighbors.has(n.id) &&
            n.kind !== 'module');
        const isSelected = n.id === selected;
        const isModule = n.kind === 'module',
          isComponent = n.kind === 'component';
        const dc = diffNode(n);
        const stroke = dc
          ? dc.color
          : isSelected
            ? '#1c7958'
            : n.status === 'Proposed'
              ? '#ba8a3b'
              : isModule
                ? '#aabeb0'
                : '#ccd8cd';
        const fill = dc
          ? dc.fill
          : isSelected
            ? '#e1f0e4'
            : n.status === 'Proposed'
              ? '#fff7e8'
              : n.container
                ? '#f1f6ee'
                : isModule
                  ? '#ffffff'
                  : isComponent
                    ? '#edf3eb'
                    : '#ffffff';
        const title = wrap(
          (dc ? dc.label + ' · ' : '') + n.label,
          n.w - 30,
          isModule ? 16 : 13,
          2,
        );
        const moduleName = N.get(n.module)?.label;
        const subtitle = isModule
          ? n.container
            ? '点击折叠 · 包含组件'
            : '点击展开 · ' +
              D.nodes.filter((x) => x.module === n.id && x.kind === 'interface')
                .length +
              ' 个接口'
          : isComponent
            ? `${n.componentType} · ${kids(n.id).length} 个调用点`
            : n.sibling
              ? '同组件其他接口'
              : `${N.get(n.parent)?.label || moduleName} · ${n.status}`;
        const tagY = n.container ? 60 : n.h - 13;
        return `<g class="graph-node" data-id="${n.id}" data-diff="${D.meta.diffOverlay?.nodes[n.id] || ''}" tabindex="0" role="button" aria-label="${esc(n.label)} ${esc(n.status)}" opacity="${dim && !dc ? 0.24 : 1}"><title>${esc(n.label + ' · ' + n.summary)}</title><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.container ? 70 : n.h}" rx="${isModule ? 12 : 7}" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 3 : dc ? 2 : 1.2}" ${D.meta.diffOverlay?.nodes[n.id] === 'removed' ? 'stroke-dasharray="8 5"' : !dc && n.status !== 'Implemented' ? 'stroke-dasharray="6 4"' : ''}/>${isModule ? `<rect x="${n.x + 14}" y="${n.y + 17}" width="4" height="21" rx="2" fill="#2e6951"/>` : ''}<text x="${n.x + (isModule ? 28 : 14)}" y="${n.y + 24}" font-size="${isModule ? 16 : 13}" font-weight="${isModule || isSelected ? 600 : 500}" fill="#203d30">${title.map((s, i) => `<tspan x="${n.x + (isModule ? 28 : 14)}" dy="${i ? 18 : 0}">${esc(s)}</tspan>`).join('')}</text><text x="${n.x + 14}" y="${n.y + tagY}" font-size="10" fill="#627768">${esc(truncate(subtitle, n.w - 28, 10))}</text></g>`;
      })
      .join('');
    const parallel = new Map();
    $('edges').innerHTML = state.renderEdges
      .map((e, i) => {
        const a = byId.get(e.source),
          b = byId.get(e.target);
        if (!a || !b) return '';
        const key = [e.source, e.target].sort().join('|');
        const count = parallel.get(key) || 0;
        parallel.set(key, count + 1);
        const geo = route(a, b, count, state.renderNodes);
        const dc = diffEdge(e),
          contextOnly = state.diffOverview && !state.allEdges && !dc,
          color = dc?.color || COLORS[e.type];
        let label = truncate(
          (dc ? dc.label + ' · ' : '') + e.label,
          geo.labelWidth,
          11,
        );
        if (contextOnly) label = '';
        const labelW = label ? Math.min(240, measure(label, 11) + 14) : 0;
        const dim =
          selected &&
          state.allEdges &&
          e.source !== selected &&
          e.target !== selected;
        return `<g class="graph-edge edge-hit" data-edge-index="${i}" data-diff="${D.meta.diffOverlay?.edges[e.id] || ''}" opacity="${contextOnly ? 0.22 : dim && !dc ? 0.12 : 1}"><title>${esc(e.type + ' · ' + e.label)}</title><path d="${geo.d}" fill="none" stroke="transparent" stroke-width="15"/><path d="${geo.d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="${D.meta.diffOverlay?.edges[e.id] === 'removed' ? '8 5' : e.status === 'Implemented' ? DASH[e.type] : '6 4'}" marker-end="url(#${dc ? 'diff-arrow-' + D.meta.diffOverlay.edges[e.id] : 'arrow-' + D.meta.relations.indexOf(e.type)})"/><rect x="${geo.lx - labelW / 2}" y="${geo.ly - 11}" width="${labelW}" height="17" rx="4" fill="#f7f9f6" opacity=".96"/><text x="${geo.lx}" y="${geo.ly + 1}" text-anchor="middle" fill="${color}" font-size="11">${esc(label)}</text></g>`;
      })
      .join('');
    $('defs')
      .querySelectorAll('[data-diff-marker]')
      .forEach((e) => e.remove());
    $('defs').insertAdjacentHTML(
      'beforeend',
      Object.entries(DIFF)
        .map(
          ([k, v]) =>
            `<marker data-diff-marker id="diff-arrow-${k}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${v.color}"/></marker>`,
        )
        .join(''),
    );
    $('empty').hidden = state.renderNodes.length !== 0;
  }
  function measure(s, size) {
    return [...s].reduce(
      (v, c) => v + (c.charCodeAt(0) > 255 ? size : size * 0.55),
      0,
    );
  }
  function truncate(s, width, size) {
    let out = '';
    for (const c of s) {
      if (measure(out + c, size) > width - 10) return out + '…';
      out += c;
    }
    return out;
  }
  function wrap(s, width, size, limit) {
    const lines = [''];
    for (const c of s) {
      if (measure(lines.at(-1) + c, size) > width) {
        if (lines.length >= limit) {
          lines[lines.length - 1] = truncate(lines.at(-1) + '…', width, size);
          break;
        }
        lines.push('');
      }
      lines[lines.length - 1] += c;
    }
    return lines;
  }
  function route(a, b, index, nodes) {
    const effective = (n) => ({ ...n, h: n.container ? 68 : n.h });
    a = effective(a);
    b = effective(b);
    const gap = 22 + index * 16;
    function ports(n) {
      const offset = Math.min(n.h / 2 - 12, index * 19);
      return [
        { x: n.x, y: n.y + n.h / 2 + offset, dx: -1, dy: 0 },
        { x: n.x + n.w, y: n.y + n.h / 2 + offset, dx: 1, dy: 0 },
        { x: n.x + n.w / 2 + offset, y: n.y, dx: 0, dy: -1 },
        { x: n.x + n.w / 2 + offset, y: n.y + n.h, dx: 0, dy: 1 },
      ];
    }
    const obstacles = nodes
      .filter((n) => !n.container)
      .map((n) => ({
        x: n.x - 6,
        y: n.y - 6,
        w: n.w + 12,
        h: n.h + 12,
        id: n.id,
      }));
    function intersects(p, q, r) {
      if (p.x === q.x)
        return (
          p.x > r.x &&
          p.x < r.x + r.w &&
          Math.max(p.y, q.y) > r.y &&
          Math.min(p.y, q.y) < r.y + r.h
        );
      return (
        p.y > r.y &&
        p.y < r.y + r.h &&
        Math.max(p.x, q.x) > r.x &&
        Math.min(p.x, q.x) < r.x + r.w
      );
    }
    let best = null;
    for (const p of ports(a))
      for (const q of ports(b)) {
        const so = { x: p.x + p.dx * gap, y: p.y + p.dy * gap },
          to = { x: q.x + q.dx * gap, y: q.y + q.dy * gap };
        const xs = [
          (so.x + to.x) / 2,
          Math.min(a.x, b.x) - gap,
          Math.max(a.x + a.w, b.x + b.w) + gap,
          so.x,
          to.x,
        ];
        const ys = [
          (so.y + to.y) / 2,
          Math.min(a.y, b.y) - gap,
          Math.max(a.y + a.h, b.y + b.h) + gap,
          so.y,
          to.y,
        ];
        const paths = [
          ...xs.map((x) => [p, so, { x, y: so.y }, { x, y: to.y }, to, q]),
          ...ys.map((y) => [p, so, { x: so.x, y }, { x: to.x, y }, to, q]),
        ];
        for (let pts of paths) {
          pts = pts.filter(
            (r, i) => !i || r.x !== pts[i - 1].x || r.y !== pts[i - 1].y,
          );
          let cost = 0,
            bestSeg = null;
          for (let i = 1; i < pts.length; i++) {
            const u = pts[i - 1],
              v = pts[i],
              len = Math.abs(u.x - v.x) + Math.abs(u.y - v.y);
            cost += len;
            for (const r of obstacles) {
              if (
                (i === 1 && r.id === a.id) ||
                (i === pts.length - 1 && r.id === b.id)
              )
                continue;
              if (intersects(u, v, r)) cost += 10000;
            }
            const horizontal = u.y === v.y;
            const quality = horizontal ? len : len * 0.35;
            if (!bestSeg || quality > bestSeg.quality)
              bestSeg = { u, v, len, horizontal, quality };
          }
          cost += pts.length * 12;
          if (!best || cost < best.cost) {
            const seg = bestSeg;
            best = {
              cost,
              d: pts.map((r, i) => `${i ? 'L' : 'M'} ${r.x} ${r.y}`).join(' '),
              lx: (seg.u.x + seg.v.x) / 2,
              ly: (seg.u.y + seg.v.y) / 2 - (seg.horizontal ? 5 : 0),
              labelWidth: seg.horizontal
                ? Math.max(45, Math.min(225, seg.len - 10))
                : 115,
            };
          }
        }
      }
    return best;
  }
  function transform() {
    $('viewport').setAttribute(
      'transform',
      `translate(${state.tx} ${state.ty}) scale(${state.zoom})`,
    );
    $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  }
  function fit() {
    const { width, height } = $('canvas').getBoundingClientRect();
    state.zoom = Math.min(
      1.25,
      (width - 35) / state.box.w,
      (height - 65) / state.box.h,
    );
    state.zoom = Math.max(0.12, state.zoom);
    state.tx = (width - state.box.w * state.zoom) / 2;
    state.ty = (height - state.box.h * state.zoom) / 2 - 12;
    transform();
  }
  function zoom(f, cx, cy) {
    const r = $('canvas').getBoundingClientRect();
    cx ??= r.width / 2;
    cy ??= r.height / 2;
    const prev = state.zoom;
    state.zoom = Math.max(0.12, Math.min(2.8, state.zoom * f));
    state.tx = cx - ((cx - state.tx) * state.zoom) / prev;
    state.ty = cy - ((cy - state.ty) * state.zoom) / prev;
    transform();
  }
  function updateHeader() {
    const tour = D.tours.find((t) => t.id === state.tour);
    $('viewTitle').textContent = state.selected
      ? N.get(state.selected).label + ' · 直接上下游'
      : tour
        ? tour.label
        : state.focus
          ? N.get(state.focus).label
          : '全局总览';
    $('viewNote').textContent = state.selected
      ? '只展示直接关系；淡色为同组件其他接口。点击上下游继续追踪。'
      : tour
        ? tour.summary
        : state.focus
          ? '点击组件展开接口；外围模块保留跨模块关系。'
          : state.allEdges
            ? '显示当前筛选下全部已收录关系；实线调用、虚线数据流、点线事件，返回值不等于执行成功。'
            : '仅显示主要链路；部分回执、管理与辅助关系已折叠。勾选“全部可见关系”查看；没有箭头不代表没有返回。';
    if (
      D.meta.diffOverlay &&
      !state.selected &&
      !state.tour &&
      state.diffOverview
    ) {
      $('viewTitle').textContent = '增删同图 · 保留相关模块完整接口';
      $('viewNote').textContent =
        '普通样式＝未修改；绿色＋新增、红色虚线－删除、土黄色～修改。相关模块已展开，其余模块可展开查看；点接口看上下游。';
    }
    $('clearSelection').hidden = !state.selected && !state.tour;
    $('stats').textContent =
      `当前 ${state.renderNodes.length} 节点 / ${state.renderEdges.length} 连线 · ${D.edges.length} 条${D.meta.overlayOverview ? '对照关系（含已删除旧线）' : '已收录关系'}`;
    $('tours')
      .querySelectorAll('button')
      .forEach((b) =>
        b.classList.toggle('active', b.dataset.tour === state.tour),
      );
  }
  function intro() {
    if (D.meta.overlayOverview) {
      $('detail').innerHTML =
        '<h2>同图看增删</h2><p>红色节点和连线是本方案已移除的旧内容，保留在这里供对照。它们不属于修改后的方案。</p><p>相关模块保留全部接口，普通样式表示未修改。绿色为新增，土黄色为修改。其余模块可在左侧展开；点接口看上下游，点顶部“增删同图”返回完整对照。</p>';
      return;
    }
    const interfaces = D.nodes.filter((n) => n.kind === 'interface').length;
    $('detail').innerHTML =
      `<span class="eyebrow">从模块走到真实调用</span><h2 class="intro-title">先看全貌，<br>再追一条链路。</h2><p class="description">这张图以源码为依据，把组件归属、函数调用、数据流和事件分开。先点击“个性化记忆”，或直接搜索 <code>retrieve</code>。</p><div class="intro-stats"><div><span class="intro-number">${M.length}</span><small>模块</small></div><div><span class="intro-number">${interfaces}</span><small>接口与调用点</small></div><div><span class="intro-number">${D.edges.length}</span><small>关系</small></div></div><h3>建议从这里开始</h3>${nodeLink('mem.retrieve', 'MemorySession → retrieve 的调用方、返回值和下游')}<div class="card">${statusBadge('Implemented')}<p>本地源码可核验。仅表示静态实现存在，不表示已通过真实模型联调。</p>${statusBadge('Proposed')}<p>文档中的接入建议，使用虚线，不当作现成 API。</p>${statusBadge('Unverified')}<p>证据不足的事项放在清单里，不画成确定调用。</p></div><h3>读图约定</h3><p>包含与定义通过模块容器、组件及左侧缩进表达；带箭头的线只表示所选关系类型。</p><p class="muted">接口不是完整清单；没有连线不代表源码中绝无关联。点击连线可查看具体证据。</p>`;
  }
  function detailNode(n) {
    const parent = N.get(n.parent),
      incoming = D.edges.filter((e) => e.target === n.id),
      outgoing = D.edges.filter((e) => e.source === n.id);
    const calls = incoming.filter((e) => e.type === 'Calls'),
      consumers = outgoing.filter((e) => e.type === 'Data Flow');
    $('detail').innerHTML =
      `<span class="eyebrow">${esc(N.get(n.module).label)}</span><h2>${esc(n.label)}</h2>${diffNode(n) ? `<p class="diff-detail-note" style="border-left:4px solid ${diffNode(n).color};padding:10px;background:${diffNode(n).fill}">${diffNode(n).label}${D.meta.diffOverlay.nodes[n.id] === 'removed' ? ' · 保留旧内容供对比，已不属于修改后的方案；下方包含旧关联。' : ' · 此处为方案对比，关系包含增删参考项。'}</p>` : ''}${statusBadge(n.status)}${n.visibility ? `<span class="badge">${esc(n.visibility)}</span>` : ''}<p class="description">${esc(n.summary)}</p>${parent ? `<p class="muted">所属${parent.kind === 'module' ? '模块' : '组件'}：${esc(parent.label)}${parent.componentType ? ' · ' + esc(parent.componentType) : ''}</p>` : ''}${
        n.signature
          ? `<h3>函数与签名</h3><pre>${esc(n.signature)}</pre><p class="muted">${esc(n.signatureNote)}</p><h3>Input · 输入</h3><p>${esc(n.input)}</p><h3>Output · 返回与状态变化</h3><p>${esc(n.output)}</p><h3>错误与取消</h3><p>${esc(n.errors)}</p>`
          : `<h3>${n.kind === 'module' ? '包含的组件' : '定义的接口与调用点'}</h3>${kids(
              n.id,
            )
              .filter((c) => state.proposed || c.status !== 'Proposed')
              .map((c) => nodeLink(c.id))
              .join('')}`
      }<h3>Caller · 调用方（以关系状态为准）</h3>${calls.length ? calls.map((e) => nodeLink(e.source, e.label)).join('') : '<p class="muted">此图未收录直接调用方。事件入口请看下方关系；不代表全仓库没有调用。</p>'}<h3>Consumer · 数据使用方</h3>${consumers.length ? consumers.map((e) => nodeLink(e.target, e.label)).join('') : '<p class="muted">未单列返回数据消费者；可沿调用、状态变化和事件关系继续查看。</p>'}<h3>直接上游与下游</h3>${[...incoming, ...outgoing].map((e) => `<button class="link-node" data-edge="${e.id}">${esc(e.type)} · ${esc(N.get(e.source).label)} → ${esc(N.get(e.target).label)}<span>${esc(e.label)} · ${e.status}</span></button>`).join('') || '<p class="muted">展开内部接口查看具体连接。</p>'}<h3>定义与源码证据</h3>${evidenceLinks(n.evidence)}`;
  }
  function detailEdge(e) {
    const list = e.originals ? e.originals.map((id) => E.get(id)) : [e];
    $('detail').innerHTML =
      `<span class="eyebrow">关系证据</span><h2>${esc(N.get(e.source).label)} → ${esc(N.get(e.target).label)}</h2><p class="description">${list.length > 1 ? '这是折叠后的汇总线。下面每条关系保留各自类型和证据，不表示模块之间存在一个同名函数。' : esc(e.label)}</p>${list.map((x) => `<div class="card">${diffEdge(x) ? `<p style="color:${diffEdge(x).color}">${diffEdge(x).label}${D.meta.diffOverlay.edges[x.id] === 'removed' ? ' · 旧连线，仅作对照' : ''}</p>` : ''}${statusBadge(x.status)}<strong style="font-size:12px;color:${COLORS[x.type]}">${esc(x.type)}</strong><p>${esc(x.label)}</p>${nodeLink(x.source, '起点 · ' + N.get(x.source).module)}${nodeLink(x.target, '终点 · ' + N.get(x.target).module)}${evidenceLinks(x.evidence)}</div>`).join('')}`;
  }
  function showUnknown() {
    $('detail').innerHTML =
      `<span class="eyebrow">证据边界</span><h2>仍待确认的关系</h2><p class="description">没有足够源码证据的研究问题保留在这里，不绘制成确定的调用箭头。</p>${D.unverified.map((u) => `<div class="card">${statusBadge('Unverified')}<h3>${esc(u.title)}</h3><p>${esc(u.detail)}</p>${evidenceLinks(u.evidence)}</div>`).join('')}<h3>文档提出的接入建议</h3>${D.nodes
        .filter((n) => n.status === 'Proposed')
        .map((n) => nodeLink(n.id))
        .join('')}`;
  }
  function about() {
    $('detail').innerHTML =
      `<span class="eyebrow">版本与维护</span><h2>以证据确定连线</h2><p>核验日期：${D.meta.date}</p><pre>${esc(D.meta.referenceCommit)}</pre><p>${esc(D.meta.sourceBasis)}</p><div class="card"><p>模块协作意图见 docs/interface-map/proposals.md；提案与源码事实分别保存。</p><p>${esc(D.meta.scope)}</p></div><h3>更新方式</h3><p>在同一个 PR 中修改 tools/interface-map/data/graph.json 的节点、关系与证据，运行 npm run map:check、map:test、map:lint 和 map:build。源码片段、行号和文件哈希一起更新；不要只改图上的标题。</p><h3>可离线使用</h3><p>本页面无远程依赖，不调用业务模型。本地展示已记录版本的只读证据片段；公开版只保留定位链接。路径为仓库相对路径。</p><p class="muted">更换仓库版本后需重新阅读调用点并检查关系语义；锚点仍存在不等于关系仍正确。</p>`;
  }
  function showSource(id) {
    const e = D.evidence[id];
    sourceRef = e;
    $('sourceTitle').textContent =
      e.kind === 'source'
        ? `${e.path.split('/').at(-1)} · L${e.line}–${e.endLine}`
        : '协作提案 · 原文段落 ' + e.paragraph;
    $('sourceLocation').textContent =
      e.path + (e.reviewState ? ' · ' + e.reviewState : '');
    $('githubLink').hidden = e.kind !== 'source' || !e.url;
    $('githubLink').href = e.url || '#';
    $('sourceCode').textContent = window.MAP_PUBLIC
      ? e.kind === 'source'
        ? '分享版不打包或展示业务源码。请通过 GitHub 固定版本链接查看，需要自己的私有仓库权限。'
        : '分享版不附内部提案原文，请向维护者索取。'
      : (e.reviewNote ? e.reviewNote + '\n\n' : '') +
        (e.quote || '此项无可核验片段，请核对固定版本。');
    $('sourceDialog').showModal();
  }
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function exportedSVG() {
    const svg = $('graph').cloneNode(true);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', state.box.w);
    svg.setAttribute('height', state.box.h);
    svg.setAttribute('viewBox', `0 0 ${state.box.w} ${state.box.h}`);
    svg.querySelector('#viewport').removeAttribute('transform');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#f7f9f6');
    svg.insertBefore(bg, svg.firstChild);
    svg
      .querySelectorAll('[tabindex]')
      .forEach((n) => n.removeAttribute('tabindex'));
    const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
    desc.textContent = `VoiceHarness ${D.meta.referenceCommit}; ${D.meta.sourceBasis}; hierarchy=containers, arrows=typed relations.`;
    svg.insertBefore(desc, svg.firstChild);
    return new XMLSerializer().serializeToString(svg);
  }
  async function exportFile(type) {
    if (!type) return;
    const stamp = D.meta.referenceCommit.slice(0, 7);
    if (type === 'json')
      download(
        JSON.stringify(D, null, 2),
        `voiceharness-${stamp}.json`,
        'application/json',
      );
    if (type === 'svg')
      download(exportedSVG(), `voiceharness-${stamp}.svg`, 'image/svg+xml');
    if (type === 'mermaid') {
      const ids = new Map(state.renderNodes.map((n, i) => [n.id, `n${i}`]));
      const lines = [
        'flowchart LR',
        `%% commit ${D.meta.referenceCommit}`,
        `%% 导出当前可见节点；包含/定义归属请查完整 JSON hierarchy。`,
      ];
      for (const n of state.renderNodes)
        lines.push(
          `  ${ids.get(n.id)}["${(diffNode(n)?.label || '') + ' ' + n.label.replace(/["<>]/g, ' ')} (${n.status})"]`,
        );
      for (const e of state.renderEdges)
        lines.push(
          `  ${ids.get(e.source)} ${e.status === 'Proposed' ? '-.->' : '-->'}|"${diffEdge(e)?.label || ''} ${e.type}: ${e.label.replace(/["<>|]/g, ' ')}"| ${ids.get(e.target)}`,
        );
      download(lines.join('\n'), 'voiceharness-view.mmd', 'text/plain');
    }
    if (type === 'png') {
      const xml = exportedSVG(),
        url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' })),
        img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas'),
          scale = Math.min(2, 8192 / Math.max(state.box.w, state.box.h));
        canvas.width = Math.round(state.box.w * scale);
        canvas.height = Math.round(state.box.h * scale);
        canvas
          .getContext('2d')
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) throw Error('PNG 无法生成');
        download(blob, `voiceharness-${stamp}.png`, 'image/png');
      } catch {
        toast('PNG 导出失败，可先导出 SVG。');
        return;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    toast('已导出 ' + type.toUpperCase());
    $('export').value = '';
  }
  // Initialization and accessible delegated actions.
  $('defs').innerHTML = D.meta.relations
    .map(
      (t, i) =>
        `<marker id="arrow-${i}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8 Z" fill="${COLORS[t]}"/></marker>`,
    )
    .join('');
  $('version').textContent = D.meta.modeLabel
    ? `${D.meta.modeLabel} · ${D.meta.referenceCommit.slice(0, 12)}`
    : `${D.meta.referenceCommit.slice(0, 7)} · ${D.meta.date} 静态核验`;
  $('nodeCount').textContent = D.nodes.length + ' 节点';
  $('focus').insertAdjacentHTML(
    'beforeend',
    M.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join(''),
  );
  $('relations').innerHTML = D.meta.relations
    .map(
      (t) =>
        `<label><input type="checkbox" data-rel="${t}" checked><i class="swatch" style="border-color:${COLORS[t]};border-top-style:${DASH[t] ? 'dashed' : 'solid'}"></i>${t}</label>`,
    )
    .join('');
  $('tours').innerHTML = D.tours
    .map((t) => `<button data-tour="${t.id}">${esc(t.label)}</button>`)
    .join('');
  document.addEventListener('click', (e) => {
    let t = e.target.closest('[data-evidence]');
    if (t) {
      showSource(t.dataset.evidence);
      return;
    }
    t = e.target.closest('[data-node]');
    if (t) {
      choose(t.dataset.node);
      return;
    }
    t = e.target.closest('[data-focus]');
    if (t) {
      focus(t.dataset.focus);
      return;
    }
    t = e.target.closest('[data-expand]');
    if (t) {
      toggleModule(t.dataset.expand);
      return;
    }
    t = e.target.closest('[data-edge]');
    if (t) {
      detailEdge(E.get(t.dataset.edge));
      return;
    }
    t = e.target.closest('[data-tour]');
    if (t) {
      state.tour = t.dataset.tour;
      state.selected = null;
      state.focus = '';
      $('focus').value = '';
      render(true);
      const tour = D.tours.find((x) => x.id === state.tour);
      $('detail').innerHTML =
        `<span class="eyebrow">验证路径</span><h2>${esc(tour.label)}</h2><p class="description">${esc(tour.summary)}</p><p class="muted">下面为研究入口列表，不意味着相邻两项一定直接调用；实际连接以图中有证据的箭头为准。</p>${tour.nodes.map((id) => nodeLink(id)).join('')}`;
      return;
    }
  });
  $('tree').addEventListener(
    'toggle',
    (e) => {
      const id = e.target.dataset.component;
      if (!id) return;
      const open = e.target.open;
      if (state.components.has(id) === open) return;
      if (open) state.components.add(id);
      else state.components.delete(id);
      state.selected = null;
      state.tour = '';
      render(true);
      detailNode(N.get(id));
    },
    true,
  );
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    updateTree();
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('tree').querySelector('[data-node]')?.click();
  });
  $('relations').addEventListener('change', (e) => {
    const t = e.target.dataset.rel;
    if (e.target.checked) state.filters.add(t);
    else state.filters.delete(t);
    render(false);
  });
  $('proposed').onchange = (e) => {
    state.proposed = e.target.checked;
    if (
      state.selected &&
      N.get(state.selected).status === 'Proposed' &&
      !state.proposed
    )
      state.selected = null;
    render(true);
  };
  $('allEdges').onchange = (e) => {
    state.allEdges = e.target.checked;
    render(true);
  };
  $('focus').onchange = (e) => focus(e.target.value);
  $('overview').onclick = overview;
  $('collapseAll').onclick = overview;
  $('expandAll').onclick = () => {
    state.expanded = new Set(M.map((m) => m.id));
    state.components = new Set(
      D.nodes.filter((n) => n.kind === 'component').map((n) => n.id),
    );
    state.focus = '';
    state.selected = null;
    state.tour = '';
    $('focus').value = '';
    render(true);
    toast('全部展开；建议聚焦单个模块，或搜索接口。');
  };
  function setPageFullscreen(enabled) {
    $('graphPanel').classList.toggle('page-fullscreen', enabled);
    document.body.classList.toggle('graph-fullscreen', enabled);
    $('fullscreen').setAttribute('aria-pressed', String(enabled));
    $('fullscreen').textContent = enabled ? '退出全屏（Esc）' : '网页全屏 ⛶';
    $('fullscreen').title = enabled
      ? '退出全屏，恢复两侧面板'
      : '让关系图占满网页，按 Esc 退出';
    requestAnimationFrame(fit);
  }
  $('fullscreen').onclick = () =>
    setPageFullscreen(!$('graphPanel').classList.contains('page-fullscreen'));
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      !$('sourceDialog').open &&
      $('graphPanel').classList.contains('page-fullscreen')
    ) {
      setPageFullscreen(false);
      $('fullscreen').focus();
    }
  });
  $('layout').onclick = () => render(true);
  $('fit').onclick = fit;
  $('zoomIn').onclick = () => zoom(1.2);
  $('zoomOut').onclick = () => zoom(1 / 1.2);
  $('about').onclick = about;
  $('unknown').onclick = showUnknown;
  $('clearSelection').onclick = () => {
    state.selected = null;
    state.tour = '';
    render(true);
    intro();
  };
  $('export').onchange = (e) => exportFile(e.target.value);
  $('closeSource').onclick = () => $('sourceDialog').close();
  $('copyPath').onclick = async () => {
    const e = sourceRef;
    const path =
      e.kind === 'source'
        ? `${e.path}:${e.line}`
        : `${e.path}（段落${e.paragraph}）`;
    try {
      await navigator.clipboard.writeText(path);
      toast('路径已复制');
    } catch {
      const t = document.createElement('textarea');
      t.value = path;
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
      toast('路径已复制');
    }
  };
  $('canvas').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = $('canvas').getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  $('graph').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.graph-node'),
      n = el && state.renderNodes.find((n) => n.id === el.dataset.id);
    drag = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      tx: state.tx,
      ty: state.ty,
      n,
      nodeX: n?.x,
      nodeY: n?.y,
      moved: false,
    };
    $('graph').setPointerCapture(e.pointerId);
  });
  $('graph').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX,
      dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.n) {
      if (!drag.moved) return;
      const n = drag.n,
        moveX = dx / state.zoom,
        moveY = dy / state.zoom;
      const oldX = n.x,
        oldY = n.y;
      n.x = Math.max(0, drag.nodeX + moveX);
      n.y = Math.max(0, drag.nodeY + moveY);
      if (n.container)
        for (const child of state.renderNodes.filter(
          (c) => c.module === n.id && c.id !== n.id,
        )) {
          child.x += n.x - oldX;
          child.y += n.y - oldY;
          state.positions.set(child.id, { x: child.x, y: child.y });
        }
      state.positions.set(n.id, { x: n.x, y: n.y });
      state.box = {
        w: Math.max(800, ...state.renderNodes.map((v) => v.x + v.w)) + 30,
        h: Math.max(430, ...state.renderNodes.map((v) => v.y + v.h)) + 40,
      };
      draw();
    } else {
      state.tx = drag.tx + dx;
      state.ty = drag.ty + dy;
      transform();
    }
  });
  $('graph').addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (d.n) choose(d.n.id);
      else {
        const hit = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest('[data-edge-index]');
        if (hit) detailEdge(state.renderEdges[Number(hit.dataset.edgeIndex)]);
      }
    }
  });
  $('graph').addEventListener('pointercancel', () => {
    drag = null;
  });
  $('graph').addEventListener('keydown', (e) => {
    const n = e.target.closest('.graph-node');
    if (n && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      choose(n.dataset.id);
    }
  });
  new ResizeObserver(() => fit()).observe($('canvas'));
  render(true);
  intro();
  // Read-only state for regression checks and local inspection.
  function replaceGraph(next) {
    Object.assign(D, structuredClone(next));
    N.clear();
    D.nodes.forEach((n) => N.set(n.id, n));
    E.clear();
    D.edges.forEach((e) => E.set(e.id, e));
    M.splice(0, M.length, ...D.nodes.filter((n) => n.kind === 'module'));
    state.positions.clear();
    state.proposed = D.meta.modeLabel === '模拟草稿 · 未改业务代码';
    $('proposed').checked = state.proposed;
    $('focus').innerHTML =
      '<option value="">选择模块聚焦…</option>' +
      M.map(
        (m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`,
      ).join('');
    $('nodeCount').textContent = D.nodes.length + ' 节点';
    $('version').textContent =
      (D.meta.modeLabel || '已核验基线') +
      ' · ' +
      D.meta.referenceCommit.slice(0, 12);
    overview();
  }
  window.interfaceMap = {
    data: D,
    replaceGraph,
    getState: () => ({
      selected: state.selected,
      focus: state.focus,
      tour: state.tour,
      zoom: state.zoom,
      visibleNodes: state.renderNodes.map((n) => n.id),
      visibleEdges: state.renderEdges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        originals: e.originals,
      })),
    }),
    select: choose,
    overview,
    exportFile,
  };
})();
