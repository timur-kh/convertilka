# Логотип Конвертилки

Временно убран из шапки сайта (20.11.2026). Здесь — исходник и готовые размеры.

- `logo.svg` — исходник (тот же, что `site/assets/img/favicon.svg`)
- `favicon.ico` — 16, 32 и 48 px
- `logo-180.png`, `logo-192.png`, `logo-512.png` — для iPhone, Android и Google

Как вернуть в шапку: в `site/index.html`, `privacy.html`, `licenses.html`, `support.html` и `404.html`
внутрь `<a class="logo" …>` перед `<span>Конвертилка</span>` добавить
`<img src="assets/img/favicon.svg" alt="" width="28" height="28">` (в 404.html путь с `/` в начале),
затем `node tools/build-pages.mjs`.
