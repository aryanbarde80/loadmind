/**
 * Browser end-to-end check with Puppeteer.
 *
 * Drives the real UI: boots the app, exercises every view, runs a battle,
 * benchmarks a custom algorithm, asks the assistant a question and captures
 * screenshots plus every console/page error.
 *
 *   node scripts/e2e.mjs
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = path.resolve(process.env.E2E_SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'e2e'));
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  // Chromium reports expected non-2xx network responses in the console; the
  // live-proxy step explicitly asserts the demo's intentional HTTP 503 below.
  const intentionalDemoFailure = text.includes('503 (Service Unavailable)');
  if (type === 'error' && !intentionalDemoFailure && !text.includes('favicon') && !text.includes('fonts.googleapis') && !text.includes('ERR_CONNECTION_REFUSED')) {
    errors.push(`console.error: ${text.slice(0, 300)}`);
  }
  if (type === 'warning' && /React|Warning:/.test(text) && !text.includes('width(0)') && !text.includes('height(0)')) {
    errors.push(`console.warn: ${text.slice(0, 300)}`);
  }
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message.slice(0, 300)}`));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('fonts.g')) return;
  if (url.includes('/@vite/client') || url.startsWith('http://localhost:5173/@') || url.includes('node_modules/.vite')) return;
  errors.push(`requestfailed: ${url} ${req.failure()?.errorText ?? ''}`);
});

const step = async (name, fn) => {
  const before = errors.length;
  try {
    await fn();
  } catch (error) {
    errors.push(`step "${name}" threw: ${error.message.split('\n')[0]}`);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => '');
    console.log(`\n--- page text at failure (${name}) ---\n${text}\n--------------------------------------\n`);
    await page.screenshot({ path: path.join(OUT, `FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
  }
  const added = errors.slice(before);
  console.log(`  ${added.length ? 'WARN' : ' OK '}  ${name}${added.length ? ` → ${added.length} new message(s)` : ''}`);
  added.forEach((e) => console.log(`         ${e}`));
};

/** Click the first element whose trimmed text matches. */
async function clickText(selector, text) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await page.evaluateHandle(
      (sel, txt) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim().includes(txt)) ?? null,
      selector,
      text,
    );
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      throw new Error(`No ${selector} containing "${text}"`);
    }
    try {
      await element.evaluate((target) => target.scrollIntoView({ block: 'center', inline: 'center' }));
      await element.click();
      await handle.dispose();
      return;
    } catch (error) {
      lastError = error;
      await handle.dispose();
      await wait(120);
    }
  }
  throw lastError;
}

console.log('\n=== LoadMind browser E2E ===\n');

await step('load app', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, '01-landing.png') });
});

await step('boot into simulation', async () => {
  await clickText('button', 'Start Simulation');
  await wait(4000);
  await page.screenshot({ path: path.join(OUT, '02-control-center.png') });
});

await step('simulation is producing traffic', async () => {
  const stats = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasThroughput: /REQ \/ SEC|rps/i.test(text),
      hasServers: /HEALTHY|WARNING|DOWN/i.test(text),
      text: text.slice(0, 0),
    };
  });
  if (!stats.hasThroughput || !stats.hasServers) throw new Error('Live telemetry not visible');
});

await step('enable AI autopilot', async () => {
  const toggled = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[role="switch"]')].find(
      (b) => (b.closest('div')?.textContent || '').toLowerCase().includes('autopilot'),
    );
    if (button && button.getAttribute('aria-checked') === 'false') button.click();
    return !!button;
  });
  if (!toggled) throw new Error('Autopilot toggle not found');
  await wait(9000);
  await page.screenshot({ path: path.join(OUT, '03-autopilot.png') });
});

await step('autopilot produced decisions', async () => {
  const feed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      (d.textContent || '').includes('AI decision feed'),
    );
    return el ? el.innerText.slice(0, 400) : null;
  });
  if (!feed || !/switched|Recommended|Comparing|monitoring|spike|signal/i.test(feed)) {
    throw new Error(`Decision feed looks empty: ${String(feed).slice(0, 120)}`);
  }
  console.log(`         feed excerpt: ${feed.replace(/\n+/g, ' | ').slice(0, 160)}`);
});

await step('open "Why did AI choose this?"', async () => {
  await clickText('button', 'Why did AI choose this?');
  await wait(900);
  await page.screenshot({ path: path.join(OUT, '04-why-modal.png') });
  await page.keyboard.press('Escape');
  await wait(400);
});

await step('algorithms view', async () => {
  await page.click('nav button[title^="Algorithms"]');
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, '05-algorithms.png'), fullPage: false });
});

await step('battle mode runs', async () => {
  await page.click('nav button[title^="Battle Mode"]');
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, '06-battle-setup.png') });
  await clickText('button', 'Run battle');
  // Wait for the winner banner (up to 60s).
  await page.waitForFunction(() => /winner/i.test(document.body.innerText), { timeout: 60000 });
  await wait(1500);
  await page.screenshot({ path: path.join(OUT, '07-battle-results.png'), fullPage: true });
});

await step('battle results are populated', async () => {
  const text = await page.evaluate(() => document.body.innerText);
  if (!/p95|Throughput|Fairness/i.test(text)) throw new Error('Results table missing');
  const winner = text.match(/🏆\s*([A-Za-z ]+)/);
  console.log(`         winner: ${winner ? winner[1].trim() : 'not parsed'}`);
});

await step('chaos view + kill a server', async () => {
  await page.click('nav button[title^="Chaos Mode"]');
  await wait(1200);
  await clickText('button', 'Kill');
  await wait(3500);
  await page.screenshot({ path: path.join(OUT, '08-chaos.png') });
});

await step('run chaos reaction test', async () => {
  await clickText('button', 'reaction test');
  await page.waitForFunction(() => document.body.innerText.includes('Round Robin'), { timeout: 60000 });
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, '09-chaos-reaction.png'), fullPage: true });
});

await step('clear chaos', async () => {
  await clickText('button', 'Clear all chaos');
  await wait(600);
});

await step('playground benchmark', async () => {
  await page.click('nav button[title^="Playground"]');
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, '10-playground.png') });
  await clickText('button', 'Run benchmark');
  await page.waitForFunction(() => /score \d|beating|behind/i.test(document.body.innerText), { timeout: 60000 });
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, '11-playground-results.png'), fullPage: true });
});

await step('performance lab', async () => {
  await page.click('nav button[title^="Performance Lab"]');
  await wait(1500);
  await page.screenshot({ path: path.join(OUT, '12-lab.png'), fullPage: true });
});

await step('architecture view', async () => {
  await page.click('nav button[title^="Architecture"]');
  await wait(1200);
  await clickText('button', 'SERVER POOL');
  await wait(600);
  await page.screenshot({ path: path.join(OUT, '13-architecture.png') });
});

await step('real HTTP proxy routes requests and records live metrics', async () => {
  await page.click('nav button[title^="Live Proxy"]');
  await page.waitForFunction(() => document.body.innerText.includes('EDGE-A'), { timeout: 12000 });
  await page.screenshot({ path: path.join(OUT, '17-live-proxy.png'), fullPage: true });

  await clickText('button', 'Send real request');
  await page.waitForFunction(() => document.body.innerText.includes('HTTP 200'), { timeout: 12000 });

  await page.select('select[aria-label="Live proxy routing strategy"]', 'weighted-round-robin');
  await page.waitForFunction(async () => {
    const response = await fetch('/api/live-proxy/status');
    return (await response.json()).algorithm === 'weighted-round-robin';
  }, { timeout: 10000 });

  await page.waitForFunction(() => {
    const control = document.querySelector('select[aria-label="Weight for EDGE-A"]');
    return control && !control.disabled;
  }, { timeout: 10000 });
  await page.select('select[aria-label="Weight for EDGE-A"]', '5');
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/live-proxy/status')).json();
    return status.upstreams.find((upstream) => upstream.id === 'edge-a')?.weight === 5;
  }, { timeout: 10000 });
  await page.waitForFunction(() => {
    const control = document.querySelector('button[aria-label="Drain EDGE-A"]');
    return control && !control.disabled;
  }, { timeout: 10000 });

  await page.click('button[aria-label="Drain EDGE-A"]');
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/live-proxy/status')).json();
    return status.upstreams.find((upstream) => upstream.id === 'edge-a')?.draining === true;
  }, { timeout: 10000 });
  await clickText('button', 'Send real request');
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/live-proxy/status')).json();
    return status.metrics.totalRequests >= 2 && status.metrics.completedRequests >= 2 && status.recentRequests[0]?.upstreamId !== 'edge-a';
  }, { timeout: 12000 });

  await page.waitForFunction(() => {
    const control = document.querySelector('button[aria-label="Resume EDGE-A"]');
    return control && !control.disabled;
  }, { timeout: 10000 });
  await page.click('button[aria-label="Resume EDGE-A"]');
  await page.waitForFunction(async () => {
    const status = await (await fetch('/api/live-proxy/status')).json();
    return status.upstreams.find((upstream) => upstream.id === 'edge-a')?.draining === false;
  }, { timeout: 10000 });

  await page.select('select[aria-label="Demo proxy route"]', '/api/fail');
  await clickText('button', 'Send real request');
  await page.waitForFunction(() => document.body.innerText.includes('HTTP 503'), { timeout: 12000 });

  await page.select('select[aria-label="Demo proxy route"]', '/api/echo');
  await clickText('button', 'Send real request');
  await page.waitForFunction(() => document.body.innerText.includes('hello from LoadMind'), { timeout: 12000 });

  const metrics = await page.evaluate(async () => (await fetch('/api/live-proxy/status')).json());
  if (metrics.metrics.totalRequests < 4 || metrics.metrics.failedRequests < 1) {
    throw new Error(`Proxy metrics were not updated: ${JSON.stringify(metrics.metrics)}`);
  }
  await page.screenshot({ path: path.join(OUT, '18-live-proxy-requests.png'), fullPage: true });
});

await step('ask LoadMind AI', async () => {
  await page.click('nav button[title^="Control Center"]');
  await wait(800);
  await clickText('button', 'LoadMind AI');
  await wait(700);
  const input = await page.$('input[placeholder^="Ask"]');
  if (!input) throw new Error('Chat input not found');
  await input.type('Why is one server receiving fewer requests?');
  await page.keyboard.press('Enter');
  await wait(2200);
  await page.screenshot({ path: path.join(OUT, '14-chat.png') });
  await page.click('button[title="Close"]');
  await wait(250);
});

await step('traffic controls (spike + burst)', async () => {
  await clickText('button', 'Flash Crowd');
  await wait(2500);
  await clickText('button', 'Inject burst');
  await wait(4000);
  await page.screenshot({ path: path.join(OUT, '15-flash-crowd.png') });
});

await step('full-page control center', async () => {
  await page.screenshot({ path: path.join(OUT, '16-control-full.png'), fullPage: true });
});

await browser.close();

console.log(`\n  screenshots → ${OUT}`);
console.log(`  total console/page errors: ${errors.length}`);
if (errors.length) {
  const unique = [...new Set(errors)];
  console.log('\n--- messages ---');
  unique.slice(0, 25).forEach((e) => console.log(`  ${e}`));
}
console.log(`\n=== ${errors.length === 0 ? 'E2E CLEAN' : 'E2E FAILED'} ===\n`);
process.exitCode = errors.length === 0 ? 0 : 1;
