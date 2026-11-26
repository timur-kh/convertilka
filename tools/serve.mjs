// Локальный сервер для проверки сайта: node tools/serve.mjs [порт]
// Открывайте http://localhost:8080 (через file:// модули JS не работают).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  // Как nginx по умолчанию: .mjs отдаётся как text/plain, и браузер не запустит такой модуль.
  // Так ошибка «.mjs на сайте» видна уже локально (все библиотеки сохраняются как .js — см. tools/vendor.mjs).
  '.mjs': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};
// Те же заголовки, что в site/_headers
const HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-cache',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    // /tests/* — самотест (tests/selftest.html), на хостинг не попадает
    const ROOT = path.startsWith('/tests/') ? TESTS : SITE;
    if (ROOT === TESTS) path = path.slice('/tests'.length);
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) throw Object.assign(new Error(), { code: 'ENOENT' });
    if ((await stat(file)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOENT' });
    const body = await readFile(file);
    res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    // Как nginx с «error_page 404 /404.html»: несуществующий адрес — красивая страница 404
    if (e.code === 'ENOENT') {
      try {
        const page = await readFile(join(SITE, '404.html'));
        res.writeHead(404, { ...HEADERS, 'Content-Type': TYPES['.html'] });
        res.end(page);
        return;
      } catch { /* нет 404.html — простой текст ниже */ }
    }
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.code === 'ENOENT' ? 'Не найдено' : 'Ошибка сервера');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Сайт: http://localhost:${PORT}`));
