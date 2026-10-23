---
name: system-diagram
description: 'Turn a spec, plan, PRD, Notion page, design doc or a running system into an interactive diagram page: one self-contained HTML file, published as a claude.ai Artifact where that tool exists. The page has a grid of steps (across) by who does each part (down), a side panel that opens every box with a plain sentence first and the technical detail after, and optional pages for a build plan, tables, numbers and open questions. Use when someone says "turn this into a visual diagram", "map this spec", "diagram this Notion page", "make a system map", "visualize this flow", or asks to update, simplify or reflect source changes in a diagram made this way.'
---

# system-diagram

Turns a written source into one interactive page that a non-engineer can read in a minute and an
engineer can build from. The engine and build script are fixed. Your job is the data file:
choosing the steps, the rows and the boxes, and making every sentence true to the source.

Files: `build.py` (checks and builds), `engine/` (page shell and script), `themes/neutral.json`
(system fonts, works anywhere), `tools/check.mjs` (clicks everything, takes screenshots), `references/schema.md` (every
field), `references/judge.md` (the prompt for an independent source check), `examples/skeleton/`
(short, made up, every feature: start here).

Needs only python3 to build. The checker (step 5) also needs Node 20+ with npm; if `node` is not
found, look for it under your version manager (nvm, fnm, volta, pnpm) and put it on PATH in the
same command. Nothing else is needed: no fonts, no network, no design system.

## Steps

1. **Read the whole source.** A Notion page or another web doc: use a connector for it if one is
   available, otherwise ask the person to paste or export it. Files: Read. Note the time
   you read it. Read the pages it depends on, or name what you did not read in `meta.source`
   ("Source: holds-spec.md and returns.md, as of 22 Oct 14:05 UTC; the code was not read").
2. **Pick the reader and their journey.** Ask who opens this page and what they want to know. The
   columns (`stages`) are what the subject goes through, in order: a new user's path, a deal's
   path, a request's path. 4 to 7 of them. The rows (`lanes`) are who does each part. 2 to 4 of
   them. Then list every decision a person makes in the source that changes the result (approve a
   request, answer a question, turn a setting on or off). Each one gets a box or a note in that person's row.
3. **Write the data file** in a folder that outlives the session; the session scratchpad gets
   wiped. For example `~/system-diagrams/<slug>/data.json`. Copy the shape of
   `examples/skeleton/data.json`, look up fields in `references/schema.md`, and follow the content
   rules and source rules below.
4. **Build:** `python3 <skill>/build.py data.json --out index.html` (the neutral theme is the
   default; pass `--theme <path>` for your own). Fix every error. Act on every warning: merge boxes, add the
   missing field, or decide that the warning does not apply here.
5. **Check:** `node <skill>/tools/check.mjs index.html <scratchpad>/check`. It must report no
   problems. Then look at `desktop-light-<first tab>.png`, `phone-light-<first tab>.png` and the
   `panel-<tab>.png` files (the longest open panel on each tab).
   Setup, once per machine:
   `cd <skill>/tools && npm ci && npx playwright-core install chromium`
   (on Linux, `install --with-deps chromium`). If Node cannot be installed, build with
   `--standalone`, open the page in a browser and click through every tab yourself instead.
6. **Check it against the source.** Run the source rules' self-check below. For a diagram other
   people will read, also start one independent agent with the prompt in `references/judge.md`,
   and fix what it finds.
7. **Publish.** Where the claude.ai Artifact tool is available, publish `index.html` with it
   (private by default, `icon: "flow"`). Tell the person it is private and that they share it from the page's
   Share menu. Anywhere else, build with `--standalone` and give the person the file: it opens in
   any browser with no server, and any static host can serve it.
8. **Record** the data folder and the page's link or path where the next session will find them
   (a memory note, or the project's docs).

## Content rules

- **Organize by the reader's journey, not by how the system is built.** Test each box: would the
  reader see this happen, or do it? If not, it is plumbing. Scheduled passes, queues, locks, keys
  and the internal stages of one decision (filter, model call, checks, second check) stay out of
  the grid: fold them into one box's `parts` or `where`. Internal signals and stored records go
  in the footnote row (`foot`). Staff dashboards and reports never take a journey column; give them
  their own tab.
- **Name rows by role.** "The reader", "Desk staff", "The catalogue". When several automatic
  actors take part, name each by the job it does ("The overdue check", "The pick-up reminder"). When two
  systems split the work and the reader cares which one acts, split the row or name the system in
  each box's text.
- **A box sits in a role's row only when the source gives that action to that role.** When the
  source does not say who does it, write that it is not covered, never a guess. When the source
  gives one action to "a person or an agent", say both in the row's `sub`, or give agents a row.
  A person's setup step that the source asks for (connect an account, turn a setting on) is a box in
  that person's row, not a callout on a system box.
- **Plain sentence first, detail second.** `text` and `plain` use the reader's words. Code names,
  routes, tables, flags, character budgets and rollback steps go in `where`, `notes` and `parts`.
  Explain internal shorthand (a codename, a flag) the first time a reader-facing sentence uses it.
- **Only warnings sit on a box.** At most one tag: `wait` (blocked on other work) or `gap` (needed
  and not built; for a running system, a known limit the reader will hit). `optional` only when
  the source calls the step optional. Build pieces and owners go in `refs`, shown in the panel.
- **About 20 boxes, 3 or fewer in a cell.** Over that, merge boxes in the same row and step. A
  merged box keeps every fact of the boxes it replaced, one `parts` section each.
- **Flags are for disagreements and open questions.** When two parts of the source disagree, or a
  stated fact cannot be true, add a flag with `src: "Found while drawing this"` and quote both
  sides. Before writing it, check each case it lists against both sides; cut cases that do not
  disagree. A limit the source states plainly is not a flag: it is a `gap` tag or callout on the
  box it limits. A source's own "open" list becomes flags with `src` naming that section. A
  disagreement the source resolves itself ("this reverses the note above") is not a flag: use
  the later statement, and add a note on the box if readers may meet the older one.
- **Each item sits on the tab it affects.** Flags about the grid go in the journey tab's `flags`,
  a pricing question on the pricing tab. No separate "open items" tab.
- **Give each extra tab one job**: the build plan (`graph` + `checklist`), the numbers (`table`,
  `meter`, `stats`), a catalogue (a `table` with clickable rows). Prefer a table of numbers to a
  chart that needs a legend.
- **Keep a graph readable.** About 12 arrows, and at most 3 leaving any one box; the build warns
  past either. Put what feeds a node to its left, so every arrow runs the same way. Over the
  limit, split the graph into an overview and a detail graph, or drop arrows the layout already
  shows (a box under a "Go live" column needs no arrow to say it comes first). The 12-arrow
  budget and the right-angle and hop rules come from the diagram-design skill
  (github.com/cathrynlavery/diagram-design, MIT); the limit of 3 out of one box is ours.
- **Plain ASCII punctuation.** No em dashes, curly quotes, arrows or middle dots (the build warns).
  Refer to people by name or "they"; never guess pronouns.

## Source rules

Every independent check of a test diagram found the same kind of error: a sentence that says
more, or less, than the source. These rules prevent it.

- **Every fact comes from the source.** No invented dates, numbers, owners, statuses, file
  locations or capabilities. A value you work out (a weekday from "next Tuesday", a total, a
  percentage) says how you got it.
- **Never widen a scoped fact.** When the source limits a rule ("on both paths", "only when it has
  a line", "in strict mode"), no heading or summary may say "every", "always", "never" or "all" for
  more than the source does.
- **Keep every exception, trigger and condition that changes the result.** A list of triggers keeps
  them all or says "among others". Keep the source's numbers ("at least 80%", not "most"). A
  fallback or deadline keeps its condition, above all in `meta.stats`, which is read with no
  context.
- **Modes and switches.** When behaviour depends on a mode or switch, each headline, stat and box
  holds in every mode the source names, or names its mode.
- **Samples are not populations.** A fact about a test set, a trial or one day of data stays
  about that set.
- **Examples stay examples.** Text in parentheses or after "for example" never becomes the rule
  for every case.
- **Instructions stay instructions.** "Never set X on staging" is an instruction to operators,
  not a claim about how the system behaves.
- **Keep each sentence's subject.** When splitting a paragraph across boxes, a sentence keeps its
  own subject; resolve "it" to the noun the source means. Name a component as a component (a
  weight inside a score is not the score).
- **Copy tables faithfully.** Keep the column headers word for word. If you rename one, re-check
  every cell against the new header.
- **`where` names only what the source ties to that step.** A constant is tied to a file only when
  the source says so; a route the source lists elsewhere is not evidence that this step uses it.
- **Check negative claims against every surface.** "Nothing reaches you by text" must hold for
  every message the source describes, including those in other sections.
- **Two orderings, name which.** When the source gives an order shown and an order of priority, a
  summary says which one it means.
- **Same name, two things.** Tell them apart on every mention, and flag it.

**Self-check before publishing.** Run `python3 <skill>/build.py data.json --scope-words`. It lists
every "only", "never", "always", "every", "all", "any", "nothing", "except", "first", "most" and
"each" with its place in the file. Check each one against the whole source: does the source say
this, for exactly this set? Then re-read every `plain` sentence and every stat against the source
line it came from. In testing, this self-check caught many overstatements that a reread missed,
and an independent check still found more, which is why step 6 also asks for one for anything
others will read.

## Updating a diagram when the source changes

1. Fetch the source again. List what changed against the data file, item by item.
2. Save the current file as `data.v<N>.json`, then edit `data.json`. Remove flags the source has
   resolved, and tell the person which ones.
3. Update `meta.source` with the new read time. Build, check, and publish to the **same** place
   (for an Artifact: the same file path in the same session, or its `url` from another session).

## When code lands against the spec

A spec diagram stays a picture of the spec. Show what is built beside it, never in place of it:
- Read what has merged and what is live: merged is not deployed, and a switch can keep built code
  off. Name the change and its state ("switched off", "on in staging") in the sentence.
- Built work goes in the panel, never on the box: a `built` callout labelled "Built so far". The
  box keeps only its warning tags.
- Where the build does something the spec does not say, add a `note` callout labelled "Built
  differently from the spec" that names both. Keep the spec's version on the box.
- On a build-plan node, give each change a `status` (`built` or `partly`) and say the progress in
  `sub`, counting the two apart ("3 built, 2 partly, of 8"). Partly built never counts as built.
- When outside work a node waited on is done, remove its box and keep its facts (what it was,
  when it landed) in the panel of the node it fed.
- Add the code you read, and as of when, to `meta.source`.

## When asked to simplify

Run this pass, then propose the specific cuts before applying them:
- Tags that are not warnings: move them to the panel.
- Cells with more than 3 boxes, or rows of internal steps: merge into one box with `parts`.
- Rows about plumbing or the team's own monitoring: turn them into the footnote row or a tab.
- Tabs that only list open items: move each item to the tab it affects.
- Charts that need a legend: replace them with a table.
- Two controls that open the same thing (a box and a strip chip for one record): keep one.
- A list that repeats the graph (a checklist that restates its pieces): fold what only the list
  holds into the node it belongs to, then drop the list.
- Boxes for outside work that is done: remove them, keeping their facts in the panel of the node
  they fed.
Afterwards, check that the box count went down and that no fact disappeared: every merged fact is
in a `parts` section.

## Themes

`neutral` is the default and the only theme shipped. It uses each reader's system fonts, so it
needs no font files, no network and no design system, and looks the same on any machine.

For a brand look, copy `themes/neutral.json` anywhere, change the colors, and pass its path to
`--theme`. To use brand fonts, put the font files next to the theme file and list them in
`fontFiles` with relative paths; the build inlines them into the page. A font file it cannot
find is skipped with a warning and the page falls back to system fonts, so a missing file never
blocks a build. Only inline fonts whose licence allows it. The format is in
`references/schema.md`.

## Limits

- The graph layout is by hand: you give each node a `lane` and `row`. The arrows route
  themselves; the gap beside a column widens to up to four lanes, and when arrows run out of
  lanes two can share one. The checker reports that; move a box or split the graph.
- A graph of 5 columns with arrows turning between them is about 1,000 to 1,100 px wide, so it
  can scroll sideways on a laptop. 4 columns fit.
- The data is static. For new numbers, rebuild and republish.
- On a phone the journey grid scrolls sideways inside its box, by design.
