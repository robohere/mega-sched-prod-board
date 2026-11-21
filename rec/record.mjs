// Records the deployed board in use: open-board, watch-board, ack-incident.
// Writes out/recording.webm and out/events.json (each moment with its mm:ss in the video).
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url, scenario = 'step1'] = process.argv.slice(2);
fs.mkdirSync('out', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: 'out/raw', size: { width: 1280, height: 720 } },
  locale: 'en-GB',
  timezoneId: 'Europe/Berlin',
});
const T0 = Date.now();
await context.addInitScript((t0) => {
  window.__t0 = t0;
  addEventListener('DOMContentLoaded', () => {
    const cap = document.createElement('div');
    cap.id = '__cap';
    cap.style.cssText = 'position:fixed;right:12px;bottom:12px;max-width:520px;padding:8px 12px;background:#111c;color:#fff;font:13px/1.35 ui-monospace,monospace;border-radius:6px;z-index:99999;pointer-events:none;white-space:pre-wrap';
    const dot = document.createElement('div');
    dot.id = '__dot';
    dot.style.cssText = 'position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #e00;border-radius:50%;background:#e003;z-index:99999;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    document.body.append(cap, dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.8)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
    const tick = () => {
      const s = Math.floor((Date.now() - window.__t0) / 1000);
      cap.dataset.clock = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      cap.textContent = `video ${cap.dataset.clock}\n${cap.dataset.msg || ''}`;
    };
    setInterval(tick, 200);
  });
}, T0);

const page = await context.newPage();
const events = [];
const at = () => {
  const s = Math.floor((Date.now() - T0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const note = async (flow, msg, extra = {}) => {
  const e = { at: at(), flow, msg, ...extra };
  events.push(e);
  console.log(e.at, flow, msg, extra.receipt ? '(receipt kept)' : '');
  await page.evaluate((m) => { const c = document.getElementById('__cap'); if (c) c.dataset.msg = m; }, `${flow}: ${msg}`).catch(() => {});
};
const acks = [];
page.on('response', async (res) => {
  if (!res.url().includes('/ack?')) return;
  const asked = new URL(res.url()).searchParams.get('id');
  try { acks.push({ asked, at: at(), ...(await res.json()) }); } catch {}
});
const rows = page.locator('[data-testid="incident-row"]');
const ids = () => rows.evaluateAll((els) => els.map((e) => e.dataset.id));
const waitForNewTop = async (timeout = 90000) => {
  const before = (await ids())[0];
  await page.waitForFunction((b) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== b, before, { timeout, polling: 100 });
  return (await ids())[0];
};
const lastAck = async (n) => { await page.waitForFunction(() => true); for (let i = 0; i < 50 && acks.length < n; i++) await page.waitForTimeout(100); return acks[n - 1]; };

// open-board
await page.goto(url);
await page.waitForTimeout(150);
const loaderShown = await page.locator('[data-testid="loader"]').isVisible();
await rows.first().waitFor();
const sha = await page.locator('meta[name="build"]').getAttribute('content');
await note('open-board', `board open, build ${sha.slice(0, 7)}; loader seen: ${loaderShown}; ${await rows.count()} incidents, newest first`, { sha });
await page.waitForTimeout(3000);

// watch-board
await note('watch-board', 'watching without reload: waiting for a new incident');
const newTop = await waitForNewTop();
await note('watch-board', `${newTop} arrived at the top without a reload`, { id: newTop });
await page.waitForTimeout(2500);

if (scenario === 'step1') {
  // ack-incident, done right after a pause: target the row by id.
  const okId = (await ids())[3];
  const okBtn = page.locator(`[data-testid="incident-row"][data-id="${okId}"] [data-testid="ack"]`);
  const box = await okBtn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await note('ack-incident', `on-call clicks Ack on ${okId}`);
  await page.mouse.down(); await page.mouse.up();
  const a1 = await lastAck(1);
  await note('ack-incident', `ack sent for ${a1.id}; row marked acked`, { aimed: okId, acked: a1.id, receipt: a1.receipt, ackedAt: a1.ackedAt });
  await page.waitForTimeout(3000);

  // ack-incident while the list moves: aim at one row, a new incident lands at the top, the click hits the row that moved under the pointer.
  const list = await ids();
  const aimed = list.find((id, i) => i >= 2 && id !== okId);
  const btn = page.locator(`[data-testid="incident-row"][data-id="${aimed}"] [data-testid="ack"]`);
  const b2 = await btn.boundingBox();
  const x = b2.x + b2.width / 2, y = b2.y + b2.height / 2;
  await page.mouse.move(x, y, { steps: 15 });
  await note('ack-incident', `on-call aims at Ack on ${aimed} and reads the row`);
  const arrived = await waitForNewTop();
  const under = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="incident-row"]')?.dataset.id, [x, y]);
  await note('ack-incident', `${arrived} arrived; the list moved down one row; the pointer is now over ${under}`);
  await page.waitForTimeout(250);
  await page.mouse.down(); await page.mouse.up();
  const a2 = await lastAck(2);
  await note('ack-incident', `click lands: ack sent for ${a2.id}, not ${aimed}`, { aimed, acked: a2.id, receipt: a2.receipt, ackedAt: a2.ackedAt, arrived });
  await page.waitForTimeout(4000);
}

await note('end', 'end of recording');
await page.waitForTimeout(1500);
const video = page.video();
await context.close();
await browser.close();
fs.copyFileSync(await video.path(), 'out/recording.webm');
fs.writeFileSync('out/events.json', JSON.stringify({ url, scenario, sha, startedAt: new Date(T0).toISOString(), events, acks }, null, 2));
console.log('done');
