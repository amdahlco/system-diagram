# Data file schema

One JSON file describes the whole page. `build.py` checks it and refuses to build on an error,
naming the field. The example is `examples/skeleton/data.json`: a short made-up flow (library
book holds) that uses every tab and section type. Start from this one.

**Marks.** Text fields accept `**bold**` and `` `code` `` and nothing else; bold may wrap code,
as in `` **Run `x` first** ``. Everything else is escaped, so `<`, `&` and quotes are safe as they are.
Two places drop the marks: `where` entries (already shown as code) and text inside the build-plan
graph (node titles, subs, lines, lane labels), which SVG cannot style.

**Colors** are theme tokens: `c1` to `c6` (row colors), `accent`, `pos`, `neg`, `faint`, `muted`,
`ink`. A literal `#hex` works but ignores dark mode, so the build warns.

**Ids.** A tab id uses letters, digits, `_` and `-` (it is the page's `#link`). Every other id
(boxes, chips, graph nodes, table rows) uses letters, digits, `.`, `_`, `~` and `-`, and is
unique across the whole file.

## Top level

```json
{
  "meta": {
    "title": "Library Book Holds",
    "eyebrow": "Example diagram, made-up data",
    "headline": "From a search to a book on the shelf at home",
    "stats": ["ready in **2 days** on average", "holds kept **7 days**"],
    "source": "Source: the holds spec (Notion), as of 22 Oct 2026, 14:05 UTC."
  },
  "tabs": [ { "type": "journey", ... }, { "type": "page", ... } ]
}
```

- `title` (required): the page name, 2 to 4 words, under 100 characters. It is the browser tab and
  gallery name.
- `headline`: the one-line thesis above the tabs. `eyebrow`: the small line above the headline.
- `stats`: 2 or 3 short facts at the top right. They are read with no context, so a number that
  only holds in some cases says which case.
- `source`: where the facts come from and as of when, and anything you did not read. It shows at
  the foot of every default panel.

## Tab: journey (the grid)

Steps run across, who does each part runs down. Clicking a box opens the panel on the right.

```json
{
  "id": "flow", "label": "What a reader goes through", "type": "journey",
  "hint": "Across: what happens to a hold. Down: who does each part.",
  "colMin": 128, "numbered": true,
  "labels": { "where": "Where it lives", "none": "Nothing to build. The reader does this." },
  "panel": { "title": "What a reader goes through", "text": ["...", "..."] },
  "tagLegend": [ { "text": "waits on", "tone": "wait", "meaning": "needs work in flight elsewhere." } ],
  "spans": [ { "label": "Online", "from": 1, "to": 3 }, { "label": "At the desk", "from": 4, "to": 5, "tone": "quiet" } ],
  "stages": [ { "id": "ask", "name": "Ask", "sub": "search and request", "foot": ["request received"] } ],
  "lanes": [ { "id": "reader", "name": "The reader", "sub": "What they click and do.", "color": "c1" } ],
  "foot": { "label": "Messages sent", "empty": "none", "panel": { ... } },
  "items": [ ... ],
  "edges": { "label": "When it goes another way", "items": [ ... ] },
  "flagsTitle": "Found while drawing this",
  "flags": [ { "n": 1, "h": "Two hold periods", "p": "The help page says 7 days; the email says 5.", "src": "Found while drawing this" } ]
}
```

- `stages` (required): 4 to 7 steps in order, each `{ id, name, sub, foot }`. `foot` is an optional
  list of short lines shown under that step in the footnote row.
- `lanes` (required): 2 to 4 rows, each `{ id, name, sub, color, panel, none }`. About 13 characters of a
  name fit on a line of the row label; keep names to two lines.
- `items` (required): the boxes, below.
- `spans`: optional brackets over the step headers. `from` and `to` are 1-based step numbers, `to`
  is inclusive, and spans may not overlap. `tone: "quiet"` draws one grey.
- `foot`: an optional footnote row under the grid: any short per-step lines (the messages sent,
  the records kept, the alerts raised). Clicking it opens `foot.panel`, which also lists every
  step's lines. `empty` is shown under a step with no lines. Each line must be something the
  source says exists.
- `edges`: chips under the grid for the cases where the flow goes another way.
- `flags`: red callouts under the grid for contradictions and open questions about the grid
  itself. `flagsTitle` heads them.
- `colMin`: the narrowest a step column may get, in px, as a number (default 128). With 7 steps,
  112 fits at 1440 px.
- `numbered: false` hides the step numbers.
- `tagLegend`: explains the tags in the default panel. Word `meaning` for this diagram (for a
  running system, `gap` usually means "a known limit"; for a spec, "needed and not built").
- `labels`: wording the engine uses. `where` heads the code-location list (default "Where it
  lives"). `none` is shown under that heading when a box has no `where`, `refs` or `parts`, so
  word it as an answer to it, for any row: "The source names nothing to build for this." A row's
  own `none` overrides it for that row's boxes ("Nothing to build. The reader does this.").
  It never shows on a box with a tag or a wait or gap callout. Empty by default.
  The others, with their defaults: `notes` (heads a box's notes, "Notes"), `links` (heads the
  connected boxes, "Connected to"), `step` (in a box's tag line, "step"), `optional` (the line on
  an optional box, "optional"), `tags` (heads the tag legend, "Tags on a box"), `row` (the tag on a
  row's panel, "Row"), `rowItems` (heads a row's boxes, "Its boxes"), `showAll` (the button that
  clears a row filter, "Show every row"), `footList` (heads the footnote lines by step, "By
  step"), `scrollHint` (the line above a grid that scrolls sideways, "Scroll sideways for every
  step."), `refBy` (heads the boxes that point at a node or row, "Boxes that use it").

When the steps do not fit (always on a phone, sometimes on a laptop) the grid scrolls sideways
inside its own box, by design, and a hint line shows above it.

### Items (the boxes)

```json
{
  "id": "pickcopy", "stage": "hold", "lane": "system",
  "text": "Picks a copy and sets it aside",
  "plain": "When a copy is returned, the catalogue gives it to the first reader in the queue.",
  "tag": { "text": "waits on the van schedule", "tone": "wait" },
  "optional": false,
  "callouts": [ { "label": "Waits on", "text": "The van schedule.", "tone": "wait" } ],
  "refs": ["n-queue"],
  "where": ["holds/pick.py"],
  "notes": ["The nearest branch comes first."],
  "parts": [ { "title": "Chooses the copy", "text": "...", "where": [], "notes": [], "bullets": [] },
             { "title": "Moves it between branches", "tone": "wait", "label": "Waits on", "text": "..." } ],
  "links": ["queue", "shelf", "e-lost"]
}
```

- `text` (required): the box label: what happens, in the reader's words, 8 words or fewer.
- `plain`: the first sentence of the panel, with no code names. A string or a list of paragraphs.
- `tag`: the one warning on the box. `tone` is `wait` (blocked on other work) or `gap` (needed and
  not built, or a known limit). Nothing that is not a warning goes on a box.
- `optional: true` draws the box dashed with an "optional" line (after the tag, if it has one).
  Use it only when the source calls the step optional.
- `callouts`: highlighted lines in the panel, `{ label, text, tone }`; tone `wait` (the default),
  `gap`, `note` or `built` (green: what is already built, for a spec whose code is landing).
- `refs`: ids of graph nodes or table rows on other tabs (the build piece, a catalogue row). They
  show as links after the plain sentence and callouts, and the target's panel lists the boxes
  (and the panels) that point at it. `refs` never point at boxes or chips; use
  `links` for those.
- `where`: code locations, routes, tables, config: anything an engineer looks up. Shown as code;
  bold and code marks are dropped.
- `notes`: bullet points under "Notes".
- `parts`: for a merged box, one section per box it replaced, each `{ title, text, where, notes,
  bullets }`. `tone: "gap"`, `"wait"` or `"built"` shows that part's text as a callout headed
  `label` (default "Not built yet", "Waits on" or "Built so far"). When a box has `parts`, its own `where` and `notes`
  are still shown after them; keep each fact under the part it belongs to.
- `links`: ids of boxes or chips this box feeds or depends on. Links work both ways: listing B on
  A also lists A on B, for boxes and chips alike. Selecting a box lights up its links and fades the
  rest.

### Edges (the chips)

```json
{ "id": "e-lost", "text": "The copy is lost", "outcome": "the next copy is used",
  "detail": "Staff mark it lost, and the catalogue picks another copy.", "links": ["pickcopy"], "panel": { } }
```

- `text` (required): the case. `outcome`: what happens then. The panel shows the outcome in bold
  and adds a period unless it already ends in `.`, `!`, `?`, a quote or a bracket.
- `detail`: a string or a list of paragraphs. `panel`: any panel fields to add.

## Tab: page (everything else)

```json
{ "id": "build", "label": "Build plan", "type": "page", "title": "Build plan",
  "lede": "Two pieces, then the change goes live.", "count": 3,
  "panel": { "title": "Build plan", "text": "Click a box for its changes." },
  "labels": { "refBy": "Boxes that use it" },
  "sections": [ ... ] }
```

`sections` is required and non-empty. `count` (on a page or a journey tab) shows a small number
on the tab. `panel` is what the
side panel shows before anything is clicked (default: the tab's title and lede). `labels.refBy`
heads the list of boxes that point at a node or row on this tab.

Every section takes `type` and an optional `title` (small caps heading), `lede` (a line under the
heading) and `note` (a line after the section).

| `type` | Fields |
| --- | --- |
| `flags` | `items: [{ n, h, p, src }]` (required). Red callouts. `n` is the number shown (default: the position); `src` says where the item comes from. |
| `graph` | A dependency diagram. `lanes` (column labels), `nodes` (required), `edges: [{ from, to, dashed }]`, `divider: { beforeRow, label }`, `colWidth` (default 215: a 175 px box and a 40 px gap for arrows), `rowHeight` (120), `boxHeight` (76), `aria`. |
| `table` | `columns` (required), `rows: [{ id, label, cells, panel }]` (required), `maxWidth`. A row is clickable when it has an `id` and either a `panel` or any `refs` (a box's or a panel's) that name it; its first cell becomes a button. A row with a `panel` needs an `id`. `label` is the name a `refs` link shows (default: the first cell). |
| `bars` | `items: [{ label, value, display, note, color }]` (required; `value` a number of 0 or more), `takeaways`, `maxBar` (px, default 300). Bars scale to the largest value; the longest is `maxBar` px wide, or 40% of the screen width when that is less. `display` is shown instead of the number (for "$1.2M"). `color` defaults to `c2`. A note that does not fit beside its bar wraps under it. |
| `stats` | `items: [{ big, text }]` (required; `big` is text or a number), up to 4 across. |
| `cards` | `items: [{ title, text }]` (required), up to 5 across. |
| `meter` | `left`, `right`, `fill: { pct, color }`, `ticks: [{ at, label, sub, align, mark }]`. `at` and `pct` are 0 to 100. `align` is `l` or `r` (default: by position); `mark: false` hides the tick line. |
| `checklist` | `items` (required): text, or `{ text, done, go }`. `go` marks the final step in the accent color. |
| `pills` | `items` (required): text. For "Later" lists. |
| `defs` | `items: [{ b, text }]` (required). A bold lead-in, then the text. For decisions and terms. |
| `prose` | `paragraphs` (required): text. |

### Graph nodes

```json
{ "id": "n-queue", "title": "1. Queue rules", "short": "Queue rules", "sub": "catalogue, 2 changes",
  "lane": 1, "row": 0, "rows": 2, "style": "ext", "lines": ["one more line"],
  "refLabel": "Piece 1: Queue rules", "refSub": "catalogue",
  "panel": { "text": "**Needs:** the van schedule.",
             "sections": [ { "title": "Changes", "bullets": [ { "text": "Nearest copy first", "sub": "holds/pick.py", "status": "built" } ] } ] } }
```

- `colWidth` is at least 120, `boxHeight` at least 40, and `rowHeight` at least `boxHeight` + 10.
- `lane` and `row` are whole numbers from 0. Rows are 120 px apart; rows at or below
  `divider.beforeRow` sit under a labelled line. Two nodes may not share a lane and row.
- `rows: 2` or more makes a tall node, for a go-live box that several arrows reach. An arrow into a
  tall node arrives level with its source.
- `style`: `ext` (dashed: outside work this plan waits on) or `gate` (filled: the go-live step).
- `lines`: extra text lines, drawn from 80 px down, 20 px apart; give the node enough `rows` to
  hold them (the build warns).
- `short`: a shorter title when the full one is too wide (about 22 characters fit).
- `refLabel` / `refSub`: how a box's `refs` link names this node (default: `title` and `sub`).

Arrows are drawn at right angles. Each one leaves and enters a box at its own point on the side and
turns in the gap beside its column, which holds three arrow lanes before arrows share one. An
arrow that crosses a column runs through a gap between rows that is clear in every column it
passes (or under the lowest row), never behind a box. Where two arrows cross, the lesser one
hops: a dashed arrow hops a solid one, and between two of a kind the later one in `edges` hops.
An arrow to a node in the same column runs from the bottom of one box to the top of the other,
or round through the gap on the right when a box sits between them. Place what feeds a node to
its left: an arrow to a column on the left works but warns. The build also warns when a graph
has more than 12 arrows or more than 3 leave one node; split it into an overview and a detail
graph instead.

### Table cells

A cell is text, or `{ text, b, mono, muted, tone, dot }`. `tone` is `pos` or `neg`. `dot: { color,
hollow }` draws a status dot before the text; `hollow` for "no".

## Panel objects

Every `panel` (tab default, lane, foot, node, row, edge) takes the same fields, all optional
(a lane's panel always shows the row name, its color and its boxes, so its `tag`, `title` and
`links` are replaced; the build warns):
`tag: { text, color }`, `title`, `text` (text or a list of paragraphs), `callouts`, `refs`,
`sections: [{ title, text, where, notes, bullets, tone, label }]`, `where`, `notes`, `bullets`
(text or `{ text, sub, status }`; `status` is `built` or `partly` and shows as a small mark
before the text) with `bulletsTitle`, `list: [{ b, text }]` with `listTitle`, `links`
with `linksTitle`, `foot`. Unknown keys are warned about and ignored; a panel never takes raw
HTML.

## Themes

A theme is a JSON file: `name`, `headlineDot` (true adds an accent-colored period after the
headline), `fontSans` and `fontMono` (CSS font stacks), `fontFiles: [{ family, file, weight }]`
(woff2, woff, ttf or otf; a path may start with `~` or be relative to the theme file), and `light`
and `dark`, each with every token in `themes/neutral.json` (CSS colors only). Pass a theme by name
(`neutral`, the default) or by path to `--theme`. A missing font file falls back to the stack and
warns; it never stops the build.

```json
{
  "name": "acme", "headlineDot": false,
  "fontSans": "\"Acme Sans\", system-ui, sans-serif",
  "fontMono": "ui-monospace, Menlo, monospace",
  "fontFiles": [{ "family": "Acme Sans", "file": "fonts/AcmeSans.woff2", "weight": "100 900" }],
  "light": { "...": "every token in themes/neutral.json" },
  "dark": { "...": "every token in themes/neutral.json" }
}
```

## Build options

`--strict` turns warnings into errors. `--scope-words` lists every "only", "never", "every" and
similar word with its path, for the self-check, and builds nothing. `--standalone` wraps the page in a full HTML document for
hosting outside a claude.ai Artifact (an Artifact adds that wrapper itself). The output must end in
`.html` and stay under 16 MB.
