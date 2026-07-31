// Screenshots the three spike fixtures. Not part of the app build.
//   node packages/web/scripts/shoot.mjs [baseUrl] [outDir]
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const out = process.argv[3] ?? 'spike-artifacts'

await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1680, height: 1000 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
})

await page.goto(base, { waitUntil: 'networkidle' })
// The live stream replays a recorded session; give it a moment to arrive.
await page.waitForTimeout(6000)

const shots = [
  ['1', '1-live'],
  ['2', '2-twenty-lanes'],
  ['3', '3-staged-pathologies'],
]

for (const [key, name] of shots) {
  await page.keyboard.press(key)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log(`${out}/${name}.png`)
}

await browser.close()
