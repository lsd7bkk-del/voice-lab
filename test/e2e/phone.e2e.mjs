// End-to-end test at phone size with a simulated microphone.
// Starts the dev server (mock mode), drives the app in Chromium, checks the flows.
//   node test/e2e/phone.e2e.mjs [--shots DIR]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 8799;
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > -1 ? process.argv[shotsIdx + 1] : null;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const server = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DEEPGRAM_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const metric = (id) => page.locator(`[data-metric="${id}"] .v`).innerText();

try {
  const base = `http://localhost:${PORT}/`;
  await page.goto(base);
  await page.waitForSelector('#startArt');
  check('Home loads', true);
  await shot('1-home');

  // Point the app at the local backend (mock provider) — same origin.
  await page.click('#settingsBtn');
  await page.fill('#backendUrl', `http://localhost:${PORT}`);
  await page.click('#saveBackend');
  await page.waitForFunction(() => document.querySelector('#statusBox')?.innerText.includes('Test provider'));
  const statusText = await page.locator('#statusBox').innerText();
  check('Settings shows provider status (mock backend)', /Transcription[\s\S]*mock/.test(statusText), statusText.replace(/\s+/g, ' '));
  check('Keep recordings is OFF by default', !(await page.isChecked('#keepRecordings')));
  await shot('2-settings');
  await page.click('#backBtn');

  // Voice drill
  await page.click('#startArt');
  await page.click('#recBtn');
  await page.waitForTimeout(6500);
  await page.click('#recBtn');
  await page.waitForSelector('#submitTake');
  check('Review step shows playback before submit', await page.locator('audio').count() === 1);
  await shot('3-review');
  await page.click('#submitTake');
  await page.waitForSelector('#metricsCard', { timeout: 15000 });
  await shot('4-result');
  const sim = await page.locator('#simBanner').count();
  check('Test transcript is labelled as simulated', sim === 1);
  const wpm = await metric('speaking_rate');
  check('Speaking rate measured from timed words, in a realistic range', parseInt(wpm) > 100 && parseInt(wpm) < 220, wpm);
  const fillers = await metric('filler_count');
  check('Fillers counted (sample has 2)', fillers.startsWith('2'), fillers);
  const talk = await page.locator('[data-metric="talk_time_share"]').innerText();
  check('Talk-time share is — with a reason, not zero (AT-8)', talk.includes('—') && /counterparty/.test(talk));
  const marks = await page.locator('#transcript mark:not(.cand)').count();
  check('Fillers highlighted in transcript', marks === 2, `${marks} marks`);
  const audioKept = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('voicelab'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('audio').objectStore('audio').count(); q.onsuccess = () => r(q.result); });
  });
  check('Recording deleted after transcription (retention OFF)', audioKept === 0, `${audioKept} stored`);

  // Typed drill (AT-7)
  await page.click('#nextDrill');
  await page.click('#typeInstead');
  await page.fill('#typedAnswer', 'I deserve a raise because I shipped the redesign two weeks early and cut support tickets by a third.');
  await page.click('#submitTyped');
  await page.waitForSelector('#metricsCard');
  const typedText = await page.locator('#metricsCard').innerText();
  check('Typed answer gets no vocal numbers (AT-7)', /not measured/.test(typedText) && !(await page.locator('[data-metric]').count()));

  // Failure path: backend down → attempt preserved, retry offered (AT-13)
  await page.evaluate(() => window.__voiceLab.settings.set({ backendUrl: 'http://127.0.0.1:59999' }));
  await page.evaluate(() => window.__voiceLab.go('practice'));
  await page.click('#recBtn');
  await page.waitForTimeout(3500);
  await page.click('#recBtn');
  await page.click('#submitTake');
  await page.waitForSelector('#retryTranscribe', { timeout: 15000 });
  await shot('5-failure');
  check('Failed transcription keeps the attempt and offers a retry (AT-13)', (await page.locator('.banner.err').count()) === 1);
  await page.evaluate((u) => window.__voiceLab.settings.set({ backendUrl: u }), `http://localhost:${PORT}`);
  await page.click('#retryTranscribe');
  await page.waitForSelector('#metricsCard', { timeout: 15000 });
  check('Retry succeeds once the backend is back', true);

  // Persistence across reload (AT-12)
  await page.goto(base);
  await page.click('text=All history');
  await page.waitForSelector('.item');
  const count = await page.locator('.item').count();
  check('History persists across reload (AT-12)', count === 3, `${count} drills`);
  await shot('6-history');

  // Delete one, then delete all (AT-12)
  await page.locator('.item').first().click();
  await page.click('#deleteSession');
  await page.click('#confirmDelete');
  await page.click('text=All history');
  await page.waitForSelector('.item');
  check('Deleting a drill removes it', (await page.locator('.item').count()) === 2);
  await page.click('#settingsBtn');
  await page.click('#deleteAll');
  await page.click('#confirmDeleteAll');
  await page.waitForSelector('.banner.ok');
  const left = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('voicelab'); q.onsuccess = () => r(q.result); });
    const n = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => r(q.result); });
    return (await n('sessions')) + (await n('audio'));
  });
  check('Delete all data empties drills and recordings (AT-12)', left === 0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('No sideways scrolling at phone width', !overflow);
  check('No script errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
