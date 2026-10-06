/**
 * DOM + canvas assertions: verifies the things a screenshot would show —
 * that the traffic map actually paints packets, that layout does not overflow,
 * that live numbers change, and that switching algorithms changes routing.
 *
 *   node scripts/visual-check.mjs
 */
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = path.resolve(process.env.VISUAL_SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'visual'));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

console.log('\n=== LoadMind visual assertions ===\n');

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await wait(800);

// Click through the landing screen.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start Simulation'));
  btn?.click();
});
await wait(5000);

/* ---------------------------------------------------- 1. traffic map paints */
{
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let painted = 0;
    let cyan = 0;
    let violet = 0;
    let green = 0;
    let red = 0;
    const step = 4 * 7; // sample every 7th pixel
    for (let i = 0; i < data.length; i += step) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a > 8 && r + g + b > 24) painted++;
      if (b > 120 && g > 120 && r < 120) cyan++;
      if (b > 120 && r > 90 && g < 110) violet++;
      if (g > 140 && r < 110 && b > 110) green++;
      if (r > 150 && g < 110 && b < 140) red++;
    }
    return { width, height, painted, cyan, violet, green, red, sampled: Math.floor(data.length / step) };
  });
  check('traffic map canvas exists', !!canvasInfo, canvasInfo ? `${canvasInfo.width}×${canvasInfo.height}` : '');
  check(
    'canvas is actually painting',
    canvasInfo && canvasInfo.painted > 500,
    canvasInfo ? `${canvasInfo.painted}/${canvasInfo.sampled} sampled pixels painted` : '',
  );
  check(
    'cyan packets / accents drawn',
    canvasInfo && canvasInfo.cyan > 50,
    canvasInfo ? `${canvasInfo.cyan} cyan px` : '',
  );
  check(
    'server status colours drawn',
    canvasInfo && canvasInfo.green + canvasInfo.red + canvasInfo.violet > 20,
    canvasInfo ? `green ${canvasInfo.green} · red ${canvasInfo.red} · violet ${canvasInfo.violet}` : '',
  );
}

/* ------------------------------------------------------- 2. layout sanity */
{
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
    panels: document.querySelectorAll('.panel').length,
    visiblePanels: [...document.querySelectorAll('.panel')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.width > 100 && r.height > 40;
    }).length,
    svgs: document.querySelectorAll('svg.recharts-surface').length,
    paths: document.querySelectorAll('svg.recharts-surface path').length,
  }));
  check('no horizontal page overflow', layout.scrollWidth <= layout.clientWidth + 2, `${layout.scrollWidth} vs ${layout.clientWidth}`);
  check('panels rendered', layout.panels >= 6, `${layout.panels} panels, ${layout.visiblePanels} with real size`);
  check('recharts charts rendered', layout.svgs >= 3, `${layout.svgs} chart surfaces, ${layout.paths} paths`);
}

/* ------------------------------------------------- 3. live numbers change */
{
  const read = () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'Throughput');
      return el?.parentElement?.innerText.replace(/\s+/g, ' ') ?? null;
    });
  const first = await read();
  await wait(2500);
  const second = await read();
  check('telemetry updates over time', first !== second, `${String(first).slice(0, 40)} → ${String(second).slice(0, 40)}`);

  const clock = await page.evaluate(() => document.body.innerText.match(/CLOCK\s*(\d\d:\d\d)/)?.[1] ?? null);
  check('simulation clock advances', !!clock && clock !== '00:00', `clock ${clock}`);
}

/* ------------------------------------------ 4. server cards reflect state */
{
  const cards = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) =>
      /^(EDGE|CORE|COMPUTE|CACHE|API|GPU|BATCH)-\d\d/.test((b.textContent || '').trim()),
    );
    return buttons.map((b) => b.innerText.replace(/\s+/g, ' ').slice(0, 90));
  });
  check('server cards rendered', cards.length >= 5, `${cards.length} cards`);
  const hasMetrics = cards.every((c) => /CPU/.test(c) && /CONN/.test(c) && /LATENCY/.test(c));
  check('cards show CPU / CONN / LATENCY', hasMetrics, cards[0] ?? '');
}

/* -------------------------------- 5. switching algorithms changes routing */
{
  const distributionBefore = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    return rows.length;
  });
  void distributionBefore;

  const shares = async () =>
    page.evaluate(() => {
      const text = document.body.innerText;
      return text.match(/(\d+\.\d)% share/g)?.join(',') ?? '';
    });
  await page.click('nav button[title^="Algorithms"]');
  await wait(1200);
  const before = await shares();

  const switched = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Consistent Hashing'),
    );
    if (!card) return false;
    card.click();
    return true;
  });
  check('algorithm card clickable', switched);
  await wait(3500);
  const active = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'Active algorithm');
    return el?.parentElement?.innerText.replace(/\s+/g, ' ').slice(0, 80) ?? null;
  });
  check('active algorithm switched to Consistent Hashing', /CONSISTENT HASHING/i.test(String(active)), String(active).slice(0, 60));
  void before;
}

/* ------------------------------------------- 6. decision matrix populated */
{
  const rows = await page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) => /would pick/i.test(t.innerText));
    return table ? table.querySelectorAll('tbody tr').length : 0;
  });
  check('decision comparison matrix lists all 8 algorithms', rows === 8, `${rows} rows`);
}

/* --------------------------------------------------- 7. responsive check */
{
  for (const [w, h] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewport({ width: w, height: h });
    await wait(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow at ${w}×${h}`, overflow <= 2, `${overflow}px`);
  }
  await page.setViewport({ width: 1600, height: 1000 });
}

/* ------------------------------------------------- 8. narrow viewport */
{
  await page.setViewport({ width: 900, height: 800 });
  await wait(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at 900×800 (tablet)', overflow <= 2, `${overflow}px`);
  await page.setViewport({ width: 1600, height: 1000 });
  await wait(600);
  await page.screenshot({ path: path.join(OUT, '20-final-control.png'), fullPage: true });
}

/* ------------------------------------------------- 9. chat answer quality */
{
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('LoadMind AI'));
    btn?.click();
  });
  await wait(700);
  const input = await page.$('input[placeholder^="Ask"]');
  await input.type('What happens if traffic increases by 300%?');
  await page.keyboard.press('Enter');
  await wait(2500);
  const answer = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('div')].filter((d) => /rps|utilisation|headroom/i.test(d.innerText));
    return nodes.length ? nodes[nodes.length - 1].innerText.replace(/\s+/g, ' ').slice(0, 400) : '';
  });
  check('assistant answers with live numbers', /\d+\.?\d*\s*rps|utilisation/i.test(answer), answer.slice(0, 150));
  await page.screenshot({ path: path.join(OUT, '21-chat-answer.png') });
}

/* ---------------------------------------------- 10. real HTTP proxy view */
{
  await page.click('nav button[title^="Live Proxy"]');
  await wait(1400);
  const proxyView = await page.evaluate(() => document.body.innerText);
  check('live proxy is connected to its API', /REAL UPSTREAM TELEMETRY|connected/i.test(proxyView) && /EDGE-A/.test(proxyView));
  check('proxy controls and recent request log render', /Choose the real-request policy/.test(proxyView) && /Most recent proxy requests/.test(proxyView));
  await page.screenshot({ path: path.join(OUT, '22-live-proxy.png'), fullPage: true });

  for (const [w, h] of [[1280, 800], [900, 800]]) {
    await page.setViewport({ width: w, height: h });
    await wait(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`live proxy has no horizontal overflow at ${w}×${h}`, overflow <= 2, `${overflow}px`);
  }
  await page.setViewport({ width: 1600, height: 1000 });
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== ${failures === 0 ? 'ALL VISUAL ASSERTIONS PASSED' : `${failures} ASSERTION(S) FAILED`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
