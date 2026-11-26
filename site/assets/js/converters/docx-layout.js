// Точная вёрстка DOCX: страницы реального размера (docx-preview) и перенос этой вёрстки в PDF.
//
// 1. renderDocx() раскладывает документ в изолированном iframe (без права на скрипты):
//    размер страниц и поля из документа, колонтитулы, таблицы, картинки, нумерация,
//    разбиение на страницы там, где его сохранил Word.
// 2. Шрифты Microsoft подменяются свободными с теми же метриками (ширина каждой буквы совпадает),
//    поэтому строки переносятся как в Word: Calibri→Carlito, Cambria→Caladea, Arial→Arimo,
//    Times New Roman→Tinos, Courier New→Cousine.
// 3. docxToPdf() переносит готовую вёрстку в PDF: каждое слово — текстом на те же координаты,
//    плюс линии таблиц, заливки и картинки. Текст в PDF можно выделять и искать.
import { loadScript, vendorUrl } from '../util.js';

const PX_TO_PT = 0.75;

/** Какой свободный шрифт подставить вместо шрифта из документа. */
export function mapFont(name) {
  const n = String(name || '').toLowerCase();
  if (/calibri|aptos|carlito|candara|corbel/.test(n)) return 'carlito';
  if (/cambria|caladea/.test(n)) return 'caladea';
  if (/courier|consolas|mono|lucida console|cousine|menlo/.test(n)) return 'cousine';
  if (/times|georgia|garamond|book antiqua|palatino|serif|constantia|bodoni|baskerville|century|tinos|cambria math/.test(n) && !/sans/.test(n)) return 'tinos';
  return 'arimo';
}

let fontsManifest;
async function getFonts() {
  fontsManifest ||= fetch(vendorUrl('fonts/fonts.json')).then((r) => {
    if (!r.ok) throw new Error('Не удалось загрузить шрифты');
    return r.json();
  });
  return fontsManifest;
}

/** Начертания шрифта: у Caladea нет кириллицы — берём её из Tinos (тоже с засечками). */
function facesFor(manifest, key, style) {
  const own = manifest[key]?.[style] || [];
  if (key === 'caladea') return [...own, ...(manifest.tinos?.[style] || []).filter((f) => f.subset.startsWith('cyrillic'))];
  return own;
}
const styleKey = (weight, italic) => `${Number(weight) >= 600 ? 700 : 400}-${italic ? 'italic' : 'normal'}`;

/** @font-face для всех названий шрифтов, встретившихся в документе. */
async function fontFaceCss(names) {
  const manifest = await getFonts();
  const rules = [];
  for (const name of names) {
    const key = mapFont(name);
    for (const style of ['400-normal', '700-normal', '400-italic', '700-italic']) {
      const [w, s] = style.split('-');
      for (const f of facesFor(manifest, key, style)) {
        rules.push(`@font-face{font-family:"${name.replace(/"/g, '')}";font-weight:${w};font-style:${s};src:url("${vendorUrl('fonts/' + f.file)}") format("woff2");unicode-range:${f.range}}`);
      }
    }
  }
  return rules.join('\n');
}

// ---------- Автоматическая разбивка на страницы ----------
// docx-preview делит страницы по меткам, которые сохраняет Word. В документах из Google Docs,
// LibreOffice и программ меток нет — длинный текст оказывается на одной «странице».
// Переносим всё, что не поместилось, на новые страницы: абзацы делим по строкам, таблицы — по строкам таблицы.

/** Первая строка (её верх), которая заходит ниже limit; null — если такой нет или это первая строка. */
function overflowLineTop(doc, el, limit) {
  const range = doc.createRange();
  range.selectNodeContents(el);
  const tops = [...range.getClientRects()].filter((r) => r.height > 0).map((r) => [r.top, r.bottom]);
  tops.sort((a, b) => a[0] - b[0]);
  const lines = [];
  for (const [t, b] of tops) {
    const last = lines[lines.length - 1];
    if (last && t < last.bottom - 2) last.bottom = Math.max(last.bottom, b);
    else lines.push({ top: t, bottom: b });
  }
  const i = lines.findIndex((l) => l.bottom > limit + 0.5);
  return i > 0 ? lines[i].top : null;
}

/** Делит абзац el на две части по строке, начинающейся на высоте lineTop. Возвращает вторую часть или null. */
function splitParagraph(doc, win, el, lineTop) {
  // Поиск позиции по точке работает только в видимой области — прокручиваем к нужной строке
  const before = el.getBoundingClientRect().top;
  win.scrollTo(0, win.scrollY + lineTop - 50);
  const y = lineTop + (el.getBoundingClientRect().top - before) + 2;
  const x = el.getBoundingClientRect().left + 2;
  let node = null, offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) ({ offsetNode: node, offset } = p);
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !el.contains(node)) return null;
  const range = doc.createRange();
  range.setStart(node, offset);
  range.setEnd(el, el.childNodes.length);
  // Разрез в самом начале абзаца ничего не оставит на странице — это не разделение
  const head = doc.createRange();
  head.setStart(el, 0);
  head.setEnd(node, offset);
  if (!head.toString().trim()) return null;
  const rest = el.cloneNode(false);
  rest.append(range.extractContents());
  if (!rest.textContent.trim()) return null;
  rest.style.textIndent = '0'; // продолжение абзаца — без красной строки
  rest.style.marginTop = '0';
  el.style.marginBottom = '0';
  return rest;
}

/** Делит таблицу по строке, которая не помещается. Возвращает таблицу-продолжение или null. */
function splitTable(table, limit) {
  const rows = [...table.rows];
  const i = rows.findIndex((r) => r.getBoundingClientRect().bottom > limit + 0.5);
  if (i <= 0) return null;
  const rest = table.cloneNode(false);
  for (const child of table.children) if (child.tagName === 'COLGROUP') rest.append(child.cloneNode(true));
  const body = (rows[i].parentElement || table).cloneNode(false);
  rest.append(body);
  for (const r of rows.slice(i)) body.append(r);
  return rest;
}

function paginate(doc, win) {
  for (const first of [...doc.querySelectorAll('section.docx')]) {
    let sec = first;
    const pageH0 = parseFloat(win.getComputedStyle(first).minHeight) || 1;
    const maxPages = Math.ceil(first.offsetHeight / pageH0) * 2 + 5; // защита от зацикливания
    let prevHeight = Infinity;
    for (let guard = 0; guard < maxPages; guard++) {
      const cs = win.getComputedStyle(sec);
      const pageH = parseFloat(cs.minHeight);
      if (!pageH || sec.offsetHeight <= pageH + 1) break;
      if (sec.offsetHeight >= prevHeight) break; // перенос ничего не дал — дальше не делим
      prevHeight = sec.offsetHeight;
      const art = sec.querySelector(':scope > article');
      if (!art) break;
      const footer = sec.querySelector(':scope > footer');
      const top = sec.getBoundingClientRect().top;
      const limit = top + pageH - parseFloat(cs.paddingBottom) - (footer ? footer.offsetHeight : 0);
      const kids = [...art.children];
      const idx = kids.findIndex((k) => k.getBoundingClientRect().bottom > limit + 0.5);
      if (idx < 0) break;
      const k = kids[idx];
      let carry = null; // часть разделённого элемента, которая уходит на следующую страницу
      let from = idx;
      if (k.tagName === 'TABLE') {
        carry = splitTable(k, limit);
        if (carry) from = idx + 1;
      } else if (k.tagName === 'P' && k.getBoundingClientRect().top < limit) {
        const lineTop = overflowLineTop(doc, k, limit);
        if (lineTop !== null) {
          carry = splitParagraph(doc, win, k, lineTop);
          if (carry) from = idx + 1;
        }
      }
      if (!carry && from === 0) from = 1; // элемент выше целой страницы (большая картинка) — оставляем как есть
      const moving = kids.slice(from);
      if (!carry && !moving.length) break;
      // Новая страница: та же разметка, копии колонтитулов
      const next = sec.cloneNode(false);
      for (const child of sec.children) {
        if (child === art) {
          const a2 = art.cloneNode(false);
          if (carry) a2.append(carry);
          a2.append(...moving);
          next.append(a2);
        } else next.append(child.cloneNode(true));
      }
      sec.after(next);
      sec = next;
    }
  }
  win.scrollTo(0, 0);
}

const firstFamily = (ff) => (ff || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', '']);

/**
 * Раскладывает DOCX в iframe внутри host. Возвращает { iframe, doc, pages, fit(), dispose() }.
 * Для предпросмотра host — видимый контейнер; для PDF — скрытый за краем экрана.
 */
export async function renderDocx(file, host, { forPdf = false } = {}) {
  await loadScript('jszip/jszip.min.js', 'JSZip');
  const docx = await loadScript('docx-preview/docx-preview.min.js', 'docx');
  const iframe = document.createElement('iframe');
  // Без allow-scripts: никакой код из документа выполниться не может; allow-same-origin — чтобы мы могли разложить DOM
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('title', 'Документ Word');
  iframe.className = forPdf ? 'docx-measure' : 'pv-frame docx-frame';
  iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  const loaded = new Promise((r) => iframe.addEventListener('load', r, { once: true }));
  host.append(iframe);
  await loaded;
  const doc = iframe.contentDocument;
  await docx.renderAsync(await file.arrayBuffer(), doc.body, doc.head, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false, // страницы — там, где их разбил Word при сохранении
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    useBase64URL: true,
    experimental: true,
  });
  // Ссылки: только http(s), почта и якоря; открываются в новой вкладке
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!/^(https?:|mailto:|#)/i.test(href)) a.removeAttribute('href');
    else if (!href.startsWith('#')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
  // Шрифты: подменяем все встретившиеся названия свободными с теми же метриками
  const names = new Set();
  const win = iframe.contentWindow;
  for (const el of doc.body.querySelectorAll('*')) {
    const f = firstFamily(win.getComputedStyle(el).fontFamily);
    if (!GENERIC.has(f.toLowerCase())) names.add(f);
  }
  names.add('Calibri');
  // docx-preview очищает <head> при раскладке — свои стили добавляем после неё
  const style = doc.createElement('style');
  style.textContent = `html,body{margin:0}body{background:#e9ebf0}.docx-wrapper{background:#e9ebf0!important;padding:16px 0!important}.docx-wrapper>section.docx{box-shadow:0 2px 10px rgba(0,0,0,.18)!important;margin-bottom:16px!important}
${await fontFaceCss(names)}`;
  doc.head.append(style);
  doc.body.style.fontFamily = 'Calibri';
  await doc.fonts.ready;
  // Дождаться загрузки начертаний, которые реально используются
  await Promise.all([...doc.fonts].filter((f) => f.status === 'loading').map((f) => f.loaded.catch(() => {})));
  paginate(doc, win);
  const pages = [...doc.querySelectorAll('section.docx')];

  // Предпросмотр: уменьшаем страницы под ширину панели
  let ro = null;
  let userZoom = 1; // множитель от кнопок масштаба: 1 = по ширине окна
  const fit = () => {
    if (forPdf || !pages.length) return;
    const pageW = pages[0].offsetWidth;
    const k = Math.min(1, (iframe.clientWidth - 24) / pageW);
    doc.body.style.zoom = String((k > 0 ? k : 1) * userZoom);
  };
  if (!forPdf) {
    ro = new ResizeObserver(fit);
    ro.observe(iframe);
    fit();
  }
  return {
    iframe,
    doc,
    win,
    pages,
    fit,
    /** Масштаб предпросмотра: z — множитель к «по ширине окна». Возвращает реальный масштаб (1 = 100%). */
    setZoom(z) {
      userZoom = z;
      fit();
      return Number(doc.body.style.zoom) || 1;
    },
    zoomLevel: () => Number(doc.body.style.zoom) || 1,
    dispose() {
      ro?.disconnect();
      iframe.remove();
    },
  };
}

// ---------- DOCX → PDF ----------
const parseColor = (c) => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a < 0.05) return null;
  return { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a };
};

export async function docxToPdf(file, onProgress) {
  const PDFLib = await loadScript('pdf-lib/pdf-lib.min.js', 'PDFLib');
  const fontkit = await loadScript('fontkit/fontkit.umd.min.js', 'fontkit');
  const manifest = await getFonts();
  const host = document.createElement('div');
  host.className = 'docx-measure-host';
  document.body.append(host);
  const r = await renderDocx(file, host, { forPdf: true });
  try {
    if (!r.pages.length) throw new Error('В документе нет страниц');
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const { rgb } = PDFLib;
    const win = r.win;

    // Шрифты для PDF: файлы-подмножества (латиница/кириллица), выбираем по символу
    const fontCache = new Map();
    const faceFont = async (face) => {
      if (!fontCache.has(face.file)) {
        fontCache.set(face.file, (async () => {
          // В PDF встраиваем TTF: на WOFF2 fontkit зависает при создании подмножества шрифта
          const bytes = new Uint8Array(await (await fetch(vendorUrl('fonts/' + (face.ttf || face.file)))).arrayBuffer());
          return { pdfFont: await pdf.embedFont(bytes, { subset: true }), fk: fontkit.create(bytes) };
        })());
      }
      return fontCache.get(face.file);
    };
    const styleFonts = new Map();
    const fontsFor = async (key, style) => {
      const id = key + style;
      if (!styleFonts.has(id)) styleFonts.set(id, Promise.all(facesFor(manifest, key, style).map(faceFont)));
      return styleFonts.get(id);
    };
    /** Делит текст на куски по начертаниям, у которых есть нужные буквы. */
    const segments = (text, faces) => {
      const out = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        const f = faces.find((x) => x.fk.hasGlyphForCodePoint(cp)) || faces[0];
        const last = out[out.length - 1];
        if (last && last.f === f) last.t += ch;
        else out.push({ f, t: ch });
      }
      return out;
    };

    const imgCache = new Map();
    const embedImage = async (img) => {
      const src = img.currentSrc || img.src;
      if (!imgCache.has(src)) {
        imgCache.set(src, (async () => {
          if (/^data:image\/jpe?g;base64,/i.test(src)) return pdf.embedJpg(await (await fetch(src)).arrayBuffer());
          if (/^data:image\/png;base64,/i.test(src)) return pdf.embedPng(await (await fetch(src)).arrayBuffer());
          // Прочие форматы (EMF/GIF/BMP…): через canvas в PNG, если браузер их показал
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 1;
          c.height = img.naturalHeight || 1;
          c.getContext('2d').drawImage(img, 0, 0);
          return pdf.embedPng(await (await new Promise((ok) => c.toBlob(ok, 'image/png'))).arrayBuffer());
        })().catch(() => null));
      }
      return imgCache.get(src);
    };

    for (const [pi, page] of r.pages.entries()) {
      const pr = page.getBoundingClientRect();
      const pw = pr.width * PX_TO_PT, ph = pr.height * PX_TO_PT;
      const out = pdf.addPage([pw, ph]);
      const X = (x) => (x - pr.left) * PX_TO_PT;
      const Y = (y) => ph - (y - pr.top) * PX_TO_PT;

      // 1) Заливки, линии таблиц и рамки, картинки — в порядке документа
      for (const el of page.querySelectorAll('*')) {
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        const bg = parseColor(cs.backgroundColor);
        if (bg && !(bg.r > 0.99 && bg.g > 0.99 && bg.b > 0.99)) {
          out.drawRectangle({ x: X(b.left), y: Y(b.bottom), width: b.width * PX_TO_PT, height: b.height * PX_TO_PT, color: rgb(bg.r, bg.g, bg.b), opacity: bg.a });
        }
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          const w = parseFloat(cs[`border${side}Width`]);
          const st = cs[`border${side}Style`];
          const col = parseColor(cs[`border${side}Color`]);
          if (!w || st === 'none' || st === 'hidden' || !col) continue;
          const t = w * PX_TO_PT;
          const [x1, y1, x2, y2] = side === 'Top' ? [b.left, b.top + w / 2, b.right, b.top + w / 2]
            : side === 'Bottom' ? [b.left, b.bottom - w / 2, b.right, b.bottom - w / 2]
            : side === 'Left' ? [b.left + w / 2, b.top, b.left + w / 2, b.bottom]
            : [b.right - w / 2, b.top, b.right - w / 2, b.bottom];
          out.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: t, color: rgb(col.r, col.g, col.b), opacity: col.a, dashArray: st === 'dashed' ? [3 * t, 2 * t] : st === 'dotted' ? [t, t] : undefined });
        }
        if (el.tagName === 'IMG' && el.complete && el.naturalWidth) {
          const img = await embedImage(el);
          if (img) out.drawImage(img, { x: X(b.left), y: Y(b.bottom), width: b.width * PX_TO_PT, height: b.height * PX_TO_PT });
        }
      }

      // 2) Текст: каждое слово — на свои координаты (так сохраняются выравнивание по ширине, табуляция, отступы)
      const walker = r.doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
      const range = r.doc.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.data.trim()) continue;
        const cs = win.getComputedStyle(parent);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
        const key = mapFont(firstFamily(cs.fontFamily));
        const sk = styleKey(cs.fontWeight, cs.fontStyle === 'italic' || cs.fontStyle === 'oblique');
        const own = await fontsFor(key, sk);
        if (!own.length) continue;
        // Символа нет в шрифте (например, «₽» в Carlito) — ищем в других, как это делает браузер
        const faces = [...own, ...(key !== 'arimo' ? await fontsFor('arimo', sk) : []), ...(key !== 'tinos' ? await fontsFor('tinos', sk) : [])];
        const sizePx = parseFloat(cs.fontSize);
        const size = sizePx * PX_TO_PT;
        const col = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
        const color = rgb(col.r, col.g, col.b);
        const deco = cs.textDecorationLine || '';
        const fk0 = own[0].fk;
        const ascRatio = fk0.ascent / (fk0.ascent - fk0.descent); // доля высоты строки над базовой линией
        for (const m of node.data.matchAll(/\S+/g)) {
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = [...range.getClientRects()].filter((q) => q.width > 0);
          if (!rects.length) continue;
          // Слово целиком на одной строке — рисуем разом; разорванное переносом — по буквам
          const pieces = rects.length === 1 ? [{ text: m[0], rect: rects[0] }] : [...m[0]].map((ch, k) => {
            range.setStart(node, m.index + k);
            range.setEnd(node, m.index + k + ch.length);
            return { text: ch, rect: range.getBoundingClientRect() };
          });
          for (const { text, rect } of pieces) {
            if (rect.bottom < pr.top || rect.top > pr.bottom) continue; // за пределами страницы
            const baseline = rect.top + rect.height * ascRatio;
            let x = X(rect.left);
            for (const seg of segments(text, faces)) {
              out.drawText(seg.t, { x, y: Y(baseline), size, font: seg.f.pdfFont, color, opacity: col.a });
              x += seg.f.pdfFont.widthOfTextAtSize(seg.t, size);
            }
            const lineW = Math.max(0.5, size / 18);
            if (deco.includes('underline')) out.drawLine({ start: { x: X(rect.left), y: Y(baseline) - size * 0.12 }, end: { x: X(rect.right), y: Y(baseline) - size * 0.12 }, thickness: lineW, color });
            if (deco.includes('line-through')) out.drawLine({ start: { x: X(rect.left), y: Y(baseline) + size * 0.28 }, end: { x: X(rect.right), y: Y(baseline) + size * 0.28 }, thickness: lineW, color });
          }
        }
      }
      onProgress?.((pi + 1) / r.pages.length);
    }
    return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), pages: r.pages.length, size: `${Math.round(r.pages[0].offsetWidth * PX_TO_PT / 72 * 25.4)}×${Math.round(r.pages[0].offsetHeight * PX_TO_PT / 72 * 25.4)} мм` };
  } finally {
    r.dispose();
    host.remove();
  }
}
