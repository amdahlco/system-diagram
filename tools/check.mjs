// Check a built diagram the way a reader meets it.
//
//   node tools/check.mjs path/to/index.html [outdir]
//
// It clicks every box, chip, lane, node and row on every tab, follows every link in each panel,
// and reports script errors, empty panels, tabs where nothing could be clicked, and phone-width
// overflow (after each click too). It saves screenshots of every tab in light and dark at desktop
// and phone width, plus the longest open panel on each tab. Exit code 1 on any problem.
//
// Needs Node 18+, playwright-core and a Chromium of the revision that playwright-core release
// expects. Setup, once: see SKILL.md. Overrides: SD_PLAYWRIGHT (the playwright-core folder),
// CHROME_PATH (a Chromium binary), PLAYWRIGHT_BROWSERS_PATH (where Playwright put its browsers).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [file, outArg] = process.argv.slice(2)
if (!file) { console.error('usage: node check.mjs index.html [outdir]'); process.exit(2) }
const out = path.resolve(outArg || path.join(path.dirname(path.resolve(file)), 'check'))
fs.mkdirSync(out, { recursive: true })

const require = createRequire(import.meta.url)
const pwPath = process.env.SD_PLAYWRIGHT || path.join(os.homedir(), '.cache/system-diagram-check/node_modules/playwright-core')
let chromium
try { ({ chromium } = require(pwPath)) } catch {
  console.error(`playwright-core not found at ${pwPath}.\nSetup: mkdir -p ~/.cache/system-diagram-check && cd ~/.cache/system-diagram-check && npm init -y && npm i playwright-core@1.48.2 && npx playwright-core install chromium`)
  process.exit(2)
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  // Playwright's default browser folders on macOS, Linux and Windows
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean)
  // the revision playwright-core was released with comes first; a newer one can hang on screenshots
  let rev = ''
  try { rev = require(path.join(pwPath, 'browsers.json')).browsers.find((b) => b.name === 'chromium').revision } catch { /* unknown */ }
  // only that revision: another one can hang on screenshots, so a missing match fails cleanly at launch
  for (const base of bases) {
    if (!fs.existsSync(base) || !rev) continue
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium') && d.endsWith('-' + rev))
    for (const d of dirs) {
      for (const rel of ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/headless_shell', 'chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-win/chrome.exe']) {
        const p = path.join(base, d, rel)
        if (fs.existsSync(p)) return p
      }
    }
  }
  return undefined // let playwright-core look in its own default place
}

// an Artifact wraps the page in a document with a doctype and viewport; do the same here,
// or the browser renders in quirks mode and the phone viewport is wrong
const raw = fs.readFileSync(file, 'utf8')
const wrapped = /^\s*<!doctype/i.test(raw) ? raw : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0}</style></head><body>${raw}</body></html>`
const pageFile = path.join(out, '_page.html')
fs.writeFileSync(pageFile, wrapped)
const url = pathToFileURL(pageFile).href

let browser
try { browser = await chromium.launch({ executablePath: findChrome() }) } catch (e) {
  console.error(`Could not start Chromium: ${e.message.split('\n')[0]}\nInstall it with: cd ~/.cache/system-diagram-check && npx playwright-core install chromium\n(on Linux add --with-deps), or set CHROME_PATH to a Chromium binary.`)
  process.exit(2)
}
const report = { errors: [], clicked: 0, followed: 0, notClickable: [], emptyPanels: [], deadTabs: [], overflow: [], info: [], shots: [] }

async function open(viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => report.errors.push(`${colorScheme} ${viewport.width}px: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`) })
  await page.goto(url)
  return { ctx, page }
}
const tabIds = (page) => page.$$eval('[data-tab]', (els) => els.map((e) => e.dataset.tab))
const clickTab = (page, id) => page.evaluate((id) => { const b = [...document.querySelectorAll('[data-tab]')].find((x) => x.dataset.tab === id); if (b) b.click() }, id)
const panelText = (page) => page.$eval('#panel', (p) => p.innerText.trim()).catch(() => '')
// a panel is empty when it holds nothing beyond its heading and tag
const panelEmpty = (page) => page.$eval('#panel', (p) => !p.querySelector('p, ul, .callout, .where, .legend, .sections')).catch(() => true)
const clickables = (page, id) => page.evaluateHandle((id) => {
  const view = document.getElementById('view-' + id)
  return view ? [...view.querySelectorAll('[data-sel],[data-lane]')] : []
}, id)
async function nth(page, id, i) {
  const h = await clickables(page, id)
  const el = await h.evaluateHandle((list, i) => list[i] || null, i)
  return el.asElement()
}
const count = (page, id) => page.evaluate((id) => { const v = document.getElementById('view-' + id); return v ? v.querySelectorAll('[data-sel],[data-lane]').length : 0 }, id)
const describe = (el) => el.evaluate((e) => e.dataset.sel ? `data-sel=${e.dataset.sel}` : `data-lane=${e.dataset.lane}`)
async function tryClick(el, what) {
  try { await el.click({ timeout: 2000 }); return true } catch (e) { report.notClickable.push(`${what}: ${e.message.split('\n')[0]}`); return false }
}

try {
// 0. the page must render
{
  const { ctx, page } = await open({ width: 1440, height: 1000 }, 'light')
  const ids = await tabIds(page)
  const on = await page.$('.view.on')
  if (!ids.length || !on) report.errors.push('the page rendered no tabs or no visible view (a blank page)')
  await ctx.close()
}

// 1. screenshots: every tab, light and dark, desktop and phone
for (const [vname, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await open(viewport, scheme)
    for (const id of await tabIds(page)) {
      await clickTab(page, id)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (over > 1) report.overflow.push(`${vname} ${scheme} #${id}: page is ${over}px wider than the screen`)
      if (vname === 'phone' && scheme === 'light') {
        const g = await page.evaluate(() => { const s = document.querySelector('.view.on .j-scroll'); return s ? [s.clientWidth, s.scrollWidth] : null })
        if (g && g[1] > g[0]) report.info.push(`phone #${id}: the grid scrolls sideways (${g[0]}px of ${g[1]}px shown), by design`)
      }
      const f = path.join(out, `${vname}-${scheme}-${id}.png`)
      await page.screenshot({ path: f, fullPage: vname === 'desktop' })
      report.shots.push(f)
    }
    await ctx.close()
  }
}

// 2. interactions at desktop: click everything, follow every link in each panel
{
  const { ctx, page } = await open({ width: 1440, height: 1000 }, 'light')
  for (const id of await tabIds(page)) {
    await clickTab(page, id)
    const n = await count(page, id)
    let clickedHere = 0
    let longest = { len: 0, i: -1 }
    for (let i = 0; i < n; i++) {
      await clickTab(page, id)
      const el = await nth(page, id, i)
      if (!el) continue
      const what = `#${id} ${await describe(el)}`
      if (!(await tryClick(el, what))) continue
      report.clicked++; clickedHere++
      const txt = await panelText(page)
      if (await panelEmpty(page)) report.emptyPanels.push(what)
      if (txt.length > longest.len) longest = { len: txt.length, i }
      const gos = await page.$$eval('#panel [data-go]', (els) => els.map((e) => e.dataset.go))
      for (const g of gos) {
        const b = await page.evaluateHandle((g) => [...document.querySelectorAll('#panel [data-go]')].find((x) => x.dataset.go === g) || null, g)
        const be = b.asElement()
        if (!be) continue
        if (!(await tryClick(be, `${what} -> link ${g}`))) continue
        report.followed++
        if (await panelEmpty(page)) report.emptyPanels.push(`${what} -> link ${g}`)
        await clickTab(page, id)
        const again = await nth(page, id, i)
        if (again) await again.click({ timeout: 2000 }).catch(() => {})
      }
    }
    if (n && !clickedHere) report.deadTabs.push(`#${id}: ${n} clickable things, none could be clicked`)
    // the longest open panel, captured at its full height
    if (longest.i >= 0) {
      await clickTab(page, id)
      const el = await nth(page, id, longest.i)
      if (el) {
        await el.click({ timeout: 2000 }).catch(() => {})
        await page.evaluate(() => { const p = document.getElementById('panel'); p.style.maxHeight = 'none'; p.style.position = 'static' })
        const f = path.join(out, `panel-${id}.png`)
        await page.$eval('#panel', (p) => p.scrollIntoView())
        await (await page.$('#panel')).screenshot({ path: f })
        report.shots.push(f)
        await page.evaluate(() => { const p = document.getElementById('panel'); p.style.maxHeight = ''; p.style.position = '' })
      }
    }
  }
  await ctx.close()
}

// 3. phone width: open everything once and check the page never grows sideways
{
  const { ctx, page } = await open({ width: 390, height: 844 }, 'light')
  for (const id of await tabIds(page)) {
    await clickTab(page, id)
    const n = await count(page, id)
    for (let i = 0; i < n; i++) {
      await clickTab(page, id)
      const el = await nth(page, id, i)
      if (!el) continue
      await el.click({ timeout: 2000 }).catch(() => {})
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (over > 1) { report.overflow.push(`phone #${id} after opening ${await describe(el)}: page is ${over}px wider than the screen`); break }
    }
  }
  await ctx.close()
}

} catch (e) {
  const why = e && e.name === 'TimeoutError' ? 'a browser step timed out; this usually means the Chromium build does not match playwright-core (reinstall with npx playwright-core install chromium)' : (e && e.message ? e.message.split('\n')[0] : String(e))
  report.errors.push(`checker stopped: ${why}`)
} finally {
  await browser.close().catch(() => {})
  fs.rmSync(pageFile, { force: true })
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
const problems = [...report.errors, ...report.emptyPanels, ...report.notClickable, ...report.deadTabs, ...report.overflow]
console.log(`clicked ${report.clicked}, followed ${report.followed} links; ${report.errors.length} script errors, ${report.emptyPanels.length} empty panels, ${report.notClickable.length} could not be clicked, ${report.deadTabs.length} dead tabs, ${report.overflow.length} overflow; ${report.shots.length} screenshots in ${out}`)
for (const e of problems) console.log('  -', e)
for (const i of report.info) console.log('  info:', i)
process.exit(problems.length ? 1 : 0)
