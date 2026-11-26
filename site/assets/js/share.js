// «Поделиться» и благодарность: значки площадок (обычные ссылки — никаких сторонних скриптов и запросов,
// пока человек сам не нажмёт), строка в подвале и всплывающее окно на каждой 10-й конвертации.
import { h } from './util.js';
import { goal } from './analytics.js';

const SITE = 'https://convertilka.com/';
const TEXT = 'Конвертилка — конвертер файлов, который не отправляет ваши файлы на сервер. Без лимитов и регистрации.';
const EVERY = 10; // окно благодарности — на каждой 10-й успешной конвертации
const enc = encodeURIComponent;

// Упрощённые значки в фирменных цветах (SVG 24×24, белый знак на цветном круге)
const SVG_NS = 'http://www.w3.org/2000/svg';
const PLATFORMS = [
  {
    id: 'vk', name: 'ВКонтакте', color: '#0077FF',
    url: () => `https://vk.com/share.php?url=${enc(SITE)}&title=${enc(TEXT)}`,
    glyph: '<path d="M6.2 8.2h2.1c.1 2.6 1.3 3.9 2.2 4.1V8.2h2v2.3c.9-.1 1.9-1.2 2.2-2.3h2c-.3 1.5-1.4 2.6-2.2 3 .8.4 2 1.4 2.5 3.2h-2.2c-.4-1.2-1.4-2.1-2.3-2.2v2.2h-.3c-4.3 0-6.7-2.9-6-6.2z" fill="#fff"/>',
  },
  {
    id: 'tg', name: 'Telegram', color: '#26A5E4',
    url: () => `https://t.me/share/url?url=${enc(SITE)}&text=${enc(TEXT)}`,
    glyph: '<path d="M5.6 11.6l11-4.3c.5-.2 1 .1.8.9l-1.9 8.9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.3-4.8c.2-.2 0-.3-.3-.1l-6.6 4.1-2.8-.9c-.6-.2-.6-.6.2-.9z" fill="#fff"/>',
  },
  {
    id: 'wa', name: 'WhatsApp', color: '#25D366',
    url: () => `https://wa.me/?text=${enc(`${TEXT} ${SITE}`)}`,
    glyph: '<path d="M12 5.5a6.4 6.4 0 0 0-5.5 9.7L5.6 18.5l3.4-.9A6.4 6.4 0 1 0 12 5.5z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.7 9.2c.2-.4.4-.4.6-.4h.4c.1 0 .3 0 .4.3l.6 1.4c0 .1 0 .3-.1.4l-.4.5c-.1.1-.1.2 0 .4.4.7 1.2 1.5 2 1.9.2.1.3.1.4 0l.5-.6c.1-.2.3-.2.4-.1l1.3.6c.2.1.3.2.3.3 0 .4-.1.9-.5 1.2-.4.3-1 .5-1.8.3-1.7-.5-3.4-2-4.1-3.6-.4-.9-.4-1.7 0-2.3z" fill="#fff"/>',
  },
  {
    id: 'ok', name: 'Одноклассники', color: '#EE8208',
    url: () => `https://connect.ok.ru/offer?url=${enc(SITE)}&title=${enc(TEXT)}`,
    glyph: '<circle cx="12" cy="8.6" r="2.4" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M8.6 12.9a6 6 0 0 0 6.8 0M12 14.3l-2.6 3.3M12 14.3l2.6 3.3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  },
];

function icon(p) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // Разметка значков — наша собственная константа выше, не пользовательские данные
  svg.innerHTML = `<circle cx="12" cy="12" r="12" fill="${p.color}"/>${p.glyph}`;
  return svg;
}

/** Ряд значков «поделиться» + «скопировать ссылку» (+ системное «Поделиться» на телефонах). */
export function shareRow({ compact = false } = {}) {
  const row = h('div', { class: `share-row${compact ? ' is-compact' : ''}` });
  for (const p of PLATFORMS) {
    row.append(h('a', { class: 'share-btn', href: p.url(), target: '_blank', rel: 'noopener noreferrer', title: `Поделиться: ${p.name}`, 'aria-label': `Поделиться: ${p.name}`, onclick: () => goal('share', { platform: p.id }) }, icon(p)));
  }
  const copy = h('button', { type: 'button', class: 'share-btn share-copy', title: 'Скопировать ссылку', 'aria-label': 'Скопировать ссылку на сайт' }, '🔗');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SITE);
      copy.textContent = '✓';
      copy.title = 'Ссылка скопирована';
    } catch {
      copy.textContent = '✕';
      copy.title = `Не удалось скопировать. Адрес: ${SITE}`;
    }
    setTimeout(() => { copy.textContent = '🔗'; copy.title = 'Скопировать ссылку'; }, 2000);
  });
  row.append(copy);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    const native = h('button', { type: 'button', class: 'share-btn share-native', title: 'Поделиться', 'aria-label': 'Поделиться через приложение' }, '⤴');
    native.addEventListener('click', () => navigator.share({ title: 'Конвертилка', text: TEXT, url: SITE }).catch(() => {}));
    row.append(native);
  }
  return row;
}

// ---------- Счётчик конвертаций и окно благодарности ----------
const KEY = 'kv-conversions';
function bump() {
  let n = 0;
  try {
    n = (Number(localStorage.getItem(KEY)) || 0) + 1;
    localStorage.setItem(KEY, String(n));
  } catch {
    // Приватный режим без хранилища: считаем в рамках вкладки
    n = (bump.session = (bump.session || 0) + 1);
  }
  return n;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const isTouch = matchMedia('(pointer: coarse)').matches;
let open = null;

/**
 * Вызывать после каждой успешной конвертации. На каждой 10-й показывает окно:
 * «Скачать» результат, подсказка про закладки и значки «поделиться».
 * download — функция скачивания результата, name — подпись файла.
 */
export function noteConversion({ download, name }) {
  const n = bump();
  if (n % EVERY !== 0) return;
  open?.remove();
  const close = h('button', { type: 'button', class: 'icon-btn thanks-close', 'aria-label': 'Закрыть' }, '✕');
  const dl = h('button', { type: 'button', class: 'btn btn-download is-new' },
    h('span', { class: 'dl-icon', 'aria-hidden': 'true' }), h('span', { class: 'dl-text' }, 'Скачать'), h('span', { class: 'dl-name' }, name));
  dl.addEventListener('click', download);
  dl.addEventListener('animationend', (e) => e.target === dl && dl.classList.remove('is-new'));
  const bookmark = isTouch
    ? 'добавьте его на главный экран (меню браузера → «На главный экран»)'
    : h('span', {}, 'добавьте его в закладки ', h('kbd', {}, isMac ? '⌘' : 'Ctrl'), '+', h('kbd', {}, 'D'));
  const card = h('aside', { class: 'thanks', role: 'dialog', 'aria-label': 'Спасибо, что пользуетесь Конвертилкой', 'aria-live': 'polite' },
    close,
    h('p', { class: 'thanks-title' }, `🎉 Готово! Это уже ${n}-я конвертация`),
    dl,
    h('p', { class: 'thanks-text' }, 'Если сайт Вам полезен, то ', bookmark, ' и поделитесь с друзьями — это сильно поможет нашему развитию. Спасибо!'),
    shareRow({ compact: true }),
  );
  const hide = () => {
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 200);
    document.removeEventListener('keydown', onKey);
    open = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') hide(); };
  close.addEventListener('click', hide);
  document.addEventListener('keydown', onKey);
  document.body.append(card);
  open = card;
  goal('thanks_popup', { conversions: n });
}

// Строка «Поделиться» в подвале — на всех страницах с конвертером
const footerSlot = document.querySelector('[data-share-footer]');
if (footerSlot) footerSlot.append(h('span', { class: 'share-label' }, 'Поделиться:'), shareRow({ compact: true }));
