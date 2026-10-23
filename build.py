#!/usr/bin/env python3
"""Build one self-contained diagram page from a data file and a theme.

    python3 build.py data.json [--theme neutral|path/to/theme.json] [--out index.html] [--strict] [--standalone]

The data is checked first (see references/schema.md). Any error stops the build with a line that
names the field. Warnings print and do not stop it, unless --strict is set.
--standalone adds a full HTML document around the page, for hosting outside a claude.ai Artifact
(an Artifact adds that wrapper itself, so leave it off when you publish there).
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'accent', 'pos', 'neg', 'faint', 'muted', 'ink']
HEX = re.compile(r'#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})')
TAB_ID = re.compile(r'[A-Za-z0-9_-]+')
ENTITY_ID = re.compile(r'[A-Za-z0-9._~-]+')
SECTION_TYPES = ['flags', 'graph', 'table', 'bars', 'stats', 'cards', 'meter', 'checklist', 'pills', 'defs', 'prose']
MAX_BYTES = 16 * 1024 * 1024
TOKEN_KEY = re.compile(r'[a-z0-9-]+')
COLOR_VALUE = re.compile(r'#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^<>{};()]*\)|[a-zA-Z]+')
UNSAFE_CSS = re.compile(r'[<>{};]')


def no_constants(c):
    raise ValueError(f'{c} is not valid JSON; write a number or text')

# keys each object may carry; anything else is warned about as a likely typo
COMMON_SECTION = {'type', 'title', 'lede', 'note'}
KEYS = {
    'root': {'meta', 'tabs', 'theme'},
    'meta': {'title', 'eyebrow', 'headline', 'stats', 'source'},
    'journey': {'id', 'label', 'type', 'hint', 'colMin', 'numbered', 'labels', 'panel', 'tagLegend', 'spans', 'stages', 'lanes', 'foot', 'items', 'edges', 'flags', 'flagsTitle', 'count'},
    'page': {'id', 'label', 'type', 'title', 'lede', 'count', 'panel', 'sections', 'labels'},
    'stage': {'id', 'name', 'sub', 'foot'},
    'lane': {'id', 'name', 'sub', 'color', 'panel', 'none'},
    'span': {'label', 'from', 'to', 'tone'},
    'item': {'id', 'stage', 'lane', 'text', 'plain', 'tag', 'optional', 'callouts', 'refs', 'where', 'notes', 'parts', 'links'},
    'edge': {'id', 'text', 'outcome', 'detail', 'links', 'panel'},
    'foot': {'label', 'empty', 'panel'},
    'panel': {'tag', 'title', 'text', 'callouts', 'refs', 'sections', 'where', 'notes', 'bullets', 'bulletsTitle', 'list', 'listTitle', 'links', 'linksTitle', 'foot'},
    'part': {'title', 'text', 'where', 'notes', 'bullets', 'tone', 'label'},
    'callout': {'label', 'text', 'tone'},
    'bullet': {'text', 'sub', 'status'},
    'flag': {'n', 'h', 'p', 'src'},
    'node': {'id', 'title', 'short', 'sub', 'lane', 'row', 'rows', 'style', 'lines', 'refLabel', 'refSub', 'panel'},
    'row': {'id', 'label', 'cells', 'panel'},
    'cell': {'text', 'b', 'mono', 'muted', 'tone', 'dot'},
    'legend': {'text', 'tone', 'meaning'},
    'gedge': {'from', 'to', 'dashed'},
    'bar': {'label', 'value', 'display', 'note', 'color'},
    'tick': {'at', 'label', 'sub', 'align', 'mark'},
    'checkItem': {'text', 'done', 'go'},
    'dot': {'color', 'hollow'},
    'statsItem': {'big', 'text'},
    'cardsItem': {'title', 'text'},
    'defsItem': {'b', 'text'},
    'labels': {'where', 'notes', 'links', 'none', 'step', 'optional', 'tags', 'row', 'rowItems', 'showAll', 'refBy', 'footList', 'scrollHint'},
    'flags': COMMON_SECTION | {'items'},
    'graph': COMMON_SECTION | {'lanes', 'nodes', 'edges', 'divider', 'colWidth', 'rowHeight', 'boxHeight', 'aria'},
    'table': COMMON_SECTION | {'columns', 'rows', 'maxWidth'},
    'bars': COMMON_SECTION | {'items', 'takeaways', 'maxBar'},
    'stats': COMMON_SECTION | {'items'},
    'cards': COMMON_SECTION | {'items'},
    'meter': COMMON_SECTION | {'left', 'right', 'fill', 'ticks'},
    'checklist': COMMON_SECTION | {'items'},
    'pills': COMMON_SECTION | {'items'},
    'defs': COMMON_SECTION | {'items'},
    'prose': COMMON_SECTION | {'paragraphs'},
}


class Check:
    def __init__(self):
        self.errors, self.warnings = [], []
        self.ids = {}            # id -> (where, kind)
        self.refs, self.links = [], []

    def err(self, where, msg):
        self.errors.append(f'{where}: {msg}')

    def warn(self, where, msg):
        self.warnings.append(f'{where}: {msg}')

    # --- shape helpers: each reports a named error and returns a safe value ---
    def obj(self, v, where, kind=None):
        # returns True for any dict, {} included, so callers still run their field checks on it
        if not isinstance(v, dict):
            self.err(where, f'expected an object {{...}}, got {type(v).__name__}')
            return False
        if kind and kind in KEYS:
            extra = sorted(str(k) for k in set(v) - KEYS[kind])
            if extra:
                self.warn(where, f'unknown key(s) {extra}; the engine ignores them (typo?)')
        return True

    def lst(self, v, where, required=False, nonempty=False):
        if v is None:
            if required:
                self.err(where, 'missing; expected a list [...]')
            return []
        if not isinstance(v, list):
            self.err(where, f'expected a list [...], got {type(v).__name__}')
            return []
        if nonempty and not v:
            self.err(where, 'is empty')
        return v

    def text(self, v, where, required=False, list_ok=False, num_ok=False):
        if v is None:
            if required:
                self.err(where, 'missing; expected text')
            return
        if isinstance(v, str):
            if required and not v.strip():
                self.err(where, 'is blank')
            return
        if num_ok and isinstance(v, (int, float)) and not isinstance(v, bool):
            return
        if list_ok and isinstance(v, list) and all(isinstance(x, str) for x in v):
            return
        self.err(where, 'expected text' + (' or a list of text' if list_ok else '') + f', got {type(v).__name__}')

    def ident(self, v, where, what='an id'):
        # ids, steps, rows, refs and links are text; anything else is reported, never hashed
        if isinstance(v, str):
            return True
        self.err(where, f'{what} must be text, got {type(v).__name__} {json.dumps(v)[:40]}')
        return False

    def number(self, v, where, lo=None, hi=None, integer=False, positive=False):
        ok = isinstance(v, (int, float)) and not isinstance(v, bool) and v == v
        if ok and integer and not isinstance(v, int):
            ok = False
        if not ok:
            self.err(where, f'expected a {"whole number" if integer else "number"} (no unit), got {json.dumps(v)}')
            return False
        if positive and v <= 0:
            self.err(where, f'must be greater than 0, got {v}')
            return False
        if (lo is not None and v < lo) or (hi is not None and v > hi):
            rng = f'between {lo} and {hi}' if lo is not None and hi is not None else f'{lo} or more' if lo is not None else f'{hi} or less'
            self.err(where, f'must be {rng}, got {v}')
            return False
        return True

    def color(self, v, where):
        if v is None:
            return
        if not isinstance(v, str) or (v not in TOKENS and not HEX.fullmatch(v)):
            self.err(where, f'color {json.dumps(v)} is not a theme token ({", ".join(TOKENS)}) or a #hex value')
        elif v.startswith('#'):
            self.warn(where, f'literal color {v} ignores the dark theme; prefer a token')

    def claim(self, i, where, kind):
        if i is not None and not isinstance(i, str):
            self.err(where, f'"id" must be text, got {type(i).__name__}')
        elif not i:
            self.err(where, 'missing "id"')
        elif not ENTITY_ID.fullmatch(i):
            self.err(where, f'id {json.dumps(i)} may use only letters, digits, ".", "_", "~" and "-"')
        elif i in self.ids:
            self.err(where, f'id "{i}" is already used at {self.ids[i][0]}')
        else:
            self.ids[i] = (where, kind)

    def tone(self, v, where, allowed):
        if v is not None and v not in allowed:
            self.err(where, f'tone {json.dumps(v)} must be one of {allowed}')


def check_panel(ck, p, where):
    if p is None:
        return
    if not ck.obj(p, where, 'panel'):
        return
    if p.get('tag') is not None and ck.obj(p['tag'], f'{where}.tag'):
        ck.text(p['tag'].get('text'), f'{where}.tag.text')
        ck.color(p['tag'].get('color'), f'{where}.tag.color')
    for k in ('title', 'bulletsTitle', 'listTitle', 'linksTitle', 'foot'):
        ck.text(p.get(k), f'{where}.{k}')
    ck.text(p.get('text'), f'{where}.text', list_ok=True)
    check_callouts(ck, p.get('callouts'), f'{where}.callouts')
    check_parts(ck, p.get('sections'), f'{where}.sections')
    for k in ('where', 'notes'):
        for i, x in enumerate(ck.lst(p.get(k), f'{where}.{k}')):
            ck.text(x, f'{where}.{k}[{i}]')
    check_bullets(ck, p.get('bullets'), f'{where}.bullets')
    for i, d in enumerate(ck.lst(p.get('list'), f'{where}.list')):
        if ck.obj(d, f'{where}.list[{i}]'):
            ck.text(d.get('b'), f'{where}.list[{i}].b', required=True)
            ck.text(d.get('text'), f'{where}.list[{i}].text', required=True)
    ck.refs += [(r, f'{where}.refs') for r in ck.lst(p.get('refs'), f'{where}.refs') if ck.ident(r, f'{where}.refs', 'a ref')]
    ck.links += [(r, f'{where}.links') for r in ck.lst(p.get('links'), f'{where}.links') if ck.ident(r, f'{where}.links', 'a link')]


def check_labels(ck, v, where):
    if v is None or not ck.obj(v, where, 'labels'):
        return
    for k, x in v.items():
        ck.text(x, f'{where}.{k}')


SCOPE = re.compile(r'\b(only|never|always|every\w*|all|any\w*|nothing|none|except|first|most|no one|each)\b', re.I)


def scope_words(path):
    """Print each scope word with its JSON path, for the SKILL.md self-check."""
    try:
        d = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'error: cannot read {path}: {e}', file=sys.stderr)
        return 1
    n = 0
    for p, s in walk_strings(d):
        for m in SCOPE.finditer(s):
            ctx = s[max(0, m.start() - 50):m.end() + 50].replace('\n', ' ')
            print(f'{p}: ...{ctx}...')
            n += 1
    print(f'{n} scope words. Check each against the whole source: does the source say this, for exactly this set?', file=sys.stderr)
    return 0


def check_bullets(ck, v, where):
    for i, b in enumerate(ck.lst(v, where)):
        if isinstance(b, dict):
            ck.obj(b, f'{where}[{i}]', 'bullet')
            ck.text(b.get('text'), f'{where}[{i}].text', required=True)
            ck.text(b.get('sub'), f'{where}[{i}].sub')
            if b.get('status') not in (None, 'built', 'partly'):
                ck.err(f'{where}[{i}].status', 'status is "built", "partly" or absent')
        else:
            ck.text(b, f'{where}[{i}]')


def check_callouts(ck, v, where):
    for i, c in enumerate(ck.lst(v, where)):
        if ck.obj(c, f'{where}[{i}]', 'callout'):
            ck.text(c.get('text'), f'{where}[{i}].text', required=True, list_ok=True)
            ck.text(c.get('label'), f'{where}[{i}].label')
            ck.tone(c.get('tone'), f'{where}[{i}]', ['wait', 'gap', 'note', 'built'])


def check_parts(ck, v, where):
    for i, s in enumerate(ck.lst(v, where)):
        if ck.obj(s, f'{where}[{i}]', 'part'):
            ck.text(s.get('title'), f'{where}[{i}].title')
            ck.text(s.get('label'), f'{where}[{i}].label')
            ck.text(s.get('text'), f'{where}[{i}].text', list_ok=True)
            ck.tone(s.get('tone'), f'{where}[{i}]', ['wait', 'gap', 'built'])
            for k in ('where', 'notes'):
                for j, x in enumerate(ck.lst(s.get(k), f'{where}[{i}].{k}')):
                    ck.text(x, f'{where}[{i}].{k}[{j}]')
            check_bullets(ck, s.get('bullets'), f'{where}[{i}].bullets')


def check_flags(ck, v, where):
    for i, f in enumerate(ck.lst(v, where)):
        if ck.obj(f, f'{where}[{i}]', 'flag'):
            ck.text(f.get('h'), f'{where}[{i}].h', required=True)
            ck.text(f.get('p'), f'{where}[{i}].p', required=True)
            ck.text(f.get('src'), f'{where}[{i}].src')
            ck.text(f.get('n'), f'{where}[{i}].n', num_ok=True)


def check_journey(ck, tab, tw):
    stages = ck.lst(tab.get('stages'), f'{tw}.stages', required=True, nonempty=True)
    lanes = ck.lst(tab.get('lanes'), f'{tw}.lanes', required=True, nonempty=True)
    items = ck.lst(tab.get('items'), f'{tw}.items', required=True, nonempty=True)
    stage_ids, lane_ids = [], []
    has_foot_lines = False
    for i, s in enumerate(stages):
        if not ck.obj(s, f'{tw}.stages[{i}]', 'stage'):
            continue
        sid = s.get('id')
        if sid is not None and not isinstance(sid, str):
            ck.err(f'{tw}.stages[{i}]', f'"id" must be text, got {type(sid).__name__}')
            continue
        if not sid:
            ck.err(f'{tw}.stages[{i}]', 'missing "id"')
        elif sid in stage_ids:
            ck.err(f'{tw}.stages[{i}]', f'stage id "{sid}" is used twice in this tab')
        else:
            stage_ids.append(sid)
        ck.text(s.get('name'), f'{tw}.stages[{i}].name', required=True)
        ck.text(s.get('sub'), f'{tw}.stages[{i}].sub')
        for j, x in enumerate(ck.lst(s.get('foot'), f'{tw}.stages[{i}].foot')):
            ck.text(x, f'{tw}.stages[{i}].foot[{j}]')
            has_foot_lines = True
    for i, l in enumerate(lanes):
        if not ck.obj(l, f'{tw}.lanes[{i}]', 'lane'):
            continue
        lid = l.get('id')
        if lid is not None and not isinstance(lid, str):
            ck.err(f'{tw}.lanes[{i}]', f'"id" must be text, got {type(lid).__name__}')
            continue
        if not lid:
            ck.err(f'{tw}.lanes[{i}]', 'missing "id"')
        elif lid in lane_ids:
            ck.err(f'{tw}.lanes[{i}]', f'lane id "{lid}" is used twice in this tab')
        else:
            lane_ids.append(lid)
        ck.text(l.get('none'), f'{tw}.lanes[{i}].none')
        ck.text(l.get('name'), f'{tw}.lanes[{i}].name', required=True)
        if isinstance(l.get('name'), str) and len(l['name']) > 26:
            ck.warn(f'{tw}.lanes[{i}].name', f'"{l["name"]}" is {len(l["name"])} characters; about 13 fit on a line of the row label, so keep it to two lines')
        ck.text(l.get('sub'), f'{tw}.lanes[{i}].sub')
        ck.color(l.get('color'), f'{tw}.lanes[{i}].color')
        check_panel(ck, l.get('panel'), f'{tw}.lanes[{i}].panel')
        lp = l.get('panel')
        if isinstance(lp, dict) and any(k in lp for k in ('tag', 'title', 'links')):
            ck.warn(f'{tw}.lanes[{i}].panel', 'a row panel always shows the row name, its tag and its boxes; "tag", "title" and "links" here are replaced')
    n = len(stages)
    if n and not 4 <= n <= 7:
        ck.warn(f'{tw}.stages', f'{n} steps; 4 to 7 read best')
    if lanes and not 2 <= len(lanes) <= 4:
        ck.warn(f'{tw}.lanes', f'{len(lanes)} rows; 2 to 4 read best')
    spans = []
    for i, sp in enumerate(ck.lst(tab.get('spans'), f'{tw}.spans')):
        if not ck.obj(sp, f'{tw}.spans[{i}]', 'span'):
            continue
        ck.text(sp.get('label'), f'{tw}.spans[{i}].label', required=True)
        ck.tone(sp.get('tone'), f'{tw}.spans[{i}]', ['quiet'])
        if ck.number(sp.get('from'), f'{tw}.spans[{i}].from', 1, n, integer=True) and ck.number(sp.get('to'), f'{tw}.spans[{i}].to', 1, n, integer=True):
            if sp['from'] > sp['to']:
                ck.err(f'{tw}.spans[{i}]', '"from" is after "to"')
            spans.append((sp['from'], sp['to'], sp.get('label')))
    spans.sort(key=lambda x: (x[0], x[1]))
    for a, b in zip(spans, spans[1:]):
        if b[0] <= a[1]:
            ck.err(f'{tw}.spans', f'spans overlap: "{a[2]}" ends at step {a[1]}, "{b[2]}" starts at step {b[0]} ("to" is inclusive)')
    if tab.get('colMin') is not None:
        ck.number(tab['colMin'], f'{tw}.colMin', positive=True)
    check_labels(ck, tab.get('labels'), f'{tw}.labels')
    ck.text(tab.get('hint'), f'{tw}.hint')
    ck.text(tab.get('flagsTitle'), f'{tw}.flagsTitle')
    check_panel(ck, tab.get('panel'), f'{tw}.panel')
    for i, t in enumerate(ck.lst(tab.get('tagLegend'), f'{tw}.tagLegend')):
        if ck.obj(t, f'{tw}.tagLegend[{i}]', 'legend'):
            ck.text(t.get('text'), f'{tw}.tagLegend[{i}].text', required=True)
            ck.text(t.get('meaning'), f'{tw}.tagLegend[{i}].meaning', required=True)
            ck.tone(t.get('tone'), f'{tw}.tagLegend[{i}]', ['wait', 'gap'])
    foot = tab.get('foot')
    if foot is not None and ck.obj(foot, f'{tw}.foot', 'foot'):
        ck.text(foot.get('label'), f'{tw}.foot.label', required=True)
        ck.text(foot.get('empty'), f'{tw}.foot.empty')
        check_panel(ck, foot.get('panel'), f'{tw}.foot.panel')
    if has_foot_lines and foot is None:
        ck.warn(f'{tw}', 'stages have "foot" lines but the tab has no "foot" row, so they are never shown')
    per_cell = {}
    for i, it in enumerate(items):
        iw = f'{tw}.items[{i}]'
        if not ck.obj(it, iw, 'item'):
            continue
        iw = f'{iw} ({it.get("id")})'
        ck.claim(it.get('id'), iw, 'item')
        if not isinstance(it.get('stage'), str) or it.get('stage') not in stage_ids:
            ck.err(iw, f'stage {json.dumps(it.get("stage"))} is not one of {sorted(map(str, stage_ids))}')
        if not isinstance(it.get('lane'), str) or it.get('lane') not in lane_ids:
            ck.err(iw, f'lane {json.dumps(it.get("lane"))} is not one of {sorted(map(str, lane_ids))}')
        ck.text(it.get('text'), f'{iw}.text', required=True)
        ck.text(it.get('plain'), f'{iw}.plain', list_ok=True)
        if not it.get('plain'):
            ck.warn(iw, 'no "plain" sentence; the panel opens with nothing to read')
        if it.get('tag') is not None and ck.obj(it['tag'], f'{iw}.tag'):
            ck.text(it['tag'].get('text'), f'{iw}.tag.text', required=True)
            if it['tag'].get('tone') not in ('wait', 'gap'):
                ck.err(f'{iw}.tag', 'tone must be "wait" or "gap"; a box carries only warnings')
        check_callouts(ck, it.get('callouts'), f'{iw}.callouts')
        check_parts(ck, it.get('parts'), f'{iw}.parts')
        for k in ('where', 'notes'):
            for j, x in enumerate(ck.lst(it.get(k), f'{iw}.{k}')):
                ck.text(x, f'{iw}.{k}[{j}]')
        ck.refs += [(r, iw) for r in ck.lst(it.get('refs'), f'{iw}.refs') if ck.ident(r, f'{iw}.refs', 'a ref')]
        ck.links += [(r, iw) for r in ck.lst(it.get('links'), f'{iw}.links') if ck.ident(r, f'{iw}.links', 'a link')]
        key = (str(it.get('stage')), str(it.get('lane')))
        per_cell[key] = per_cell.get(key, 0) + 1
    if len(items) > 22:
        ck.warn(tw, f'{len(items)} boxes; over about 20 the grid stops reading at a glance. Merge boxes and keep the facts in "parts".')
    for (st, ln), c in per_cell.items():
        if c > 3:
            ck.warn(tw, f'{c} boxes in one cell ({st} / {ln}); merge to 3 or fewer')
    edges = tab.get('edges')
    if edges is not None and ck.obj(edges, f'{tw}.edges'):
        ck.text(edges.get('label'), f'{tw}.edges.label')
        for i, e in enumerate(ck.lst(edges.get('items'), f'{tw}.edges.items')):
            ew = f'{tw}.edges.items[{i}]'
            if not ck.obj(e, ew, 'edge'):
                continue
            ck.claim(e.get('id'), ew, 'edge')
            ck.text(e.get('text'), f'{ew}.text', required=True)
            ck.text(e.get('outcome'), f'{ew}.outcome')
            if not e.get('outcome'):
                ck.warn(ew, 'no "outcome"; the chip shows no arrow and the panel no result line')
            ck.text(e.get('detail'), f'{ew}.detail', list_ok=True)
            check_panel(ck, e.get('panel'), f'{ew}.panel')
            ck.links += [(r, ew) for r in ck.lst(e.get('links'), f'{ew}.links') if ck.ident(r, f'{ew}.links', 'a link')]
    check_flags(ck, tab.get('flags'), f'{tw}.flags')


def check_graph(ck, s, sw):
    nodes = ck.lst(s.get('nodes'), f'{sw}.nodes', required=True, nonempty=True)
    if s.get('colWidth') is not None:
        ck.number(s['colWidth'], f'{sw}.colWidth', 120)
    if s.get('boxHeight') is not None:
        ck.number(s['boxHeight'], f'{sw}.boxHeight', 40)
    if s.get('rowHeight') is not None and ck.number(s['rowHeight'], f'{sw}.rowHeight', positive=True):
        if s['rowHeight'] < (s.get('boxHeight') if isinstance(s.get('boxHeight'), (int, float)) else 76) + 10:
            ck.err(f'{sw}.rowHeight', 'must be at least boxHeight + 10, or rows overlap')
    ck.text(s.get('aria'), f'{sw}.aria')
    for i, l in enumerate(ck.lst(s.get('lanes'), f'{sw}.lanes')):
        ck.text(l, f'{sw}.lanes[{i}]')
    div = s.get('divider')
    if div is not None and ck.obj(div, f'{sw}.divider'):
        ck.number(div.get('beforeRow'), f'{sw}.divider.beforeRow', 0, integer=True)
        ck.text(div.get('label'), f'{sw}.divider.label')
    # a box is colWidth - 20 px wide; about 22 characters fit the default 175 px
    cw = s.get('colWidth') if isinstance(s.get('colWidth'), (int, float)) else 195
    fit = max(8, round((cw - 41) / 7))
    taken = {}
    nid = set()
    lanes_of = {n.get('id'): n.get('lane') for n in nodes if isinstance(n, dict) and isinstance(n.get('id'), str) and isinstance(n.get('lane'), int)}
    for i, n in enumerate(nodes):
        nw = f'{sw}.nodes[{i}]'
        if not ck.obj(n, nw, 'node'):
            continue
        ck.claim(n.get('id'), nw, 'node')
        if isinstance(n.get('id'), str):
            nid.add(n['id'])
        ck.text(n.get('title'), f'{nw}.title', required=True)
        for k in ('short', 'sub', 'refLabel', 'refSub'):
            ck.text(n.get(k), f'{nw}.{k}')
        for j, x in enumerate(ck.lst(n.get('lines'), f'{nw}.lines')):
            ck.text(x, f'{nw}.lines[{j}]')
        shown = n.get('short') or n.get('title')
        if isinstance(shown, str) and len(shown) > fit:
            ck.warn(f'{nw}', f'"{shown}" is {len(shown)} characters; about {fit} fit in a node this wide. Add "short".')
        ok_lane = ck.number(n.get('lane'), f'{nw}.lane', 0, integer=True)
        ok_row = ck.number(n.get('row'), f'{nw}.row', 0, integer=True)
        rows = n.get('rows', 1)
        ok_rows = ck.number(rows, f'{nw}.rows', 1, integer=True)
        if n.get('style') not in (None, 'ext', 'gate'):
            ck.err(nw, 'style is "ext", "gate" or absent')
        if n.get('lines') and isinstance(n.get('lines'), list):
            rh = s.get('rowHeight') if isinstance(s.get('rowHeight'), (int, float)) else 120
            bh = s.get('boxHeight') if isinstance(s.get('boxHeight'), (int, float)) else 76
            h = (rows - 1) * rh + bh if ok_rows else bh
            if 80 + 20 * len(n['lines']) > h:
                ck.warn(nw, f'{len(n["lines"])} "lines" need {80 + 20 * len(n["lines"])} px and the box is {h} px; give the node more "rows"')
        if ok_lane and ok_row and ok_rows:
            for r in range(n['row'], n['row'] + rows):
                if (n['lane'], r) in taken:
                    ck.err(nw, f'sits on top of {taken[(n["lane"], r)]} (lane {n["lane"]}, row {r})')
                else:
                    taken[(n['lane'], r)] = n.get('id')
        check_panel(ck, n.get('panel'), f'{nw}.panel')
    for i, e in enumerate(ck.lst(s.get('edges'), f'{sw}.edges')):
        if not ck.obj(e, f'{sw}.edges[{i}]', 'gedge'):
            continue
        ends = [e.get('from'), e.get('to')]
        if not all(isinstance(x, str) for x in ends) or not all(x in nid for x in ends):
            ck.err(f'{sw}.edges[{i}]', f'{json.dumps(ends[0])} -> {json.dumps(ends[1])} names a node that is not in this graph')
        elif ends[0] == ends[1]:
            ck.warn(f'{sw}.edges[{i}]', f'an arrow from "{ends[0]}" to itself is not drawn')
        elif lanes_of.get(ends[1], 0) < lanes_of.get(ends[0], 0):
            ck.warn(f'{sw}.edges[{i}]', f'"{ends[1]}" sits left of "{ends[0]}", so the arrow runs backwards; put what feeds a node to its left')
    # a graph stays readable at about 12 arrows (the budget from diagram-design) and 3 out of any one box (ours)
    gedges = [e for e in (s.get('edges') or []) if isinstance(e, dict)]
    if len(gedges) > 12:
        ck.warn(f'{sw}.edges', f'{len(gedges)} arrows; over about 12 a graph stops reading. Split it into an overview and a detail graph, or drop arrows the layout already shows')
    outs = {}
    for e in gedges:
        if isinstance(e.get('from'), str):
            outs[e['from']] = outs.get(e['from'], 0) + 1
    for k, c in outs.items():
        if c > 3:
            ck.warn(f'{sw}.edges', f'{c} arrows leave "{k}"; over 3 read as a tangle. Add a hub node they share, or split the graph')


def check_table(ck, s, sw, rows_out):
    cols = ck.lst(s.get('columns'), f'{sw}.columns', required=True, nonempty=True)
    for i, c in enumerate(cols):
        ck.text(c, f'{sw}.columns[{i}]')
    if s.get('maxWidth') is not None:
        ck.number(s['maxWidth'], f'{sw}.maxWidth', positive=True)
    for i, r in enumerate(ck.lst(s.get('rows'), f'{sw}.rows', required=True, nonempty=True)):
        rw = f'{sw}.rows[{i}]'
        if not ck.obj(r, rw, 'row'):
            continue
        if r.get('id') is not None:
            ck.claim(r['id'], rw, 'row')
            if isinstance(r['id'], str):
                rows_out.append((r['id'], rw, r.get('panel') is not None))
        elif r.get('panel') is not None:
            ck.err(rw, 'has a panel but no "id", so the row is not clickable and the panel is never shown; add an id')
        ck.text(r.get('label'), f'{rw}.label')
        cells = ck.lst(r.get('cells'), f'{rw}.cells', required=True)
        if len(cells) != len(cols):
            ck.err(rw, f'has {len(cells)} cells for {len(cols)} columns')
        for j, c in enumerate(cells):
            cw = f'{rw}.cells[{j}]'
            if isinstance(c, dict):
                ck.obj(c, cw, 'cell')
                ck.text(c.get('text'), f'{cw}.text', required=True, num_ok=True)
                ck.tone(c.get('tone'), cw, ['pos', 'neg'])
                if c.get('dot') is not None and ck.obj(c['dot'], f'{cw}.dot', 'dot'):
                    ck.color(c['dot'].get('color'), f'{cw}.dot.color')
            elif c is not None and not isinstance(c, (str, int, float)):
                ck.err(cw, f'expected text or a cell object, got {type(c).__name__}')
        check_panel(ck, r.get('panel'), f'{rw}.panel')


def check_section(ck, s, sw, rows_out):
    t = s.get('type')
    if t not in SECTION_TYPES:
        ck.err(sw, f'type {json.dumps(t)} is not one of {SECTION_TYPES}')
        return
    ck.obj(s, sw, t)
    for k in ('title', 'lede', 'note'):
        ck.text(s.get(k), f'{sw}.{k}')
    items = s.get('items')
    if t == 'flags':
        ck.lst(items, f'{sw}.items', required=True, nonempty=True)
        check_flags(ck, items, f'{sw}.items')
    elif t == 'graph':
        check_graph(ck, s, sw)
    elif t == 'table':
        check_table(ck, s, sw, rows_out)
    elif t == 'bars':
        for i, b in enumerate(ck.lst(items, f'{sw}.items', required=True, nonempty=True)):
            if ck.obj(b, f'{sw}.items[{i}]', 'bar'):
                ck.text(b.get('label'), f'{sw}.items[{i}].label', required=True)
                ck.text(b.get('note'), f'{sw}.items[{i}].note')
                ck.text(b.get('display'), f'{sw}.items[{i}].display', num_ok=True)
                ck.number(b.get('value'), f'{sw}.items[{i}].value', 0)
                ck.color(b.get('color'), f'{sw}.items[{i}].color')
        if s.get('maxBar') is not None:
            ck.number(s['maxBar'], f'{sw}.maxBar', positive=True)
        for i, x in enumerate(ck.lst(s.get('takeaways'), f'{sw}.takeaways')):
            ck.text(x, f'{sw}.takeaways[{i}]')
    elif t in ('stats', 'cards', 'defs'):
        need = {'stats': ('big', 'text'), 'cards': ('title', 'text'), 'defs': ('b', 'text')}[t]
        for i, x in enumerate(ck.lst(items, f'{sw}.items', required=True, nonempty=True)):
            if ck.obj(x, f'{sw}.items[{i}]', t + 'Item'):
                for k in need:
                    ck.text(x.get(k), f'{sw}.items[{i}].{k}', required=True, num_ok=(k == 'big'))
    elif t == 'meter':
        ck.text(s.get('left'), f'{sw}.left')
        ck.text(s.get('right'), f'{sw}.right')
        fill = s.get('fill')
        if fill is not None and ck.obj(fill, f'{sw}.fill'):
            ck.number(fill.get('pct'), f'{sw}.fill.pct', 0, 100)
            ck.color(fill.get('color'), f'{sw}.fill.color')
        for i, tk in enumerate(ck.lst(s.get('ticks'), f'{sw}.ticks')):
            if ck.obj(tk, f'{sw}.ticks[{i}]', 'tick'):
                ck.number(tk.get('at'), f'{sw}.ticks[{i}].at', 0, 100)
                ck.text(tk.get('label'), f'{sw}.ticks[{i}].label', required=True, num_ok=True)
                ck.text(tk.get('sub'), f'{sw}.ticks[{i}].sub')
                if tk.get('align') not in (None, 'l', 'r'):
                    ck.err(f'{sw}.ticks[{i}]', 'align is "l", "r" or absent')
    elif t in ('checklist', 'pills'):
        for i, x in enumerate(ck.lst(items, f'{sw}.items', required=True, nonempty=True)):
            if isinstance(x, dict) and t == 'checklist':
                ck.obj(x, f'{sw}.items[{i}]', 'checkItem')
                ck.text(x.get('text'), f'{sw}.items[{i}].text', required=True)
            else:
                ck.text(x, f'{sw}.items[{i}]')
    elif t == 'prose':
        for i, x in enumerate(ck.lst(s.get('paragraphs'), f'{sw}.paragraphs', required=True, nonempty=True)):
            ck.text(x, f'{sw}.paragraphs[{i}]')


def walk_strings(node, path=''):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f'{path}.{k}' if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f'{path}[{i}]')


def validate(d):
    ck = Check()
    if not ck.obj(d, 'root', 'root'):
        return ck
    meta = d.get('meta')
    if meta is None:
        ck.err('meta', 'missing; it needs at least "title"')
    elif ck.obj(meta, 'meta', 'meta'):
        ck.text(meta.get('title'), 'meta.title', required=True)
        t = meta.get('title')
        if isinstance(t, str) and t.strip():
            if len(t) > 100:
                ck.err('meta.title', f'{len(t)} characters; keep the page name under 100 (2 to 4 words)')
            elif not 2 <= len(t.split()) <= 4:
                ck.warn('meta.title', f'"{t}" is {len(t.split())} words; a page name is 2 to 4 words')
        for k in ('eyebrow', 'headline', 'source'):
            ck.text(meta.get(k), f'meta.{k}')
        for i, x in enumerate(ck.lst(meta.get('stats'), 'meta.stats')):
            ck.text(x, f'meta.stats[{i}]')
        if not meta.get('source'):
            ck.warn('meta', 'no "source"; say where the facts come from and as of when')
    tabs = ck.lst(d.get('tabs'), 'tabs', required=True, nonempty=True)
    tab_ids = set()
    rows = []
    for ti, tab in enumerate(tabs):
        tw = f'tabs[{ti}]'
        if not ck.obj(tab, tw):
            continue
        tid = tab.get('id')
        if not isinstance(tid, str) or not TAB_ID.fullmatch(tid) or tid in tab_ids:
            ck.err(tw, f'needs a unique "id" of letters, digits, "_" or "-" (it is the page #link); got {json.dumps(tid)[:40]}')
        if isinstance(tid, str):
            tab_ids.add(tid)
        ck.text(tab.get('label'), f'{tw}.label', required=True)
        typ = tab.get('type')
        if typ == 'journey':
            ck.obj(tab, tw, 'journey')
            check_journey(ck, tab, tw)
        elif typ == 'page':
            ck.obj(tab, tw, 'page')
            for k in ('title', 'lede'):
                ck.text(tab.get(k), f'{tw}.{k}')
            check_labels(ck, tab.get('labels'), f'{tw}.labels')
            check_panel(ck, tab.get('panel'), f'{tw}.panel')
            for si, s in enumerate(ck.lst(tab.get('sections'), f'{tw}.sections', required=True, nonempty=True)):
                if ck.obj(s, f'{tw}.sections[{si}]'):
                    check_section(ck, s, f'{tw}.sections[{si}]', rows)
        else:
            ck.err(tw, f'type {json.dumps(typ)} is not "journey" or "page"')
    for r, w in ck.refs:
        kind = ck.ids.get(r, (None, None))[1]
        if kind is None:
            ck.err(w, f'ref {json.dumps(r)} points at nothing')
        elif kind not in ('node', 'row'):
            ck.err(w, f'ref "{r}" is a {kind}; refs point at a graph node or a table row (use "links" for boxes and chips)')
    for r, w in ck.links:
        if r not in ck.ids:
            ck.err(w, f'link {json.dumps(r)} points at nothing')
    referenced = {r for r, _ in ck.refs}
    for rid, rw, has_panel in rows:
        if not has_panel and rid not in referenced:
            ck.warn(rw, f'row "{rid}" has an id but no panel and nothing refers to it; drop the id or add a panel')
    # punctuation and symbols outside ASCII read as machine-written; letters in any language are fine
    for path, s in walk_strings(d):
        for i, ch in enumerate(s):
            if ord(ch) > 127 and unicodedata.category(ch)[0] not in 'LMN':
                name = unicodedata.name(ch, 'unnamed character').lower()
                ctx = s[max(0, i - 25):i + 25].replace('\n', ' ')
                ck.warn(path, f'U+{ord(ch):04X} {name} in "...{ctx}..."; write plain ASCII punctuation')
                break
    return ck


def load_theme(arg, ck):
    if arg.endswith('.json'):
        path = arg
    else:
        path = os.path.join(HERE, 'themes', arg + '.json')
        if not os.path.exists(path):
            names = sorted(f[:-5] for f in os.listdir(os.path.join(HERE, 'themes')) if f.endswith('.json'))
            ck.err('--theme', f'unknown theme "{arg}"; use one of {names} or a path to a .json file')
            return None, None
    try:
        theme = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError) as e:
        ck.err('--theme', f'cannot read {path}: {e}')
        return None, None
    if not isinstance(theme, dict):
        ck.err(path, 'a theme file must hold one JSON object')
        return None, None
    ref = json.load(open(os.path.join(HERE, 'themes', 'neutral.json')))
    for k in ('fontSans', 'fontMono'):
        if not isinstance(theme.get(k), str) or UNSAFE_CSS.search(theme.get(k)):
            ck.err(path, f'"{k}" must be a CSS font stack with no < > {{ }} ;')
    for mode in ('light', 'dark'):
        got = theme.get(mode)
        if not isinstance(got, dict):
            ck.err(path, f'"{mode}" must be an object of color tokens')
            continue
        missing = sorted(set(ref[mode]) - set(got))
        if missing:
            ck.err(path, f'"{mode}" is missing tokens {missing}')
        for k, v in got.items():
            if not isinstance(k, str) or not TOKEN_KEY.fullmatch(k):
                ck.err(path, f'"{mode}" token name {json.dumps(k)} may use only a-z, 0-9 and "-"')
            elif not isinstance(v, str) or not COLOR_VALUE.fullmatch(v.strip()):
                ck.err(path, f'"{mode}.{k}" = {json.dumps(v)[:40]} is not a CSS color (hex, rgb(), hsl(), oklch() or a color name)')
    if not isinstance(theme.get('fontFiles', []), list):
        ck.err(path, '"fontFiles" must be a list of {family, file, weight}')
    return theme, os.path.dirname(os.path.abspath(path))


FONT_TYPES = {'.woff2': ('font/woff2', 'woff2'), '.woff': ('font/woff', 'woff'), '.ttf': ('font/ttf', 'truetype'), '.otf': ('font/otf', 'opentype')}


def theme_css(theme, theme_dir, ck):
    fonts = []
    for i, f in enumerate(theme.get('fontFiles', [])):
        if not isinstance(f, dict) or not isinstance(f.get('family'), str) or not isinstance(f.get('file'), str) or not f['family'] or not f['file']:
            ck.err(f'theme fontFiles[{i}]', 'needs "family" and "file" as text')
            continue
        if UNSAFE_CSS.search(f['family'] + str(f.get('weight', ''))):
            ck.err(f'theme fontFiles[{i}]', '"family" and "weight" may not hold < > { } ;')
            continue
        path = os.path.expanduser(f['file'])
        if not os.path.isabs(path):
            path = os.path.join(theme_dir, path)
        ext = os.path.splitext(path)[1].lower()
        if ext not in FONT_TYPES:
            ck.err(f'theme fontFiles[{i}]', f'{ext or "no extension"} is not a font file this builder knows ({", ".join(FONT_TYPES)})')
            continue
        if not os.path.exists(path):
            ck.warn(f'theme fontFiles[{i}]', f'font file not found, the page uses the fallback stack: {path}')
            continue
        mime, fmt_name = FONT_TYPES[ext]
        b64 = base64.b64encode(open(path, 'rb').read()).decode('ascii')
        fonts.append("@font-face { font-family: '%s'; src: url(data:%s;base64,%s) format('%s'); font-weight: %s; font-style: normal; font-display: swap; }"
                     % (str(f['family']).replace("'", ''), mime, b64, fmt_name, f.get('weight', '400')))

    def block(tokens):
        return ' '.join(f'--{k}: {v};' for k, v in tokens.items())
    light = dict(theme['light'], **{'font-sans': theme['fontSans'], 'font-mono': theme['fontMono']})
    dark = theme['dark']
    css = (f':root {{ {block(light)} color-scheme: light; }}\n'
           f'@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ {block(dark)} color-scheme: dark; }} }}\n'
           f':root[data-theme="dark"] {{ {block(dark)} color-scheme: dark; }}')
    return '\n'.join(fonts), css.replace('<', '\\3c ')


STANDALONE_HEAD = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
                   '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                   '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style>\n')


def standalone(page):
    """Wrap the page in a full document: title and style go in <head>; the claude meta is dropped.

    A strict Content-Security-Policy is added: only the page's own inline scripts run (pinned by
    hash), styles and data: fonts are allowed, and nothing may be loaded from the network.
    """
    head = []
    for pat in (r'\s*<title>.*?</title>', r'\s*<meta name="claude:[^"]*" content="[^"]*">', r'\s*<style>.*?</style>'):
        m = re.match(pat, page, re.S)
        if m:
            if 'claude:' not in m.group(0):
                head.append(m.group(0).strip())
            page = page[m.end():]
    hashes = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(src.encode('utf-8')).digest()).decode('ascii')
                      for src in re.findall(r'<script>(.*?)</script>', page, re.S))
    csp = ("default-src 'none'; script-src %s; style-src 'unsafe-inline'; img-src data:; font-src data:; "
           "base-uri 'none'; form-action 'none'" % hashes)
    head.insert(0, '<meta http-equiv="Content-Security-Policy" content="%s">' % csp)
    return (STANDALONE_HEAD + '\n'.join(head) + '\n</head>\n<body>\n' + page.lstrip('\n') + '\n</body>\n</html>\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('data')
    ap.add_argument('--theme', default='neutral')
    ap.add_argument('--out')
    ap.add_argument('--strict', action='store_true', help='treat warnings as errors')
    ap.add_argument('--standalone', action='store_true', help='wrap in a full HTML document, for hosting outside an Artifact')
    ap.add_argument('--scope-words', action='store_true', help='list every only/never/always/every/all/any/nothing/except/first/most for the self-check, then stop')
    a = ap.parse_args()

    if a.scope_words:
        sys.exit(scope_words(a.data))
    try:
        d = json.load(open(a.data, encoding='utf-8'), parse_constant=no_constants)
    except UnicodeDecodeError:
        print(f'error: {a.data} is not UTF-8 text', file=sys.stderr)
        sys.exit(1)
    except OSError as e:
        print(f'error: cannot read {a.data}: {e}', file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f'error: {a.data} line {e.lineno} column {e.colno}: {e.msg}', file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f'error: {a.data}: {e}', file=sys.stderr)
        sys.exit(1)

    ck = validate(d)
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.data)), 'index.html')
    if os.path.realpath(out) == os.path.realpath(a.data):
        ck.err('--out', 'points at the data file; the build would overwrite your data')
    elif not out.endswith('.html'):
        ck.err('--out', f'{out} does not end in .html')
    theme, theme_dir = load_theme(a.theme, ck)
    fonts = css = None
    if theme and not ck.errors:
        fonts, css = theme_css(theme, theme_dir, ck)

    html = None
    if not ck.errors:
        d['theme'] = {'name': theme.get('name'), 'headlineDot': bool(theme.get('headlineDot'))}
        shell = open(os.path.join(HERE, 'engine', 'shell.html')).read()
        engine = open(os.path.join(HERE, 'engine', 'engine.js')).read()
        # every '<' in the data becomes <, so no text can close the script or open a comment
        data = json.dumps(d, ensure_ascii=True, separators=(',', ':')).replace('<', '\\u003c')
        title = d['meta']['title'].strip().replace('&', '&amp;').replace('<', '&lt;')
        values = {'TITLE': title, 'FONTS': fonts, 'THEME': css, 'DATA': data, 'ENGINE': engine}
        # one pass: text put in from the data is never scanned for placeholders again
        html = re.sub(r'/\*__(TITLE|FONTS|THEME|DATA|ENGINE)__\*/(null)?', lambda m: values[m.group(1)], shell)
        if a.standalone:
            html = standalone(html)
        size = len(html.encode('utf-8'))
        if size > MAX_BYTES:
            ck.err('output', f'{size / 1048576:.1f} MB; an Artifact page must stay under 16 MB (fonts are the usual cause)')
        elif size > 15 * 1024 * 1024:
            ck.warn('output', f'{size / 1048576:.1f} MB, close to the 16 MB Artifact limit')
        if html.find('</title>') > 8000:
            ck.err('output', '<title> ends past the first 8 KB of the page; shorten meta.title')

    for w in ck.warnings:
        print('warning:', w, file=sys.stderr)
    for e in ck.errors:
        print('error:', e, file=sys.stderr)
    if ck.errors or (a.strict and ck.warnings):
        print(f'not built: {len(ck.errors)} errors, {len(ck.warnings)} warnings' + (' (--strict)' if not ck.errors else ''), file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w') as f:
        f.write(html)
    n_items = sum(len(t.get('items') or []) for t in d['tabs'] if t.get('type') == 'journey')
    print(f'wrote {out} ({len(html.encode("utf-8")) // 1024} KB): {len(d["tabs"])} tabs, {n_items} boxes, {len(ck.warnings)} warnings')


if __name__ == '__main__':
    main()
