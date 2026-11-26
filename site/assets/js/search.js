// Поиск по сайту: кнопка в шапке, Ctrl+K или «/». Индекс (search-index.json) собирает tools/build-pages.mjs.
// Понимает запросы-конвертации («png в avif», «ворд в пдф») и запросы в неправильной раскладке («gyu» → «пнг»).
import { FORMATS, targetsFor, browserCantEncode } from './formats.js';

const ROOT = new URL('../../', import.meta.url); // корень сайта — от адреса этого скрипта
let indexPromise = null;
const loadIndex = () => (indexPromise ||= fetch(new URL('search-index.json', ROOT)).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}).catch((e) => {
  indexPromise = null;
  throw e;
}));

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const swapLayout = (s) => [...s].map((c) => {
  const i = EN.indexOf(c);
  if (i >= 0) return RU[i];
  const j = RU.indexOf(c);
  return j >= 0 ? EN[j] : c;
}).join('');
// Слова-связки в запросах-конвертациях
const GLUE = new Set(['в', 'во', 'to', 'into', 'на', 'из', 'from', '2', '->', '→', '-', 'конвертировать', 'перевести', 'преобразовать', 'конвертер', 'convert', 'как', 'онлайн', 'файл', 'формат']);

function formatKey(word, aliases) {
  if (FORMATS[word]) return word;
  for (const [k, f] of Object.entries(FORMATS)) if (f.aliases?.includes(word)) return k;
  return aliases[word] || null;
}

/** «png в avif» → { from: 'png', to: 'avif' }; одно название формата → { from }. */
function parseIntent(q, aliases) {
  const words = q.split(/[\s,.;:→>]+|-(?=>)/).filter((w) => w && !GLUE.has(w));
  const found = [];
  for (const w of words) {
    const k = formatKey(w, aliases);
    if (k && !found.includes(k)) found.push(k);
  }
  return { from: found[0] || null, to: found[1] || null };
}

// Как пишут по-русски названия сервисов и устройств
const SYNONYMS = {
  телеграм: 'telegram', телеграмм: 'telegram', тг: 'telegram', ватсап: 'whatsapp', вотсап: 'whatsapp', вацап: 'whatsapp',
  айфон: 'iphone', айфона: 'iphone', андроид: 'android', ютуб: 'youtube', винда: 'windows', виндовс: 'windows', мак: 'mac', макбук: 'mac',
  озон: 'ozon', вайлдберриз: 'wildberries', вб: 'wildberries', обс: 'obs', автокад: 'autocad', солидворкс: 'solidworks', компас: 'компас-3d',
};
// Грубое отсечение русских окончаний: «голосовые» и «голосовых» найдут друг друга
const stem = (w) => (/[а-я]/.test(w) && w.length > 5 ? w.slice(0, w.length > 7 ? -3 : -2) : w);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function score(entry, tokens) {
  const t = norm(entry.t), k = norm(entry.k || ''), d = norm(entry.d || '');
  let s = 0;
  for (const tok of tokens) {
    let best = 0;
    for (const variant of [tok, SYNONYMS[tok]].filter(Boolean)) {
      const st = stem(variant);
      const wordStart = (txt) => new RegExp(`(^|[^a-zа-я0-9])${reEsc(st)}`).test(txt);
      let v = 0;
      if (wordStart(t)) v = t.startsWith(variant) ? 12 : 8;
      else if (wordStart(k)) v = 5;
      else if (st.length >= 3 && (t.includes(st) || k.includes(st))) v = 3;
      else if (st.length >= 3 && wordStart(d)) v = 1.5;
      best = Math.max(best, v);
    }
    if (!best) return 0; // каждое слово запроса должно где-то найтись
    s += best;
  }
  return s;
}

function search(index, raw) {
  const q = norm(raw).trim();
  if (!q) return { items: [], hint: '' };
  const run = (query) => {
    const tokens = query.split(/[\s,]+/).filter((w) => w && !GLUE.has(w));
    const { from, to } = parseIntent(query, index.aliases);
    const items = [];
    // Запрос-конвертация: «png в avif»
    if (from && to) {
      const ok = targetsFor(from).includes(to);
      const page = index.pages.find((p) => p.from === from && p.to === to);
      if (page) items.push({ ...page, score: 1000 });
      else if (ok) {
        const article = index.pages.find((p) => p.fmt === from);
        items.push({
          t: `${FORMATS[from].label} → ${FORMATS[to].label}`, g: 'Конвертация', score: 1000,
          d: 'Откроется конвертер с уже выбранным форматом — перетащите файл.',
          u: `${article ? article.u : ''}?to=${to}`,
        });
      } else if (browserCantEncode(from, to)) {
        items.push({ t: `${FORMATS[from].label} → ${FORMATS[to].label}: ваш браузер не умеет сохранять ${FORMATS[to].label}`, g: 'Конвертация', score: 1000, d: 'Откройте сайт в свежем Chrome, Edge или Firefox — там эта конвертация работает.', u: null });
      } else {
        const can = targetsFor(from).filter((x) => x !== from).map((x) => FORMATS[x].label).join(', ');
        items.push({ t: `${FORMATS[from].label} → ${FORMATS[to]?.label || to}: такой конвертации нет`, g: 'Конвертация', score: 1000, d: can ? `Из ${FORMATS[from].label} можно сделать: ${can}.` : '', u: null });
      }
    }
    for (const p of index.pages) {
      let s = tokens.length ? score(p, tokens) : 0;
      if (from && p.fmt === from) s += 30; // статья об этом формате — первой
      else if (from && p.from === from) s += 20; // затем инструменты для него
      if (s > 0 && !items.some((x) => x.u === p.u)) items.push({ ...p, score: s });
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 12);
  };
  let items = run(q);
  let hint = '';
  if (!items.length) {
    const alt = swapLayout(q);
    if (alt !== q) {
      items = run(alt);
      if (items.length) hint = `Показаны результаты для «${alt}»`;
    }
  }
  return { items, hint };
}

// ---------- Интерфейс ----------
let dlg, input, list, hintEl, active = -1, results = [];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids.filter((x) => x != null));
  return e;
}

/** Подсветка совпадений без innerHTML: текст бьётся на части, совпадения — в <mark>. */
function highlight(text, tokens) {
  const frag = document.createDocumentFragment();
  if (!tokens.length) {
    frag.append(text);
    return frag;
  }
  const alt = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const split = new RegExp(`(${alt})`, 'i'); // с группой: split оставляет совпадения в массиве
  const whole = new RegExp(`^(?:${alt})$`, 'i');
  for (const part of String(text).split(split)) if (part) frag.append(whole.test(part) ? el('mark', {}, part) : part);
  return frag;
}

function build() {
  input = el('input', { type: 'search', class: 'search-input', placeholder: 'Формат, конвертация или вопрос: «png в webp», «чем открыть djvu»…', 'aria-label': 'Поиск по сайту', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'search-results' });
  list = el('ul', { class: 'search-results', id: 'search-results', role: 'listbox', 'aria-label': 'Результаты' });
  hintEl = el('p', { class: 'search-hint' });
  const close = el('button', { type: 'button', class: 'icon-btn search-close', 'aria-label': 'Закрыть поиск' }, '✕');
  const foot = el('div', { class: 'search-foot' }, el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' выбор'), el('span', {}, el('kbd', {}, 'Enter'), ' открыть'), el('span', {}, el('kbd', {}, 'Esc'), ' закрыть'));
  dlg = el('dialog', { class: 'search-dlg', 'aria-label': 'Поиск по сайту' },
    el('div', { class: 'search-box' }, el('span', { class: 'search-ic', 'aria-hidden': 'true' }), input, close),
    hintEl, list, foot);
  document.body.append(dlg);
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // клик по фону
  dlg.addEventListener('close', () => document.documentElement.classList.remove('search-open'));
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.querySelectorAll('a.search-item').length;
      if (n) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      const a = list.querySelectorAll('a.search-item')[Math.max(0, active)];
      if (a) {
        e.preventDefault();
        a.click();
      }
    }
  });
}

function setActive(i) {
  const links = list.querySelectorAll('a.search-item');
  links.forEach((a, k) => a.setAttribute('aria-selected', String(k === i)));
  active = i;
  links[i]?.scrollIntoView({ block: 'nearest' });
  if (links[i]) input.setAttribute('aria-activedescendant', links[i].id);
}

async function update() {
  const q = input.value;
  let index;
  try {
    index = await loadIndex();
  } catch {
    list.replaceChildren(el('li', { class: 'search-empty' }, 'Не удалось загрузить поиск. Проверьте подключение к интернету.'));
    return;
  }
  if (q !== input.value) return; // пока грузилось, запрос поменялся
  const { items, hint } = search(index, q);
  results = items;
  hintEl.textContent = hint;
  hintEl.hidden = !hint;
  const tokens = norm(hint ? swapLayout(norm(q)) : q).split(/\s+/).filter((w) => w.length > 1 && !GLUE.has(w));
  if (!q.trim()) {
    list.replaceChildren(...['png в jpg', 'heic в jpg', 'сжать pdf', 'mov в mp4', 'чем открыть djvu', 'ворд в пдф'].map((s) =>
      el('li', { class: 'search-suggest' }, Object.assign(el('button', { type: 'button' }, s), { onclick: () => { input.value = s; update(); input.focus(); } }))));
    list.prepend(el('li', { class: 'search-group' }, 'Например'));
    active = -1;
    return;
  }
  if (!items.length) {
    list.replaceChildren(el('li', { class: 'search-empty' }, `Ничего не нашлось по запросу «${q}». Попробуйте название формата, например «webp» или «docx».`));
    return;
  }
  let group = '';
  const rows = [];
  items.forEach((it, i) => {
    if (it.g !== group) rows.push(el('li', { class: 'search-group', role: 'presentation' }, (group = it.g)));
    const body = [el('span', { class: 'search-t' }, highlight(it.t, tokens)), it.d ? el('span', { class: 'search-d' }, highlight(it.d, tokens)) : null];
    rows.push(el('li', { role: 'presentation' }, it.u === null
      ? el('div', { class: 'search-item search-item-info' }, ...body)
      : Object.assign(el('a', { class: 'search-item', role: 'option', id: `sr-${i}`, href: new URL(it.u, ROOT).href }, ...body), { onmousemove() { setActive([...list.querySelectorAll('a.search-item')].indexOf(this)); } })));
  });
  list.replaceChildren(...rows);
  setActive(0);
}

export function openSearch(initial = '') {
  if (!dlg) build();
  if (!dlg.open) {
    dlg.showModal();
    document.documentElement.classList.add('search-open');
  }
  if (initial) input.value = initial;
  input.focus();
  input.select();
  update();
}

for (const b of document.querySelectorAll('[data-search]')) b.addEventListener('click', () => openSearch());
// Встроенное поле поиска (например, на странице 404): ввод сразу открывает окно поиска
for (const f of document.querySelectorAll('[data-search-inline]')) {
  f.addEventListener('input', () => {
    const v = f.value;
    f.value = '';
    openSearch(v);
  });
}
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if ((e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openSearch();
  } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    openSearch();
  }
});
// Подгружаем индекс заранее, когда браузер свободен — чтобы первый поиск был мгновенным
(window.requestIdleCallback || setTimeout)(() => loadIndex().catch(() => {}), { timeout: 4000 });
