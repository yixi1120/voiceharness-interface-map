'use strict';
(() => {
  const labels = {
    label: '名称',
    kind: '类型',
    module: '模块',
    parent: '所属组件',
    summary: '说明',
    signature: '签名',
    input: '输入',
    output: '输出',
    errors: '错误及取消',
    source: '起点',
    target: '终点',
    type: '关系类型',
  };
  const names = { added: '新增', modified: '修改', removed: '删除' };
  const blank = { removedNodes: [], removedEdges: [] };
  const esc = (s) => window.mapWorkbench.escapeText(s);
  function delta(before, after, draft = blank) {
    return window.ScenarioCompare.calculate(before, after, draft)
      .rows.map((row) => ({
        ...row,
        changed: row.changed.filter((k) => Object.hasOwn(labels, k)),
      }))
      .filter(
        (row) =>
          row.type !== 'review' &&
          (row.type !== 'modified' || row.changed.length),
      );
  }
  function relation(a, b) {
    if (a.group === b.group && a.id === b.id) {
      if (a.type === 'removed' && b.type === 'removed') return '一致';
      if (a.type === 'removed' || b.type === 'removed') return '需要核对';
      const common = a.changed.filter((k) => b.changed.includes(k));
      if (common.some((k) => a.after[k] !== b.after[k])) return '需要核对';
      if (
        a.type === 'added' &&
        b.type === 'added' &&
        a.changed.length !== b.changed.length
      )
        return '需要核对';
      if (
        a.type === b.type &&
        a.changed.length === b.changed.length &&
        common.length === a.changed.length
      )
        return '一致';
      return '改到同一处';
    }
    if (
      a.group === 'nodes' &&
      b.group === 'nodes' &&
      a.after?.kind === 'interface' &&
      b.after?.kind === 'interface' &&
      (a.type === 'added' || b.type === 'added') &&
      a.after.parent &&
      a.after.parent === b.after.parent &&
      a.after.label?.trim() &&
      a.after.label.trim() === b.after.label?.trim()
    )
      return '同一组件内接口同名，请确认';
    // A removed or rewired link can affect its previous endpoint as well.
    function references(row, id) {
      return [row.before, row.after].some(
        (x) =>
          x &&
          (row.group === 'edges'
            ? x.source === id || x.target === id
            : x.parent === id),
      );
    }
    if (
      (a.group === 'nodes' && references(b, a.id)) ||
      (b.group === 'nodes' && references(a, b.id))
    )
      return '涉及上下游';
    if (
      a.group === 'edges' &&
      b.group === 'edges' &&
      a.after &&
      b.after &&
      a.after.source === b.after.source &&
      a.after.target === b.after.target &&
      a.after.type === b.after.type
    )
      return '连线可能重复';
    return '';
  }
  function describe(row) {
    const field = (value) => (value == null || value === '' ? '未填写' : value);
    const item = row.after || row.before;
    const text =
      row.type === 'modified'
        ? row.changed
            .map(
              (k) =>
                labels[k] +
                '：' +
                field(row.before[k]) +
                ' → ' +
                field(row.after[k]),
            )
            .join('；')
        : row.group === 'edges'
          ? item.source + ' → ' + item.target
          : [
              item.signature || item.summary,
              ...['input', 'output', 'errors']
                .filter((k) => item[k])
                .map((k) => labels[k] + '：' + field(item[k])),
            ]
              .filter(Boolean)
              .join('；');
    return (
      names[row.type] +
      ' ' +
      item.label +
      '（' +
      row.id +
      '）' +
      (text ? ' · ' + text : '')
    );
  }
  function directLinks(graphs) {
    const links = new Map();
    for (const graph of graphs) {
      for (const edge of graph.edges) {
        if (edge.status !== 'Implemented') continue;
        const key = JSON.stringify([edge.source, edge.target].sort());
        links.set(key, edge);
      }
    }
    return links;
  }
  function changesContract(row) {
    return (
      row.group === 'nodes' &&
      (row.after || row.before).kind === 'interface' &&
      (row.type === 'removed' ||
        row.changed.some((k) =>
          ['signature', 'input', 'output', 'errors'].includes(k),
        ))
    );
  }
  function compare(mine, other, links = new Map()) {
    const rows = [];
    for (const a of mine)
      for (const b of other) {
        const reason = relation(a, b);
        if (reason) rows.push({ a, b, reason });
        else if (
          a.group === 'nodes' &&
          b.group === 'nodes' &&
          (changesContract(a) || changesContract(b))
        ) {
          const link = links.get(JSON.stringify([a.id, b.id].sort()));
          if (link) rows.push({ a, b, reason: '涉及上下游', link });
        }
      }
    return rows;
  }

  async function inspect(issue, draft, get, parseIssue) {
    const warnings = new Set(),
      issues = new Map(),
      sections = [];
    const wb = window.mapWorkbench,
      contracts = window.teamContracts;
    let latest;
    try {
      const r = await fetch(new URL('data/graph.json', document.baseURI), {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw Error();
      latest = await r.json();
      if (
        !latest?.meta?.referenceCommit ||
        !Array.isArray(latest.nodes) ||
        !Array.isArray(latest.edges)
      )
        throw Error();
    } catch {
      latest = window.mapBaselineByCommit(window.MAP_CURRENT_BASE);
      if (!latest) throw Error('最新底图无法读取，请刷新重试。');
      warnings.add('未能刷新最新底图，使用本页载入的版本。');
    }
    const baseline = (commit) =>
      latest.meta.referenceCommit === commit
        ? latest
        : window.mapBaselineByCommit(commit);
    const checkDraft = (d) => {
      const base = baseline(d.baseCommit);
      if (!base) throw Error('没有归档底图 ' + d.baseCommit.slice(0, 7));
      return delta(base, wb.scenario(d, base), d);
    };
    try {
      for (let page = 1; ; page++) {
        const result = await get(
          '/issues?state=all&sort=created&direction=desc&per_page=50&page=' +
            page,
          true,
        );
        if (result.stale)
          warnings.add('共享方案列表使用了旧缓存，请稍后重查。');
        for (const item of result.data)
          if (!item.pull_request) issues.set(item.number, item);
        if (result.data.length < 50) break;
      }
    } catch (e) {
      warnings.add('未能读取全部共享方案。' + e.message);
    }
    const fresh = issues.get(issue.number);
    if (fresh) {
      const updated = parseIssue(fresh);
      if (!updated || JSON.stringify(updated) !== JSON.stringify(draft))
        throw Error('这份方案刚刚发生变化，请返回方案，刷新后再查。');
    }
    const mine = checkDraft(draft),
      base = baseline(draft.baseCommit);
    const otherBaselines = delta(base, latest);
    const people = Object.assign(
      {},
      window.interfaceReview.ownersFor(draft.baseCommit),
      window.interfaceReview.ownersFor(latest.meta.referenceCommit),
    );
    const modules = new Map(
      [...base.nodes, ...latest.nodes, ...draft.nodes].map((n) => [n.id, n]),
    );
    const actor = (i) => (i?.user?.login ? '@' + i.user.login : '');
    function block(title, source, rows, contact, extras = []) {
      const index = new Map(modules);
      for (const n of extras) index.set(n.id, n);
      const entry = ({ a, b, reason, link }) => {
        const mids = new Set();
        for (const row of [a, b]) {
          for (const x of [row.before, row.after].filter(Boolean)) {
            const ids =
              row.group === 'nodes'
                ? [x.module || x.id]
                : [index.get(x.source)?.module, index.get(x.target)?.module];
            for (const id of ids) if (id) mids.add(id);
          }
        }
        const owners = [...mids].map(
          (id) =>
            (index.get(id)?.label || id) +
            '：' +
            ((Object.hasOwn(people, id) && people[id]) || '负责人待登记'),
        );
        const contacts = [
          ...new Set(
            [
              actor(issue) && '本方案 ' + actor(issue),
              contact && '对方方案 ' + contact,
              ...owners,
            ].filter(Boolean),
          ),
        ].join('、');
        return (
          '<li><strong>' +
          esc(reason + ' · ' + (a.after || a.before).label) +
          '</strong><p>本方案：' +
          esc(describe(a)) +
          '</p><p>' +
          esc(source) +
          '：' +
          esc(describe(b)) +
          '</p>' +
          (link
            ? '<p>直接连线：' +
              esc(
                link.source + ' → ' + link.target + '（' + link.label + '）',
              ) +
              '</p>'
            : '') +
          (reason === '一致' ? '' : '<p>找谁核对：' + esc(contacts) + '</p>') +
          '</li>'
        );
      };
      const relevant = rows.filter((r) => r.reason !== '一致'),
        equal = rows.filter((r) => r.reason === '一致');
      return (
        '<h3>' +
        esc(title) +
        '</h3>' +
        (relevant.length
          ? '<ul>' + relevant.map(entry).join('') + '</ul>'
          : '<p>未发现需要协调的重叠。</p>') +
        (equal.length
          ? '<details><summary>' +
            equal.length +
            ' 处改动一致</summary><ul>' +
            equal.map(entry).join('') +
            '</ul></details>'
          : '')
      );
    }
    sections.push(
      block(
        '与最新底图对比',
        '最新底图',
        compare(mine, otherBaselines, directLinks([base, latest])),
        '',
      ),
    );
    let catalog = new Map();
    try {
      const r = await contracts.catalog();
      catalog = r.latest;
      if (r.archived)
        warnings.add('团队约定目录来自网站最近一次发布，可能有更新。');
    } catch (e) {
      warnings.add('团队约定目录未读全。' + e.message);
    }
    const checked = [];
    for (const n of new Set([...issues.keys(), ...catalog.keys()])) {
      if (n === issue.number) continue;
      const peer = issues.get(n);
      let current, approved;
      if (peer?.state === 'open') {
        try {
          current = parseIssue(peer);
          if (!current && peer.title?.startsWith('[模拟方案]'))
            warnings.add('#' + n + ' 缺少可读的草稿数据。');
        } catch (e) {
          warnings.add('#' + n + ' 草稿读取失败：' + e.message);
        }
      }
      if (catalog.has(n)) {
        try {
          approved = await contracts.record(n, catalog.get(n));
          if (!approved) throw Error('版本缺失');
        } catch (e) {
          warnings.add('#' + n + ' 已发布版本未能核对。' + e.message);
        }
      }
      const versions = [];
      if (approved?.draft && !contracts.isVerified(n, approved.version))
        versions.push(['已约定 v' + approved.version, approved.draft]);
      if (
        current &&
        JSON.stringify(current) !== JSON.stringify(approved?.draft) &&
        approved?.state !== 'withdrawn'
      )
        versions.push(['共享草稿', current]);
      for (const [state, d] of versions) {
        const tag = '#' + n + ' ' + state;
        try {
          const findings = compare(
            mine,
            checkDraft(d),
            directLinks([base, baseline(d.baseCommit), latest]),
          );
          checked.push(tag);
          if (findings.length)
            sections.push(
              block(
                tag + ' · ' + (peer?.title || approved?.title || ''),
                tag,
                findings,
                actor(peer),
                [...baseline(d.baseCommit).nodes, ...d.nodes],
              ),
            );
        } catch (e) {
          warnings.add(tag + ' 未能核对：' + e.message);
        }
      }
    }
    return (
      '<p>方案底图 <code>' +
      esc(draft.baseCommit.slice(0, 7)) +
      '</code> → 最新底图 <code>' +
      esc(latest.meta.referenceCommit.slice(0, 7)) +
      '</code></p>' +
      (warnings.size
        ? '<p role="status"><strong>部分检查未完成或使用缓存</strong></p><ul>' +
          [...warnings].map((s) => '<li>' + esc(s) + '</li>').join('') +
          '</ul>'
        : '') +
      sections[0] +
      '<h3>与其他方案对比</h3><p>已检查：' +
      esc(checked.join('、') || '无其他可比方案') +
      '。已标绿的改动随最新底图核对。</p>' +
      (sections.length === 1
        ? '<p>已检查的方案中未发现重叠。</p>'
        : sections.slice(1).join(''))
    );
  }
  window.proposalConflicts = { inspect, compare, directLinks };
})();
