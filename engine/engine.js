// system-diagram engine: renders window.__DIAGRAM__ (see references/schema.md).
// Plain browser JS, no dependencies. Every string from the data goes through esc(), fmt() or
// plain(); data never supplies raw HTML (panels are copied through an allowlist).
(function () {
  'use strict'
  const D = window.__DIAGRAM__
  const $ = (id) => document.getElementById(id)
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  // **bold** and `code`, nothing else. Code spans are cut out first so ** inside them stays literal.
  const fmt = (s) => {
    const codes = []
    const t = esc(String(s == null ? '' : s).replace(/\u0001/g, '')).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001' })
    return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[Number(i)] + '</code>')
  }
  // code locations are shown as code already, so their marks are dropped
  const codeText = (s) => esc(String(s == null ? '' : s).replace(/\*\*|`/g, ''))
  // for SVG text and attributes: the marks are dropped
  const plain = (s) => esc(String(s == null ? '' : s).replace(/\*\*|`/g, ''))
  const TOKENS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'accent', 'pos', 'neg', 'faint', 'muted', 'ink']
  const col = (c) => (TOKENS.includes(c) ? 'var(--' + c + ')' : /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c || '') ? c : 'var(--faint)')
  const num = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : d)
  const L = (tab, k, d) => (tab && tab.labels && tab.labels[k]) || d
  const textOf = (c) => (c && typeof c === 'object' ? c.text : c)
  // the panel fields a data file may set; anything else (html, after, legend...) is dropped
  const PANEL_KEYS = ['tag', 'title', 'text', 'callouts', 'refs', 'sections', 'where', 'notes', 'bullets', 'bulletsTitle', 'list', 'listTitle', 'links', 'linksTitle', 'foot']
  const clean = (p) => { const o = {}; if (p && typeof p === 'object') for (const k of PANEL_KEYS) if (p[k] != null) o[k] = p[k]; if (o.tag) o.tag = { text: o.tag.text, color: o.tag.color }; return o }

  // ---------- registry: every clickable thing, by id ----------
  const ENT = new Map()
  const REFBY = new Map()
  function addRefBy(r, from) { if (!REFBY.has(r)) REFBY.set(r, []); if (!REFBY.get(r).includes(from)) REFBY.get(r).push(from) }
  for (const tab of D.tabs) {
    if (tab.type === 'journey') {
      for (const it of arr(tab.items)) { it.links = arr(it.links).slice(); ENT.set(it.id, { tab, kind: 'item', obj: it, label: it.text }) }
      for (const e of arr(tab.edges && tab.edges.items)) { e.links = arr(e.links).slice(); ENT.set(e.id, { tab, kind: 'edge', obj: e, label: e.text }) }
      for (const l of arr(tab.lanes)) ENT.set(tab.id + ':lane:' + l.id, { tab, kind: 'lane', obj: l, label: l.name })
      if (tab.foot) ENT.set(tab.id + ':foot', { tab, kind: 'foot', obj: tab.foot, label: tab.foot.label })
    } else {
      for (const s of arr(tab.sections)) {
        if (s.type === 'graph') for (const n of arr(s.nodes)) ENT.set(n.id, { tab, kind: 'node', obj: n, label: n.refLabel || n.title, sub: n.refSub || n.sub })
        if (s.type === 'table') for (const r of arr(s.rows)) if (r.id) ENT.set(r.id, { tab, kind: 'row', obj: r, label: r.label || textOf(arr(r.cells)[0]) })
      }
    }
  }
  // links are symmetric: if A lists B, B shows A too (boxes and chips, across every tab)
  for (const tab of D.tabs) {
    if (tab.type !== 'journey') continue
    for (const src of arr(tab.items).concat(arr(tab.edges && tab.edges.items))) {
      for (const id of src.links) { const t = ENT.get(id); if (t && Array.isArray(t.obj.links) && !t.obj.links.includes(src.id)) t.obj.links.push(src.id) }
    }
    for (const it of arr(tab.items)) for (const r of arr(it.refs)) addRefBy(r, it.id)
  }
  // a panel that refers to something is listed on that thing too, like a box is
  for (const [id, e] of ENT) { const pnl = e.obj && e.obj.panel; if (pnl && typeof pnl === 'object') for (const r of arr(pnl.refs)) if (r !== id) addRefBy(r, id) }
  // every id named in any refs list, boxes and panels alike
  const ANYREF = new Set()
  ;(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const k in o) { if (k === 'refs') arr(o[k]).forEach((r) => ANYREF.add(r)); else walk(o[k]) } })(D.tabs)
  const clickableRow = (r) => !!(r.id && (r.panel || ANYREF.has(r.id)))

  const findTab = (id) => D.tabs.find((t) => t.id === id)
  const S = { tab: findTab(location.hash.slice(1)) || D.tabs[0], sel: null, lane: null }

  // ---------- panel ----------
  const paras = (t) => arr(t).map((x) => `<p>${fmt(x)}</p>`).join('')
  function whereHTML(list) { return list.length ? `<div class="where">${list.map((x) => `<code>${codeText(x)}</code>`).join('')}</div>` : '' }
  // a change in a list can say how far it got; partly built is never shown as built
  const BUILT = new Map([['built', 'Built'], ['partly', 'Partly built']])
  const builtPill = (st) => (BUILT.has(st) ? `<span class="pill ${st}">${BUILT.get(st)}</span> ` : '')
  function bulletsHTML(list) { return list.length ? `<ul>${list.map((b) => (b && typeof b === 'object' ? `<li>${builtPill(b.status)}${fmt(b.text)}${b.sub ? `<span class="sub">${fmt(b.sub)}</span>` : ''}</li>` : `<li>${fmt(b)}</li>`)).join('')}</ul>` : '' }
  function goList(ids) { const ok = ids.filter((id) => ENT.has(id)); return ok.length ? `<ul>${ok.map((id) => `<li><button class="lnk" data-go="${esc(id)}">${fmt(ENT.get(id).label)}</button></li>`).join('')}</ul>` : '' }
  function calloutHTML(c) {
    const tone = ['wait', 'gap', 'note', 'built'].includes(c.tone) ? c.tone : 'wait'
    return `<div class="callout ${tone}">${c.label ? `<span class="k">${fmt(c.label)}</span>` : ''}${arr(c.text).map(fmt).join('<br>')}</div>`
  }
  // the one panel renderer; `x` holds engine-made HTML (legend, tag, after), never data
  function panelHTML(p, tab, x) {
    x = x || {}
    let h = ''
    if (x.tagHTML) h += x.tagHTML
    else if (p.tag && p.tag.text) h += `<span class="tag" style="--c:${col(p.tag.color)}"><i></i>${fmt(p.tag.text)}</span>`
    if (p.title) h += `<h2 tabindex="-1">${fmt(p.title)}</h2>`
    if (x.lead) h += `<p><b>${fmt(x.lead)}</b></p>`
    h += paras(p.text)
    h += arr(p.callouts).map(calloutHTML).join('')
    const refs = arr(p.refs).filter((id) => ENT.has(id))
    if (refs.length) h += `<p>${refs.map((id) => { const e = ENT.get(id); return `<button class="lnk" data-go="${esc(id)}">${fmt(e.label)}</button>${e.sub ? ` <span class="mono muted">${fmt(e.sub)}</span>` : ''}` }).join('<br>')}</p>`
    if (arr(p.sections).length) {
      h += `<div class="sections">${arr(p.sections).map((s) => {
        const tone = ['gap', 'wait', 'built'].includes(s.tone) ? s.tone : ''
        const body = tone ? calloutHTML({ tone, label: s.label || { gap: 'Not built yet', wait: 'Waits on', built: 'Built so far' }[tone], text: s.text || '' }) : paras(s.text)
        return `${s.title ? `<h3>${fmt(s.title)}</h3>` : ''}${body}${whereHTML(arr(s.where))}${bulletsHTML(arr(s.notes).concat(arr(s.bullets)))}`
      }).join('')}</div>`
    }
    if (arr(p.where).length) h += `<h3>${fmt(L(tab, 'where', 'Where it lives'))}</h3>${whereHTML(arr(p.where))}`
    else if (x.none) h += `<h3>${fmt(L(tab, 'where', 'Where it lives'))}</h3><p class="muted">${fmt(x.none)}</p>`
    if (arr(p.notes).length) h += `<h3>${fmt(L(tab, 'notes', 'Notes'))}</h3>${bulletsHTML(arr(p.notes))}`
    if (arr(p.bullets).length) h += `${p.bulletsTitle ? `<h3>${fmt(p.bulletsTitle)}</h3>` : ''}${bulletsHTML(arr(p.bullets))}`
    const list = arr(x.list).concat(arr(p.list))
    if (list.length) h += `${p.listTitle || x.listTitle ? `<h3>${fmt(p.listTitle || x.listTitle)}</h3>` : ''}<ul>${list.map((d) => `<li><b>${fmt(d.b)}:</b> ${fmt(d.text)}</li>`).join('')}</ul>`
    if (x.legend) h += x.legend
    const links = goList(arr(p.links))
    if (links) h += `<h3>${fmt(p.linksTitle || x.linksTitle || L(tab, 'links', 'Connected to'))}</h3>${links}`
    if (x.after) h += x.after
    if (p.foot) h += `<p class="foot">${fmt(p.foot)}</p>`
    return h
  }
  function itemPanel(tab, it) {
    const lane = arr(tab.lanes).find((l) => l.id === it.lane) || {}
    const i = arr(tab.stages).findIndex((s) => s.id === it.stage)
    const st = arr(tab.stages)[i] || {}
    const warned = it.tag || arr(it.callouts).some((c) => c && (c.tone === 'gap' || c.tone === 'wait' || !c.tone))
    const none = !warned && !arr(it.where).length && !arr(it.refs).length && !arr(it.parts).length ? (lane.none || L(tab, 'none', '')) : ''
    const p = { title: it.text, text: it.plain, callouts: it.callouts, refs: it.refs, sections: it.parts, where: it.where, notes: it.notes, links: it.links }
    return [p, { none, tagHTML: `<span class="tag" style="--c:${col(lane.color)}"><i></i>${fmt(lane.name)} &middot; ${fmt(L(tab, 'step', 'step'))} ${i + 1}, ${fmt(st.name)}</span>` }]
  }
  function lanePanel(tab, l) {
    const p = clean(l.panel)
    p.tag = { text: L(tab, 'row', 'Row'), color: l.color }
    p.title = l.name
    if (!arr(p.text).length) p.text = l.sub
    p.links = arr(tab.items).filter((it) => it.lane === l.id).map((it) => it.id)
    return [p, { linksTitle: L(tab, 'rowItems', 'Its boxes'), after: `<p style="margin-top:12px"><button class="lnk" data-clear="1">${fmt(L(tab, 'showAll', 'Show every row'))}</button></p>` }]
  }
  function footPanel(tab) {
    const p = clean(tab.foot.panel)
    p.title = p.title || tab.foot.label
    const rows = arr(tab.stages).filter((s) => arr(s.foot).length).map((s) => ({ b: s.name, text: arr(s.foot).join(', ') }))
    return [p, { list: rows, listTitle: L(tab, 'footList', 'By step') }]
  }
  function journeyIntro(tab) {
    const p = clean(tab.panel)
    if (!p.title) p.title = tab.label
    const anyOptional = arr(tab.items).some((it) => it.optional)
    let lg = `<div class="legend">${arr(tab.lanes).map((l) => `<i style="--c:${col(l.color)}"></i><span>${fmt(l.name)}</span>`).join('')}${anyOptional ? `<i class="dash"></i><span>${fmt(L(tab, 'optional', 'Optional'))}</span>` : ''}</div>`
    if (arr(tab.tagLegend).length) lg += `<h3>${fmt(L(tab, 'tags', 'Tags on a box'))}</h3><p>${arr(tab.tagLegend).map((t) => `<span class="pill ${t.tone === 'gap' ? 'gap' : t.tone === 'wait' ? 'wait' : ''}">${fmt(t.text)}</span> ${fmt(t.meaning)}`).join(' ')}</p>`
    if (!p.foot) p.foot = D.meta.source
    return [p, { legend: lg }]
  }
  function refByHTML(id, tab) {
    const list = (REFBY.get(id) || []).filter((x) => ENT.has(x))
    if (!list.length) return ''
    const jt = ENT.get(list[0]).tab
    return `<h3>${fmt(L(tab, 'refBy', L(jt, 'refBy', 'Boxes that use it')))}</h3>${goList(list)}`
  }
  function edgePanel(tab, e) {
    const p = clean(e.panel)
    const out = String(e.outcome || '').trim()
    p.tag = p.tag || { text: (tab.edges && tab.edges.label) || '', color: 'faint' }
    p.title = p.title || e.text
    p.text = arr(e.detail).concat(arr(p.text))
    p.links = arr(p.links).concat(e.links)
    return [p, { lead: out ? (/[.!?"')]$/.test(out) ? out : out + '.') : '' }]
  }
  function renderPanel() {
    const tab = S.tab
    const e = S.sel ? ENT.get(S.sel) : null
    let pair
    if (!e) {
      if (tab.type === 'journey') pair = journeyIntro(tab)
      else {
        const p = clean(tab.panel)
        if (!p.title && !arr(p.text).length) { p.title = tab.title || tab.label; p.text = tab.lede }
        if (!p.foot) p.foot = D.meta.source
        pair = [p, {}]
      }
    } else if (e.kind === 'item') pair = itemPanel(tab, e.obj)
    else if (e.kind === 'edge') pair = edgePanel(tab, e.obj)
    else if (e.kind === 'lane') pair = lanePanel(tab, e.obj)
    else if (e.kind === 'foot') pair = footPanel(tab)
    else {
      const p = clean(e.obj.panel)
      if (e.kind === 'node') { p.tag = p.tag || { text: e.obj.sub || '', color: e.obj.style === 'ext' ? 'faint' : 'ink' }; p.title = p.title || e.obj.title }
      if (e.kind === 'row' && !p.title) p.title = e.label
      pair = [p, { after: refByHTML(S.sel, tab) }]
    }
    const key = tab.id + '|' + (S.sel || '')
    $('panel').innerHTML = panelHTML(pair[0], tab, pair[1])
    if (key !== lastPanelKey) { $('panel').scrollTop = 0; lastPanelKey = key }
  }
  let lastPanelKey = ''

  // ---------- journey ----------
  function flagsHTML(items) {
    return arr(items).map((f, i) => `<div class="flag"><span class="rank">${fmt(f.n != null ? f.n : i + 1)}</span><div><h4>${fmt(f.h)}</h4><p>${fmt(f.p)}</p>${f.src ? `<span class="src">${fmt(f.src)}</span>` : ''}</div></div>`).join('')
  }
  function renderJourney(tab, el) {
    const e = S.sel ? ENT.get(S.sel) : null
    const active = e && (e.kind === 'item' || e.kind === 'edge') ? e : null
    const lit = new Set(active ? active.obj.links : [])
    const stages = arr(tab.stages), lanes = arr(tab.lanes), items = arr(tab.items)
    const n = Math.max(1, stages.length)
    const relOf = (id, laneId) => (active ? (id === S.sel ? ' sel' : lit.has(id) ? ' lit' : ' faded') : S.lane && laneId !== undefined && S.lane !== laneId ? ' faded' : '')
    const item = (it) => {
      const lane = lanes.find((l) => l.id === it.lane) || {}
      const t = (it.tag && it.tag.text ? `<em class="${it.tag.tone === 'gap' ? 'gap' : 'wait'}">${fmt(it.tag.text)}</em>` : '') + (it.optional ? `<em>${fmt(L(tab, 'optional', 'optional'))}</em>` : '')
      return `<button class="j-item${it.optional ? ' optional' : ''}${relOf(it.id, it.lane)}" data-sel="${esc(it.id)}" aria-pressed="${S.sel === it.id}" style="--c:${col(lane.color)}"><span class="j-t"><i></i><span>${fmt(it.text)}</span></span>${t}</button>`
    }
    let h = `<p class="j-phone">${fmt(L(tab, 'scrollHint', 'Scroll sideways for every step.'))}</p><div class="j-scroll"><div class="j-grid" style="--n:${n};--colmin:${num(tab.colMin, 128)}px">`
    if (arr(tab.spans).length) {
      h += '<div></div>'
      let c = 1
      const spans = arr(tab.spans).filter((s) => Number.isInteger(s.from) && Number.isInteger(s.to)).slice().sort((a, b) => a.from - b.from)
      for (const s of spans) {
        const from = Math.max(s.from, c), to = Math.min(s.to, n)
        if (from > to) continue
        while (c < from) { h += '<div></div>'; c++ }
        h += `<div class="j-span${s.tone === 'quiet' ? ' quiet' : ''}" style="grid-column: span ${to - from + 1}">${fmt(s.label)}</div>`
        c = to + 1
      }
      while (c <= n) { h += '<div></div>'; c++ }
    }
    h += `<div class="j-corner"><span class="j-hint">${fmt(tab.hint || '')}</span></div>`
    h += stages.map((st, i) => `<div class="j-stage">${tab.numbered === false ? '' : `<span class="k">${i + 1}</span>`}<b>${fmt(st.name)}</b>${st.sub ? `<span>${fmt(st.sub)}</span>` : ''}</div>`).join('')
    for (const l of lanes) {
      const lid = tab.id + ':lane:' + l.id
      h += `<button class="j-who" data-lane="${esc(lid)}" style="--c:${col(l.color)}" aria-pressed="${S.lane === l.id}"><b><i></i><span>${fmt(l.name)}</span></b>${l.sub ? `<span>${fmt(l.sub)}</span>` : ''}</button>`
      h += stages.map((st) => `<div class="j-cell">${items.filter((it) => it.stage === st.id && it.lane === l.id).map(item).join('')}</div>`).join('')
    }
    if (tab.foot) {
      const fid = tab.id + ':foot'
      h += `<div class="j-slh">${fmt(tab.foot.label)}</div>`
      h += stages.map((st) => (arr(st.foot).length ? `<button class="j-sl" data-sel="${esc(fid)}" aria-pressed="${S.sel === fid}">${arr(st.foot).map(fmt).join('<br>')}</button>` : `<span class="j-sl none">${fmt(tab.foot.empty || '')}</span>`)).join('')
    }
    const chips = arr(tab.edges && tab.edges.items)
    if (chips.length) {
      h += `<div></div><div class="j-band"><b>${fmt((tab.edges && tab.edges.label) || '')}</b>${chips.map((x) => `<button class="j-chip${relOf(x.id)}" data-sel="${esc(x.id)}" aria-pressed="${S.sel === x.id}">${fmt(x.text)}${x.outcome ? ` <span class="to">&rarr; ${fmt(x.outcome)}</span>` : ''}</button>`).join('')}</div>`
    }
    h += '</div></div>'
    if (arr(tab.flags).length) h += `<div class="j-flags">${tab.flagsTitle ? `<div class="group-h">${fmt(tab.flagsTitle)}</div>` : ''}${flagsHTML(tab.flags)}</div>`
    const old = el.querySelector('.j-scroll')
    const left = old ? old.scrollLeft : 0
    el.innerHTML = h
    if (left) el.querySelector('.j-scroll').scrollLeft = left
    hintScroll()
  }

  // show the "scroll sideways" line whenever the grid is wider than its box, at any screen width
  function hintScroll() {
    const v = $('view-' + S.tab.id)
    const g = v && v.querySelector('.j-scroll'), hint = v && v.querySelector('.j-phone')
    if (g && hint) hint.classList.toggle('show', g.scrollWidth > g.clientWidth + 1)
  }
  window.addEventListener('resize', () => { if (S.tab.type === 'journey') hintScroll() })

  // ---------- page sections ----------
  function cellHTML(c) {
    if (c == null) return '<td></td>'
    if (typeof c !== 'object') return `<td>${fmt(c)}</td>`
    const cls = [c.mono ? 'm' : '', c.muted ? 's' : ''].filter(Boolean).join(' ')
    let inner = c.dot ? `<span class="dot${c.dot.hollow ? ' hollow' : ''}" style="--c:${col(c.dot.color)}"><i></i>${fmt(c.text)}</span>` : fmt(c.text)
    if (c.tone === 'neg' || c.tone === 'pos') inner = `<span class="${c.tone}">${inner}</span>`
    if (c.b) inner = `<b>${inner}</b>`
    return `<td${cls ? ` class="${cls}"` : ''}>${inner}</td>`
  }
  function graphHTML(s, key) {
    const nodes = arr(s.nodes).filter((n) => Number.isInteger(n.lane) && Number.isInteger(n.row) && n.lane >= 0 && n.row >= 0)
    if (!nodes.length) return ''
    // A box is colWidth - 20 px wide, as it always was. Arrows run in the gaps beside the columns,
    // at right angles, at least LANE apart, and never behind a box; where two cross, the lesser one
    // hops (a dashed arrow, else the later one). A gap holds up to four lanes and is only as wide as
    // the lanes its arrows use: 20 px with none, as before, then 28, 40, 52 or 64 px.
    const LANE = 12, R = 8, HOP = 5
    const lanes = arr(s.lanes), CW = Math.max(120, num(s.colWidth, 195)), BH = num(s.boxHeight, 76), RH = Math.max(num(s.rowHeight, 120), BH + 10), W = CW - 20
    const mid = 'ar-' + key
    const div = s.divider && Number.isInteger(s.divider.beforeRow) ? s.divider : null
    const yOf = (row) => 40 + row * RH + (div && row >= div.beforeRow ? 40 : 0)
    const nl = Math.max(lanes.length, ...nodes.map((n) => n.lane + 1))
    const gapW = (k) => (k ? 28 + LANE * (k - 1) : 20)
    const eds = arr(s.edges)
    const layout = (k) => {
      const X = []
      let x = 20
      for (let l = 0; l < nl; l++) { X.push(x); x += W + gapW(k[l]) }
      const N = new Map()
      for (const n of nodes) { const h = Number.isInteger(n.rows) && n.rows > 1 ? (n.rows - 1) * RH + BH : BH; N.set(n.id, { n, x: X[n.lane], y: yOf(n.row), h }) }
      const bottom = Math.max(...[...N.values()].map((v) => v.y + v.h))
      return { X, N, width: x, bottom, R: graphRoutes(N, eds, { W, BH, LANE, bottom, gl: (gi) => X[gi] + W, k }) }
    }
    // route with four lanes in every gap, then narrow each gap to the lanes it used; a gap where
    // that makes arrows overlap gets a lane back, and if overlaps remain the wide layout is kept
    const wide = layout(new Array(nl).fill(4))
    let lay = wide
    let k = wide.R.used.slice()
    for (let t = 0; t < 5; t++) {
      const tryLay = layout(k)
      if (tryLay.R.clash <= wide.R.clash) { lay = tryLay; break }
      const grow = tryLay.R.tight.filter((gi) => k[gi] < 4)
      if (!grow.length) break
      k = k.slice()
      for (const gi of grow) k[gi]++
    }
    const { X, N, width, bottom } = lay
    const routes = lay.R
    const height = Math.max(bottom + 20, routes.low + 14)
    const edge = (r) => `<path class="svg-e${r.ed.dashed ? ' dashed' : ''}" d="${pathOf(r.pts, r.hops, R, HOP)}" marker-end="url(#${mid})"></path>`
    const box = (v) => {
      const { n, x, y, h } = v
      const cls = 'pc' + (n.style === 'ext' || n.style === 'gate' ? ' ' + n.style : '') + (S.sel === n.id ? ' sel' : '')
      let t = `<g class="${cls}" data-sel="${esc(n.id)}" tabindex="0" role="button" aria-pressed="${S.sel === n.id}" aria-label="${plain(n.title)}"><rect class="box" x="${x}" y="${y}" width="${W}" height="${h}" rx="3"></rect><text class="svg-t" x="${x + 12}" y="${y + 30}">${plain(n.short || n.title)}</text>`
      if (n.sub) t += `<text class="svg-s" x="${x + 12}" y="${y + 52}">${plain(n.sub)}</text>`
      t += arr(n.lines).map((l, i) => `<text class="svg-s" x="${x + 12}" y="${y + 80 + i * 20}">${plain(l)}</text>`).join('')
      return t + '</g>'
    }
    let g = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${plain(s.aria || s.title || 'Diagram')}">`
    g += `<defs><marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"></path></marker></defs>`
    g += lanes.map((l, i) => `<text class="svg-lane" x="${X[i]}" y="20">${plain(String(l).toUpperCase())}</text>`).join('')
    if (div) { const y = 40 + div.beforeRow * RH - 10; g += `<line class="svg-div" x1="20" x2="${width - 20}" y1="${y}" y2="${y}"></line><text class="svg-lane" x="20" y="${y + 30}">${plain(String(div.label || '').toUpperCase())}</text>` }
    g += routes.list.map(edge).join('') + [...N.values()].map(box).join('') + '</svg>'
    return `<div class="svgwrap">${g}</div>`
  }
  // Where each arrow runs. It leaves and enters a box at its own point on the side, ordered by where
  // the other end sits. Every segment drawn so far is kept, and each arrow takes the first of its
  // possible routes (straight, one turn, or through a gap between rows that is clear in every
  // column it crosses) that keeps LANE from all of them; when none does, the one that overlaps
  // least. tools/check.mjs reports arrows that still end up on top of each other.
  function graphRoutes(N, eds, o) {
    const { W, BH, LANE, bottom, gl, k } = o
    // up to four lanes in a gap, 12 px apart, middle ones first; an arrow that ends on a box's right
    // side prefers the lanes away from that box, so its last segment is long enough for the arrowhead
    const ORDER = { 1: [[9], [9]], 2: [[9, 21], [21, 9]], 3: [[21, 9, 33], [21, 33, 9]], 4: [[21, 33, 9, 45], [33, 21, 45, 9]] }
    const lanesIn = (g, endsRight) => ORDER[Math.max(1, Math.min(4, k[g] || 1))][endsRight ? 1 : 0].map((d) => gl(g) + d)
    const E = eds.map((ed, i) => ({ ed, i, a: N.get(ed.from), b: N.get(ed.to) })).filter((e) => e.a && e.b && e.a !== e.b)
    const between = (a, b) => [...N.values()].some((v) => v.n.lane === a.n.lane && v !== a && v !== b && v.y > Math.min(a.y, b.y) && v.y < Math.max(a.y, b.y))
    const slots = new Map()
    const slot = (v, side, e, end, toward) => { const k = v.n.id + '|' + side; if (!slots.has(k)) slots.set(k, { v, list: [] }); slots.get(k).list.push({ e, end, toward }) }
    for (const e of E) {
      const { a, b } = e
      e.kind = b.n.lane > a.n.lane ? 'fwd' : b.n.lane < a.n.lane ? 'back' : between(a, b) ? 'side' : 'col'
      if (e.kind === 'col') continue
      slot(a, e.kind === 'back' ? 'l' : 'r', e, 'a', b.y + b.h / 2)
      slot(b, e.kind === 'fwd' ? 'l' : 'r', e, 'b', a.y + a.h / 2)
    }
    for (const { v, list } of slots.values()) {
      list.sort((p, q) => p.toward - q.toward)
      list.forEach((t, k) => { const y = v.y + ((k + 1) * v.h) / (list.length + 1); if (t.end === 'a') t.e.ya = y; else t.e.yb = y })
    }
    // a tall target (a go-live box) is hit level with its source, so those lines stay flat
    for (const e of E) if (e.kind === 'fwd' && e.b.h > BH) e.yb = Math.min(Math.max(e.ya, e.b.y + 14), e.b.y + e.b.h - 14)
    const inCols = (cols) => [...N.values()].filter((v) => cols.includes(v.n.lane))
    const clear = (y, cols) => !inCols(cols).some((v) => y > v.y - 6 && y < v.y + v.h + 6)
    const bands = (cols, want) => {
      // the clear gaps between rows in these columns, and the space under the lowest box
      const occ = inCols(cols).map((v) => [v.y - 4, v.y + v.h + 4]).sort((p, q) => p[0] - q[0])
      const out = []
      let top = 30
      for (const [u, v] of occ) { if (u - top > LANE + 8) out.push([top, u]); top = Math.max(top, v) }
      const floor = Math.max(top, bottom + 4)
      out.push([floor, floor + 3 * LANE + 8])
      return out.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - want) - Math.abs((q[0] + q[1]) / 2 - want))
    }
    const bandLanes = ([u, v]) => { const c = (u + v) / 2; return [c, c - LANE, c + LANE, c - 2 * LANE, c + 2 * LANE].filter((t) => t > u + 4 && t < v - 4) }
    const segsOf = (pts) => pts.slice(0, -1).map((p, k) => { const q = pts[k + 1], h = Math.abs(q[1] - p[1]) < 0.5; return h ? { h, c: p[1], lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) } : { h, c: p[0], lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) } })
    const drawn = []
    const clash = (pts, me) => {
      // how much of this route runs within LANE of a parallel segment of another arrow
      let len = 0
      for (const sg of segsOf(pts)) for (const r of drawn) {
        if (r.e === me || r.h !== sg.h || Math.abs(r.c - sg.c) >= LANE - 0.5) continue
        const lap = Math.min(r.hi, sg.hi) - Math.max(r.lo, sg.lo)
        if (lap > -4) len += lap + 4
      }
      return len
    }
    const range = (p, q) => { const r = []; for (let i = p; i <= q; i++) r.push(i); return r }
    for (const e of E) {
      const { a, b } = e
      const cands = []
      if (e.kind === 'col') {
        const x = a.x + W / 2, down = b.y >= a.y
        for (const dx of [0, -LANE, LANE]) cands.push(down ? [[x + dx, a.y + a.h], [x + dx, b.y - 6]] : [[x + dx, a.y], [x + dx, b.y + b.h + 6]])
      } else if (e.kind === 'side') {
        for (const x of lanesIn(a.n.lane, true)) cands.push([[a.x + W, e.ya], [x, e.ya], [x, e.yb], [b.x + W + 6, e.yb]])
      } else {
        const fwd = e.kind === 'fwd'
        const ax = fwd ? a.x + W : a.x, bx = fwd ? b.x - 6 : b.x + W + 6
        const g1 = fwd ? a.n.lane : a.n.lane - 1, g2 = fwd ? b.n.lane - 1 : b.n.lane
        const cols = fwd ? range(a.n.lane + 1, b.n.lane - 1) : range(b.n.lane + 1, a.n.lane - 1)
        if (Math.abs(e.ya - e.yb) < 1 && clear(e.ya, cols)) cands.push([[ax, e.ya], [bx, e.yb]])
        if (clear(e.ya, cols)) for (const x of lanesIn(g2, !fwd)) cands.push([[ax, e.ya], [x, e.ya], [x, e.yb], [bx, e.yb]])
        if (cols.length && clear(e.yb, cols)) for (const x of lanesIn(g1, !fwd)) cands.push([[ax, e.ya], [x, e.ya], [x, e.yb], [bx, e.yb]])
        if (cols.length) {
          for (const band of bands(cols, (e.ya + e.yb) / 2)) for (const yc of bandLanes(band)) {
            for (const x1 of lanesIn(g1, !fwd)) for (const x2 of lanesIn(g2, !fwd)) cands.push([[ax, e.ya], [x1, e.ya], [x1, yc], [x2, yc], [x2, e.yb], [bx, e.yb]])
          }
        }
      }
      // drop repeated points and straight-through corners, so every segment has a length and a turn
      e.cands = cands.map((c) => {
        const p1 = c.filter((q, k) => k === 0 || Math.hypot(q[0] - c[k - 1][0], q[1] - c[k - 1][1]) > 0.5)
        return p1.filter((q, k) => k === 0 || k === p1.length - 1 || !((Math.abs(p1[k - 1][0] - q[0]) < 0.5 && Math.abs(q[0] - p1[k + 1][0]) < 0.5) || (Math.abs(p1[k - 1][1] - q[1]) < 0.5 && Math.abs(q[1] - p1[k + 1][1]) < 0.5)))
      })
    }
    const place = (e) => {
      for (let k = drawn.length - 1; k >= 0; k--) if (drawn[k].e === e) drawn.splice(k, 1)
      let best = e.cands[0], bestLen = Infinity
      for (const c of e.cands) { const l = clash(c, e); if (l < bestLen) { best = c; bestLen = l } if (l === 0) break }
      e.pts = best
      for (const sg of segsOf(best)) drawn.push(Object.assign(sg, { e }))
      return bestLen
    }
    // the longest arrows choose first; then any arrow that still overlaps another is routed again,
    // now that it can see every other arrow, until nothing moves (a few passes at most)
    const span = (e) => Math.abs(e.b.n.lane - e.a.n.lane)
    const order = [...E].sort((p, q) => span(q) - span(p) || p.i - q.i)
    for (const e of order) place(e)
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (const e of order) {
        if (!clash(e.pts, e)) continue
        const before = e.pts
        place(e)
        if (e.pts !== before) moved = true
      }
      if (!moved) break
    }
    let low = 0, total = 0
    const used = k.map(() => new Set()), tight = new Set()
    const gapOf = (x) => k.findIndex((kk, gi) => x > gl(gi) && x < gl(gi) + 28 + LANE * 3)
    for (const e of E) {
      for (const q of e.pts) low = Math.max(low, q[1])
      for (const sg of segsOf(e.pts)) if (!sg.h) { const gi = gapOf(sg.c); if (gi >= 0) used[gi].add(Math.round(sg.c)) }
      const c = clash(e.pts, e)
      total += c
      if (c) for (const q of e.pts) { const gi = gapOf(q[0]); if (gi >= 0) tight.add(gi) }
    }
    // hops: a dashed arrow hops a solid one; between two of a kind, the later one hops
    const segs = (e) => e.pts.slice(0, -1).map((p, k) => ({ k, x0: p[0], y0: p[1], x1: e.pts[k + 1][0], y1: e.pts[k + 1][1], h: Math.abs(e.pts[k + 1][1] - p[1]) < 0.5 }))
    const inside = (v, p, q, m) => v > Math.min(p, q) + m && v < Math.max(p, q) - m
    for (const e of E) { e.hops = new Map(); e.segs = segs(e) }
    for (const e1 of E) for (const e2 of E) {
      if (e1 === e2) continue
      const lesser = (!!e1.ed.dashed && !e2.ed.dashed) || (!!e1.ed.dashed === !!e2.ed.dashed && e1.i > e2.i)
      if (!lesser) continue
      for (const s1 of e1.segs) for (const s2 of e2.segs) {
        if (s1.h === s2.h) continue
        const hz = s1.h ? s1 : s2, vt = s1.h ? s2 : s1
        if (!inside(vt.x0, hz.x0, hz.x1, 10) || !inside(hz.y0, vt.y0, vt.y1, 10)) continue
        if (!e1.hops.has(s1.k)) e1.hops.set(s1.k, [])
        e1.hops.get(s1.k).push(s1.h ? vt.x0 : hz.y0)
      }
    }
    return { list: E.sort((p, q) => p.i - q.i), low, clash: total, used: used.map((u) => u.size), tight: [...tight] }
  }
  // right angles with rounded corners, and a small arc where this arrow hops another
  function pathOf(pts, hops, R, HOP) {
    const S2 = pts.slice(0, -1).map((p, k) => { const [x0, y0] = p, [x1, y1] = pts[k + 1]; return { x0, y0, x1, y1, h: Math.abs(y1 - y0) < 0.5, len: Math.hypot(x1 - x0, y1 - y0) } }).filter((sg) => sg.len > 0.5)
    if (!S2.length) return ''
    const rad = [0]
    for (let k = 1; k < S2.length; k++) rad.push(Math.min(R, S2[k - 1].len / 2, S2[k].len / 2))
    rad.push(0)
    const at = (sg, t) => [sg.x0 + ((sg.x1 - sg.x0) * t) / sg.len, sg.y0 + ((sg.y1 - sg.y0) * t) / sg.len]
    const r1 = (v) => Math.round(v * 10) / 10
    let d = `M${r1(S2[0].x0)},${r1(S2[0].y0)}`
    S2.forEach((sg, k) => {
      const ts = (hops.get(k) || []).map((v) => Math.abs(v - (sg.h ? sg.x0 : sg.y0))).filter((t) => t > HOP + rad[k] && t < sg.len - HOP - rad[k + 1]).sort((p, q) => p - q)
      const sweep = sg.h ? (sg.x1 > sg.x0 ? 1 : 0) : (sg.y1 > sg.y0 ? 1 : 0)
      for (const t of ts) { const [ax, ay] = at(sg, t - HOP), [bx, by] = at(sg, t + HOP); d += ` L${r1(ax)},${r1(ay)} A${HOP},${HOP} 0 0 ${sweep} ${r1(bx)},${r1(by)}` }
      const [ex, ey] = at(sg, sg.len - rad[k + 1])
      d += ` L${r1(ex)},${r1(ey)}`
      if (k < S2.length - 1 && rad[k + 1] > 0) { const [nx, ny] = at(S2[k + 1], rad[k + 1]); d += ` Q${r1(sg.x1)},${r1(sg.y1)} ${r1(nx)},${r1(ny)}` }
    })
    return d
  }
  function sectionHTML(s, key) {
    let h = s.title ? `<div class="group-h">${fmt(s.title)}</div>` : ''
    if (s.lede) h += `<p class="lede"${s.title ? ' style="margin-bottom:10px"' : ''}>${fmt(s.lede)}</p>`
    switch (s.type) {
      case 'flags':
        h += flagsHTML(s.items)
        break
      case 'graph':
        h += graphHTML(s, key)
        break
      case 'table':
        // a clickable row stays a table row for screen readers; its first cell holds a real button
        h += `<div class="tablewrap"${num(s.maxWidth, 0) ? ` style="max-width:${num(s.maxWidth, 0)}px"` : ''}><table class="mx"><thead><tr>${arr(s.columns).map((c) => `<th>${fmt(c)}</th>`).join('')}</tr></thead><tbody>${arr(s.rows).map((r) => {
          const cells = arr(r.cells).map(cellHTML)
          if (!clickableRow(r)) return `<tr>${cells.join('')}</tr>`
          if (cells.length) cells[0] = cells[0].replace(/^<td([^>]*)>([\s\S]*)<\/td>$/, (m, a, inner) => `<td${a}><button class="rowbtn" data-sel="${esc(r.id)}" aria-pressed="${S.sel === r.id}">${inner}</button></td>`)
          return `<tr class="click${S.sel === r.id ? ' sel' : ''}" data-sel="${esc(r.id)}">${cells.join('')}</tr>`
        }).join('')}</tbody></table></div>`
        break
      case 'bars': {
        const bars = arr(s.items)
        const max = Math.max(0, ...bars.map((b) => Number(b.value) || 0)) || 1
        h += `<div class="bars">${bars.map((b) => { const r = Math.min(1, Math.max(0, (Number(b.value) || 0) / max)); return `<span class="nm">${fmt(b.label)}</span><div class="row"><span class="b" style="width:calc(${r.toFixed(3)} * min(${num(s.maxBar, 300)}px, 40vw));background:${col(b.color || 'c2')}"></span><span class="v">${fmt(b.display != null ? b.display : Number(b.value).toLocaleString('en-US'))}</span>${b.note ? `<span class="how">${fmt(b.note)}</span>` : ''}</div>` }).join('')}</div>`
        if (arr(s.takeaways).length) h += `<ul class="takeaways">${arr(s.takeaways).map((t) => `<li>${fmt(t)}</li>`).join('')}</ul>`
        break
      }
      case 'stats':
        h += `<div class="stats-row" style="--k:${Math.max(1, Math.min(4, arr(s.items).length))}">${arr(s.items).map((x) => `<div><div class="big">${fmt(x.big)}</div><div class="s">${fmt(x.text)}</div></div>`).join('')}</div>`
        break
      case 'cards':
        h += `<div class="cards" style="--k:${Math.max(1, Math.min(5, arr(s.items).length))}">${arr(s.items).map((x) => `<div><b>${fmt(x.title)}</b><span>${fmt(x.text)}</span></div>`).join('')}</div>`
        break
      case 'meter': {
        const at = (t) => Math.min(100, Math.max(0, Number(t.at) || 0))
        const align = (t) => t.align || (at(t) <= 25 ? 'l' : at(t) >= 75 ? 'r' : '')
        h += `<div class="meter"><div class="meter-h"><span>${fmt(s.left || '')}</span><span class="mono muted">${fmt(s.right || '')}</span></div><div class="room"><div class="track">${s.fill ? `<div class="fill" style="width:${Math.min(100, Math.max(0, Number(s.fill.pct) || 0))}%;background:${col(s.fill.color)}"></div>` : ''}${arr(s.ticks).filter((t) => t.mark !== false).map((t) => `<div class="tick" style="left:${at(t) >= 100 ? 'calc(100% - 2px)' : at(t) + '%'}"></div>`).join('')}</div>${arr(s.ticks).map((t) => `<div class="tick-l${align(t) === 'l' ? ' l' : align(t) === 'r' ? ' r' : ''}" style="left:${at(t)}%"><b>${fmt(t.label)}</b>${fmt(t.sub || '')}</div>`).join('')}</div></div>`
        break
      }
      case 'checklist':
        // one span per line: bold or code beside plain text would otherwise become separate grid cells
        h += `<ul class="checklist">${arr(s.items).map((x) => (x && typeof x === 'object' ? `<li class="${x.go ? 'go' : x.done ? 'done' : ''}"><span>${fmt(x.text)}</span></li>` : `<li><span>${fmt(x)}</span></li>`)).join('')}</ul>`
        break
      case 'pills':
        h += `<div class="pills">${arr(s.items).map((x) => `<span class="pill">${fmt(x)}</span>`).join('')}</div>`
        break
      case 'defs':
        h += `<ul class="defs">${arr(s.items).map((x) => `<li><b>${fmt(x.b)}</b> ${fmt(x.text)}</li>`).join('')}</ul>`
        break
      case 'prose':
        h += `<div class="prose">${arr(s.paragraphs).map((x) => `<p>${fmt(x)}</p>`).join('')}</div>`
        break
    }
    if (s.note) h += `<p class="lede after">${fmt(s.note)}</p>`
    return h
  }
  function renderPage(tab, el) {
    el.innerHTML = `<div class="page-inner">${tab.title ? `<h2 class="page-h">${fmt(tab.title)}</h2>` : ''}${tab.lede ? `<p class="lede">${fmt(tab.lede)}</p>` : ''}${arr(tab.sections).map((s, i) => sectionHTML(s, tab.id + '-' + i)).join('')}</div>`
  }

  // ---------- shell, tabs, events ----------
  function renderView() {
    for (const t of D.tabs) $('view-' + t.id).classList.toggle('on', t === S.tab)
    document.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.tab === S.tab.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1 })
    const el = $('view-' + S.tab.id)
    try {
      if (S.tab.type === 'journey') renderJourney(S.tab, el)
      else renderPage(S.tab, el)
    } catch (err) {
      el.innerHTML = `<div class="flag"><span class="rank">!</span><div><h4>This tab could not be drawn</h4><p>${esc(err && err.message)}</p></div></div>`
      if (window.console) console.error(err)
    }
    try { renderPanel() } catch (err) { $('panel').innerHTML = `<p class="muted">${esc(err && err.message)}</p>`; if (window.console) console.error(err) }
  }
  // after a re-render, put focus back on the element that was activated, if it had focus;
  // matched by attribute and position, since several elements can share a value
  let pending = null
  // focusable elements carrying attr=value, in page order (a clickable row's tr is skipped; its button is not)
  const matches = (attr, value) => [...document.querySelectorAll(`[${attr}]`)].filter((x) => x.getAttribute(attr) === value && x.tabIndex >= 0)
  function remember(t) {
    if (!t || document.activeElement !== t) { pending = null; return }
    const attr = ['data-sel', 'data-lane', 'data-go', 'data-tab', 'data-clear'].find((a) => t.hasAttribute(a))
    pending = { attr, value: t.getAttribute(attr), index: matches(attr, t.getAttribute(attr)).indexOf(t) }
  }
  function refocus(attr, value, toPanel) {
    const p = pending
    pending = null
    if (!p) return
    if (toPanel || p.attr === 'data-clear' || p.attr === 'data-go') { const h = $('panel').querySelector('h2'); if (h) { h.focus({ preventScroll: true }); return } }
    const a = attr || p.attr, v = value || p.value
    const same = matches(a, v)
    const el = same[a === p.attr && v === p.value ? Math.max(0, p.index) : 0] || same[0]
    if (el) el.focus({ preventScroll: true })
  }
  function setHash(id) { try { history.replaceState(null, '', '#' + id) } catch (err) { /* sandboxed frames may refuse */ } }
  function setTab(tab, focusTab) {
    S.tab = tab; S.sel = null; S.lane = null
    setHash(tab.id)
    renderView()
    if (focusTab && pending) { pending = { attr: 'data-tab', value: tab.id, index: 0 }; refocus() } else pending = null
  }
  function select(id) {
    S.sel = S.sel === id ? null : id
    S.lane = null
    renderView()
    refocus()
    if (S.sel && window.matchMedia('(max-width: 960px)').matches) $('panel').scrollIntoView({ block: 'start' })
  }
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-sel],[data-go],[data-lane],[data-tab],[data-clear]')
    if (!t) return
    remember(t)
    if (t.dataset.tab) { const tab = findTab(t.dataset.tab); if (tab) setTab(tab, true); return }
    if (t.dataset.clear) { S.sel = null; S.lane = null; renderView(); refocus(null, null, true); return }
    if (t.dataset.lane) {
      const e = ENT.get(t.dataset.lane)
      if (!e) return
      const on = S.lane !== e.obj.id
      S.lane = on ? e.obj.id : null
      S.sel = on ? t.dataset.lane : null
      renderJourney(S.tab, $('view-' + S.tab.id)); renderPanel()
      refocus()
      return
    }
    if (t.dataset.go) {
      const e = ENT.get(t.dataset.go)
      if (!e) return
      if (e.tab !== S.tab) { S.tab = e.tab; setHash(e.tab.id) }
      S.sel = null
      pending = pending ? { attr: 'data-sel', value: t.dataset.go, index: 0 } : null
      select(t.dataset.go)
      return
    }
    if (t.dataset.sel) select(t.dataset.sel)
  })
  document.addEventListener('keydown', (ev) => {
    const tabBtn = ev.target.closest && ev.target.closest('[data-tab]')
    if (tabBtn && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Home' || ev.key === 'End')) {
      const i = D.tabs.findIndex((x) => x.id === tabBtn.dataset.tab)
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? D.tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + D.tabs.length) % D.tabs.length
      ev.preventDefault()
      remember(tabBtn)
      setTab(D.tabs[j], true)
      return
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    const t = ev.target.closest && ev.target.closest('g[data-sel]')
    if (!t) return
    ev.preventDefault()
    remember(t)
    select(t.dataset.sel)
  })
  window.addEventListener('hashchange', () => { const t = findTab(location.hash.slice(1)); if (t && t !== S.tab) setTab(t) })

  // header and tabs
  $('eyebrow').innerHTML = fmt(D.meta.eyebrow || '')
  $('headline').innerHTML = fmt(D.meta.headline || D.meta.title) + (D.theme && D.theme.headlineDot ? '<span class="dot">.</span>' : '')
  $('stats').innerHTML = arr(D.meta.stats).map((s) => `<span>${fmt(s)}</span>`).join('')
  $('tabs').innerHTML = D.tabs.map((t) => `<button class="tab" role="tab" id="tab-${esc(t.id)}" aria-controls="view-${esc(t.id)}" data-tab="${esc(t.id)}" aria-selected="false" tabindex="-1">${fmt(t.label)}${t.count != null ? `<span class="n">${esc(t.count)}</span>` : ''}</button>`).join('')
  if (D.tabs.length < 2) document.querySelector('.bar').hidden = true
  const main = $('main')
  for (const t of D.tabs) {
    const sec = document.createElement('section')
    sec.className = 'view'; sec.id = 'view-' + t.id
    sec.setAttribute('role', 'tabpanel'); sec.setAttribute('aria-labelledby', 'tab-' + t.id)
    main.insertBefore(sec, $('panel'))
  }
  if (location.hash.slice(1) !== S.tab.id) setHash(S.tab.id)
  renderView()
})()
