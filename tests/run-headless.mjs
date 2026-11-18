// Прогоняет страницу в headless Edge/Chrome и печатает результат + ошибки консоли.
//   node tools/serve.mjs   (в другом окне)
//   node tests/run-headless.mjs [url] [таймаут сек] [файл UI-сценария]
// Нужен Node 22+ (встроенный WebSocket).
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:8080/tests/selftest.html';
const timeoutSec = Number(process.argv[3] || 240);
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = BROWSERS.find(existsSync);
if (!exe) throw new Error('Не найден Edge/Chrome');

const profile = await mkdtemp(join(tmpdir(), 'kv-headless-'));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  } catch { /* ещё стартует */ }
}
if (!target) throw new Error('Браузер не запустился');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const consoleLines = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleLines.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400));
  } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
    consoleLines.push(`[${msg.params.entry.source}.${msg.params.entry.level}] ${msg.params.entry.text.slice(0, 300)} ${msg.params.entry.url || ''}`);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  pending.set(++id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });

const start = Date.now();
let title = '';
while (Date.now() - start < timeoutSec * 1000) {
  await sleep(1000);
  title = await evaluate('document.title');
  if (title && title !== 'RUNNING' && !url.includes('selftest')) break;
  if (/PASS|FAIL/.test(title || '')) break;
}
if (url.includes('selftest')) {
  console.log(await evaluate("document.getElementById('out')?.innerText"));
} else {
  await sleep(3000);
  console.log('title:', title);
  const scenario = process.argv[4];
  if (scenario) {
    const { readFile } = await import('node:fs/promises');
    const res = await send('Runtime.evaluate', { expression: await readFile(scenario, 'utf8'), awaitPromise: true, returnByValue: true, userGesture: true });
    console.log(res?.exceptionDetails ? 'Сценарий упал: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text) : res?.result?.value);
  }
}
// SHOT=путь.png — сохранить скриншот всей страницы; SHOT_WIDTH=390 — ширина (телефон)
if (process.env.SHOT) {
  const { writeFile } = await import('node:fs/promises');
  const width = Number(process.env.SHOT_WIDTH || 1280);
  const height = await evaluate('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(height, 6000), deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(process.env.SHOT, Buffer.from(shot.data, 'base64'));
  console.log('скриншот:', process.env.SHOT);
}
console.log(`\n--- консоль (ошибки и предупреждения): ${consoleLines.length} ---`);
console.log(consoleLines.join('\n'));

ws.close();
browser.kill();
await sleep(500);
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(/FAIL/.test(title) ? 1 : 0);
