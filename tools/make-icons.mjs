// Растровые иконки из site/assets/img/favicon.svg: favicon.ico (16/32/48) в корне сайта,
// PNG 180 (iPhone), 192 и 512 (Android, Google). Рисует сам браузер (headless Edge/Chrome), без лишних программ.
//   node tools/make-icons.mjs   (нужен запущенный node tools/serve.mjs 8080)
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const SIZES = [16, 32, 48, 180, 192, 512];

// Сценарий для страницы: рисуем SVG на холсте нужного размера и возвращаем PNG в base64
const scenario = `(async () => {
  const img = new Image();
  img.src = '/assets/img/favicon.svg';
  await img.decode();
  const out = {};
  for (const s of ${JSON.stringify(SIZES)}) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s, s);
    out[s] = c.toDataURL('image/png').split(',')[1];
  }
  return 'ICONS:' + JSON.stringify(out);
})();`;
const tmp = mkdtempSync(join(tmpdir(), 'kv-icons-'));
const scriptPath = join(tmp, 'icons.js');
writeFileSync(scriptPath, scenario);
const res = spawnSync(process.execPath, [join(ROOT, 'tests', 'run-headless.mjs'), 'http://localhost:8080/', '10', scriptPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
rmSync(tmp, { recursive: true, force: true });
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('ICONS:'));
if (!line) throw new Error('Браузер не вернул иконки. Запущен ли node tools/serve.mjs 8080?\n' + res.stdout + res.stderr);
const png = Object.fromEntries(Object.entries(JSON.parse(line.slice(6))).map(([s, b]) => [s, Buffer.from(b, 'base64')]));

// ICO с PNG внутри (поддерживается с Windows Vista и всеми браузерами)
const icoSizes = [16, 32, 48];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); // ширина, высота
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6); // плоскости, бит на пиксель
  header.writeUInt32LE(png[s].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(join(SITE, 'favicon.ico'), Buffer.concat([header, ...icoSizes.map((s) => png[s])]));
writeFileSync(join(SITE, 'assets', 'img', 'apple-touch-icon.png'), png[180]);
writeFileSync(join(SITE, 'assets', 'img', 'icon-192.png'), png[192]);
writeFileSync(join(SITE, 'assets', 'img', 'icon-512.png'), png[512]);
console.log('Готово: site/favicon.ico (16, 32, 48), assets/img/apple-touch-icon.png, icon-192.png, icon-512.png');
