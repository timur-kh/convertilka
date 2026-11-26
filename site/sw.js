// Service worker: кэширует файлы сайта, чтобы повторные визиты были быстрыми и конвертер работал офлайн.
// Пользовательские файлы сюда никогда не попадают: кэшируются только GET-запросы к нашему же домену.
//
// Страницы и наш код (assets/): сначала сеть, с проверкой свежести у сервера (cache: 'no-cache' —
// браузер спрашивает сервер по ETag и получает «304», если файл не менялся). Так обновление сайта
// доходит до посетителей сразу, даже если сервер отдаёт файлы с долгим Cache-Control.
// Без сети — из кэша.
// Библиотеки (vendor/) не меняются внутри версии — сначала кэш.
// После обновления библиотек увеличьте VERSION, чтобы браузеры сбросили старый кэш.
const VERSION = 'v4';
const CACHE = `kv-${VERSION}`;
const CORE = ['./', 'index.html', 'assets/css/style.css', 'assets/img/favicon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kv-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Сеть с проверкой свежести; успешный ответ кладём в кэш, без сети — отдаём из кэша. */
function networkFirst(req, fallback) {
  return fetch(new Request(req, { cache: 'no-cache' }))
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((r) => r || (fallback ? caches.match(fallback) : Promise.reject(new Error('offline')))));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Библиотеки — сначала кэш (в первый раз тоже со свежей проверкой у сервера)
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(new Request(req, { cache: 'no-cache' })).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
      ),
    );
    return;
  }

  // Страницы и наш код — всегда свежие при наличии сети
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? 'index.html' : null));
});
