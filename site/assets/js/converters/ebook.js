// Электронные книги: FB2 (в т.ч. .fb2.zip) и EPUB → EPUB / FB2 / PDF / DOCX / HTML / TXT.
// Внутреннее представление книги:
//   { title, author, lang, chapters: [{ title, html }], images: Map(id → {mime, data: Uint8Array}), cover: id | null }
// В html глав картинки указаны как <img src="img:ID">.
import { vendorUrl, baseName, escapeHtml } from '../util.js';
import { sanitizeHtml, wrapHtmlDocument } from '../sanitize.js';

const fflate = () => import(vendorUrl('three/addons/libs/fflate.module.js'));
const isZip = (u8) => u8[0] === 0x50 && u8[1] === 0x4b;
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

function b64ToBytes(s) {
  const bin = atob(s.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const dataUrl = (img) => `data:${img.mime};base64,${bytesToB64(img.data)}`;

/** Текст XML с учётом кодировки из заголовка <?xml encoding="windows-1251"?> — так записаны многие FB2. */
function decodeXml(u8) {
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 300));
  const enc = (/encoding=["']([\w-]+)["']/i.exec(head)?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(enc).decode(u8);
  } catch {
    return new TextDecoder('utf-8').decode(u8);
  }
}

function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${what}: файл повреждён (ошибка XML)`);
  return doc;
}
// FB2 и EPUB используют пространства имён — ищем элементы по локальному имени
const kids = (el, name) => [...(el?.children || [])].filter((c) => c.localName === name);
const kid = (el, name) => kids(el, name)[0] || null;
const all = (el, name) => (el ? [...el.getElementsByTagNameNS('*', name)] : []);
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const href = (el) => el?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el?.getAttribute('l:href') || el?.getAttribute('xlink:href') || el?.getAttribute('href') || '';

// ---------- Чтение FB2 ----------
async function readFb2(bytes) {
  if (isZip(bytes)) {
    // .fb2.zip — внутри один .fb2
    const { unzipSync } = await fflate();
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /\.fb2$/i.test(n));
    if (!name) throw new Error('В архиве нет файла .fb2');
    bytes = files[name];
  }
  const doc = parseXml(decodeXml(bytes), 'FB2');
  const root = doc.documentElement;
  if (root.localName !== 'FictionBook') throw new Error('Это не книга FB2');
  const info = all(root, 'title-info')[0];
  const authors = kids(info, 'author').map((a) => [text(kid(a, 'first-name')), text(kid(a, 'middle-name')), text(kid(a, 'last-name'))].filter(Boolean).join(' ') || text(kid(a, 'nickname'))).filter(Boolean);
  const images = new Map();
  for (const b of kids(root, 'binary')) {
    const id = b.getAttribute('id');
    if (!id) continue;
    try {
      images.set(id, { mime: b.getAttribute('content-type') || 'image/jpeg', data: b64ToBytes(b.textContent) });
    } catch { /* битая картинка — пропускаем */ }
  }
  const coverHref = href(all(kid(info, 'coverpage'), 'image')[0]).replace(/^#/, '');

  const toHtml = (el, depth = 2) => {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        out += escapeHtml(n.data);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.localName;
      const inner = () => toHtml(n, depth);
      switch (tag) {
        case 'p': out += `<p>${inner()}</p>`; break;
        case 'emphasis': out += `<em>${inner()}</em>`; break;
        case 'strong': out += `<strong>${inner()}</strong>`; break;
        case 'strikethrough': out += `<s>${inner()}</s>`; break;
        case 'sub': case 'sup': case 'code': out += `<${tag}>${inner()}</${tag}>`; break;
        case 'empty-line': out += '<p class="empty">&nbsp;</p>'; break;
        case 'subtitle': out += `<h4>${inner()}</h4>`; break;
        case 'title': out += `<h${Math.min(depth, 6)}>${kids(n, 'p').map((p) => toHtml(p, depth)).join('<br>') || inner()}</h${Math.min(depth, 6)}>`; break;
        case 'epigraph': out += `<blockquote class="epigraph">${inner()}</blockquote>`; break;
        case 'cite': out += `<blockquote>${inner()}</blockquote>`; break;
        case 'text-author': out += `<p class="author">${inner()}</p>`; break;
        case 'poem': case 'stanza': out += `<div class="${tag}">${inner()}</div>`; break;
        case 'v': out += `<p class="verse">${inner()}</p>`; break;
        case 'image': {
          const id = href(n).replace(/^#/, '');
          if (images.has(id)) out += `<img src="img:${escapeHtml(id)}" alt="">`;
          break;
        }
        case 'a': {
          const h = href(n);
          out += h.startsWith('#') ? `<sup>${inner()}</sup>` : `<a href="${escapeHtml(h)}">${inner()}</a>`;
          break;
        }
        case 'section': out += toHtml(n, depth + 1); break;
        case 'table': out += `<table>${inner()}</table>`; break;
        case 'tr': out += `<tr>${inner()}</tr>`; break;
        case 'td': case 'th': out += `<${tag}>${inner()}</${tag}>`; break;
        default: out += inner();
      }
    }
    return out;
  };

  const bodies = kids(root, 'body');
  const main = bodies.find((b) => !b.getAttribute('name')) || bodies[0];
  if (!main) throw new Error('В FB2 нет текста');
  const chapters = [];
  // Вступление до первой секции: обычно там только название книги (оно уже есть в описании),
  // отдельной главой делаем, только если есть что-то ещё — эпиграф, предисловие
  const intro = [...main.childNodes].filter((n) => n.nodeType === Node.ELEMENT_NODE && n.localName !== 'section' && n.localName !== 'title');
  const introHtml = intro.map((n) => toHtml({ childNodes: [n] }, 1)).join('');
  if (introHtml.replace(/<[^>]+>|&nbsp;/g, '').trim()) chapters.push({ title: 'Вступление', html: introHtml });
  for (const s of kids(main, 'section')) chapters.push({ title: text(kid(s, 'title')) || `Глава ${chapters.length + 1}`, html: toHtml({ childNodes: [s] }, 1) });
  // Примечания
  for (const b of bodies.filter((x) => x !== main)) {
    const html = toHtml(b, 2);
    if (html.trim()) chapters.push({ title: text(kid(b, 'title')) || 'Примечания', html });
  }
  return {
    title: text(kid(info, 'book-title')) || 'Без названия',
    author: authors.join(', '),
    lang: text(kid(info, 'lang')) || 'ru',
    chapters,
    images,
    cover: images.has(coverHref) ? coverHref : null,
  };
}

// ---------- Чтение EPUB ----------
async function readEpub(bytes) {
  const { unzipSync, strFromU8 } = await fflate();
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('EPUB повреждён: не удалось распаковать архив');
  }
  const get = (p) => files[p] || files[decodeURIComponent(p)];
  const container = get('META-INF/container.xml');
  if (!container) throw new Error('Это не книга EPUB (нет META-INF/container.xml)');
  const opfPath = all(parseXml(strFromU8(container), 'EPUB'), 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath || !get(opfPath)) throw new Error('EPUB повреждён: не найдено описание книги');
  const opf = parseXml(strFromU8(get(opfPath)), 'EPUB');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const resolve = (from, rel) => {
    const parts = (from + rel.split('#')[0]).split('/');
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
  };
  const manifest = new Map();
  for (const it of all(opf, 'item')) manifest.set(it.getAttribute('id'), { href: resolve(base, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });

  // Картинки
  const images = new Map();
  const imageByPath = new Map();
  let n = 0;
  for (const [, it] of manifest) {
    if (!it.type.startsWith('image/') || !get(it.href)) continue;
    const id = `i${++n}`;
    images.set(id, { mime: it.type, data: get(it.href) });
    imageByPath.set(it.href, id);
  }
  const metaCover = all(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = [...manifest.values()].find((it) => it.props.includes('cover-image')) || manifest.get(metaCover);
  const cover = coverItem ? imageByPath.get(coverItem.href) || null : null;

  // Главы — по порядку чтения (spine)
  const chapters = [];
  for (const ref of all(opf, 'itemref')) {
    const it = manifest.get(ref.getAttribute('idref'));
    if (!it || !get(it.href) || !/html|xml/.test(it.type)) continue;
    const src = strFromU8(get(it.href));
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(src, 'text/html');
    const body = doc.body || all(doc, 'body')[0];
    if (!body) continue;
    const dir = it.href.includes('/') ? it.href.slice(0, it.href.lastIndexOf('/') + 1) : '';
    for (const img of [...all(body, 'img'), ...all(body, 'image')]) {
      const p = resolve(dir, img.getAttribute('src') || href(img));
      const id = imageByPath.get(p);
      const repl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img');
      if (id) repl.setAttribute('src', `img:${id}`);
      repl.setAttribute('alt', img.getAttribute('alt') || '');
      (img.localName === 'image' ? img.closest('svg') || img : img).replaceWith(repl);
    }
    const html = new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>|<\/body>$/g, '');
    // Пустые страницы и страница-обложка (только картинка обложки) — не главы
    if (!text(body)) {
      const ids = [...html.matchAll(/src="img:([^"]+)"/g)].map((m) => m[1]);
      if (!ids.length || ids.every((id) => id === cover)) continue;
    }
    const t = text(all(body, 'h1')[0] || all(body, 'h2')[0] || all(body, 'h3')[0]) || all(doc, 'title')[0]?.textContent?.trim() || `Глава ${chapters.length + 1}`;
    chapters.push({ title: t, html });
  }
  if (!chapters.length) throw new Error('В EPUB нет текста');
  const dc = (name) => text(all(opf, name)[0]);
  return { title: dc('title') || 'Без названия', author: all(opf, 'creator').map(text).filter(Boolean).join(', '), lang: dc('language') || 'ru', chapters, images, cover };
}

/**
 * Документ (очищенный HTML из DOCX / Markdown / HTML / TXT) → книга для EPUB или FB2.
 * Главы делятся по заголовкам первого уровня (h1, а если их нет — h2); картинки из data:-адресов переносятся в книгу.
 */
export async function htmlToBookFile(html, fallbackTitle, to, lang = 'ru') {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const images = new Map();
  let n = 0;
  for (const img of [...doc.images]) {
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(img.getAttribute('src') || '');
    if (m && m[1] !== 'image/svg+xml') {
      const id = `i${++n}`;
      images.set(id, { mime: m[1], data: b64ToBytes(m[2]) });
      img.setAttribute('src', `img:${id}`);
    } else img.remove();
  }
  const level = doc.body.querySelector('h1') ? 'H1' : doc.body.querySelector('h2') ? 'H2' : null;
  const title = text(doc.body.querySelector('h1')) || fallbackTitle;
  const chapters = [];
  let cur = { title, html: '' };
  for (const node of [...doc.body.childNodes]) {
    if (level && node.nodeType === Node.ELEMENT_NODE && node.tagName === level) {
      if (cur.html.replace(/<[^>]+>/g, '').trim() || /<img/.test(cur.html)) chapters.push(cur);
      cur = { title: text(node) || `Глава ${chapters.length + 1}`, html: '' };
    }
    cur.html += node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : node.nodeType === Node.TEXT_NODE ? escapeHtml(node.data) : '';
  }
  if (cur.html.trim() || !chapters.length) chapters.push(cur);
  const book = { title, author: '', lang, chapters, images, cover: null };
  const blob = to === 'fb2' ? await writeFb2(book) : await writeEpub(book);
  return { blob, chapters: chapters.length };
}

export async function readBook(file, from) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return from === 'epub' ? readEpub(bytes) : readFb2(bytes);
}

/** Безопасный HTML всей книги с картинками внутри (для предпросмотра, PDF, DOCX, HTML, TXT). */
export async function bookToHtml(book, { images = true } = {}) {
  const parts = [`<h1>${escapeHtml(book.title)}</h1>`];
  if (book.author) parts.push(`<p><em>${escapeHtml(book.author)}</em></p>`);
  if (images && book.cover && book.images.has(book.cover)) parts.push(`<p><img src="img:${book.cover}" alt="Обложка"></p>`);
  for (const ch of book.chapters) parts.push(`<section>${ch.html}</section>`);
  let html = parts.join('\n').replace(/src="img:([^"]+)"/g, (m, id) => {
    const img = book.images.get(id);
    return images && img && img.mime !== 'image/svg+xml' ? `src="${dataUrl(img)}"` : 'src=""';
  });
  html = html.replace(/<img src=""[^>]*>/g, '');
  return sanitizeHtml(html);
}

// ---------- Запись EPUB 3 ----------
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML-фрагмент → корректный XHTML (EPUB требует строгий XML). */
async function toXhtml(html) {
  const safe = await sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${safe}</body></html>`, 'text/html');
  return [...doc.body.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join('\n')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

const EPUB_CSS = `body{font-family:serif;line-height:1.5;margin:0 4%}h1,h2,h3,h4{font-family:sans-serif;line-height:1.25;page-break-after:avoid}
p{margin:0;text-indent:1.5em}p.empty{text-indent:0}blockquote{margin:1em 2em;font-style:italic}.epigraph{margin-left:30%}
.author{text-align:right;font-style:italic}.verse{text-indent:0;margin-left:2em}img{max-width:100%}.cover{text-align:center;margin:0}.cover img{max-height:100%}`;

async function writeEpub(book) {
  const { zipSync, strToU8 } = await fflate();
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const files = {};
  const imgName = (id) => `images/${id.replace(/[^\w.-]/g, '_')}.${IMG_EXT[book.images.get(id).mime] || 'bin'}`;
  const page = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(book.lang)}" lang="${esc(book.lang)}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
  const chapters = [];
  for (const [i, ch] of book.chapters.entries()) {
    // Метка картинки имеет вид data-адреса — иначе очистка HTML убрала бы её как внешнюю ссылку
    const body = (await toXhtml(ch.html.replace(/src="img:([^"]+)"/g, (m, id) => (book.images.has(id) ? `src="data:image/png;base64,IMG${bytesToB64(new TextEncoder().encode(id))}"` : 'src=""'))))
      .replace(/src="data:image\/png;base64,IMG([^"]+)"/g, (m, b) => `src="${imgName(new TextDecoder().decode(b64ToBytes(b)))}"`);
    const name = `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
    files[`OEBPS/${name}`] = strToU8(page(ch.title, body));
    chapters.push({ name, title: ch.title });
  }
  for (const id of book.images.keys()) files[`OEBPS/${imgName(id)}`] = [book.images.get(id).data, { level: 0 }];
  const hasCover = book.cover && book.images.has(book.cover);
  if (hasCover) files['OEBPS/cover.xhtml'] = strToU8(page('Обложка', `<div class="cover"><img src="${imgName(book.cover)}" alt="Обложка"/></div>`));
  files['OEBPS/style.css'] = strToU8(EPUB_CSS);
  files['OEBPS/nav.xhtml'] = strToU8(page('Содержание', `<nav epub:type="toc" id="toc"><h1>Содержание</h1><ol>\n${chapters.map((c) => `<li><a href="${c.name}">${esc(c.title)}</a></li>`).join('\n')}\n</ol></nav>`));
  // toc.ncx — оглавление для старых читалок (EPUB 2)
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${esc(book.title)}</text></docTitle><navMap>
${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.name}"/></navPoint>`).join('\n')}
</navMap></ncx>`);
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    hasCover ? '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>' : '',
    ...chapters.map((c, i) => `<item id="c${i + 1}" href="${c.name}" media-type="application/xhtml+xml"/>`),
    ...[...book.images.keys()].map((id, i) => `<item id="img${i + 1}" href="${imgName(id)}" media-type="${book.images.get(id).mime}"${id === book.cover ? ' properties="cover-image"' : ''}/>`),
  ].filter(Boolean);
  const coverIdx = [...book.images.keys()].indexOf(book.cover) + 1;
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ''}
<dc:language>${esc(book.lang)}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
${hasCover ? `<meta name="cover" content="img${coverIdx}"/>` : ''}
</metadata>
<manifest>
${items.join('\n')}
</manifest>
<spine toc="ncx">
${hasCover ? '<itemref idref="cover-page"/>' : ''}
${chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('\n')}
</spine>
</package>`);
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  // mimetype — первым и без сжатия, этого требует стандарт EPUB
  const ordered = { mimetype: [strToU8('application/epub+zip'), { level: 0 }], ...files };
  return new Blob([zipSync(ordered)], { type: 'application/epub+zip' });
}

// ---------- Запись FB2 ----------
const FB_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XL_NS = 'http://www.w3.org/1999/xlink';

async function writeFb2(book) {
  const doc = document.implementation.createDocument(FB_NS, 'FictionBook', null);
  const root = doc.documentElement;
  root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:l', XL_NS);
  const el = (name, parent, txt) => {
    const e = doc.createElementNS(FB_NS, name);
    if (txt != null) e.textContent = txt;
    parent?.append(e);
    return e;
  };
  const desc = el('description', root);
  const ti = el('title-info', desc);
  el('genre', ti, 'prose');
  for (const a of (book.author || 'Неизвестный автор').split(/,\s*/)) {
    const author = el('author', ti);
    const parts = a.trim().split(/\s+/);
    if (parts.length > 1) {
      el('first-name', author, parts.slice(0, -1).join(' '));
      el('last-name', author, parts[parts.length - 1]);
    } else el('nickname', author, parts[0]);
  }
  el('book-title', ti, book.title);
  el('lang', ti, book.lang.slice(0, 2));
  const usedImages = new Set();
  if (book.cover && book.images.has(book.cover)) {
    const img = el('image', el('coverpage', ti));
    img.setAttributeNS(XL_NS, 'l:href', `#${book.cover}`);
    usedImages.add(book.cover);
  }
  const di = el('document-info', desc);
  el('author', di).append(el('nickname', null, 'Конвертилка'));
  el('date', di, new Date().toISOString().slice(0, 10));
  el('id', di, crypto.randomUUID());
  el('version', di, '1.0');

  const body = el('body', root);
  // HTML главы → элементы FB2
  const inline = (src, dst) => {
    for (const n of src.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) dst.append(doc.createTextNode(n.data.replace(/\s+/g, ' ')));
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName;
        if (/^(EM|I|CITE)$/.test(tag)) inline(n, el('emphasis', dst));
        else if (/^(STRONG|B)$/.test(tag)) inline(n, el('strong', dst));
        else if (/^(SUB|SUP)$/.test(tag)) inline(n, el(tag.toLowerCase(), dst));
        else if (tag === 'BR') dst.append(doc.createTextNode(' '));
        else inline(n, dst);
      }
    }
  };
  const block = (src, section) => {
    for (const n of src.children) {
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) inline(n, el('subtitle', section));
      else if (tag === 'IMG') {
        const m = /^img:(.+)$/.exec(n.getAttribute('src') || '');
        if (m && book.images.has(m[1])) {
          el('image', section).setAttributeNS(XL_NS, 'l:href', `#${m[1]}`);
          usedImages.add(m[1]);
        }
      } else if (tag === 'BLOCKQUOTE') {
        const cite = el('cite', section);
        if (n.querySelector('p, div')) block(n, cite);
        else inline(n, el('p', cite));
      } else if (/^(UL|OL)$/.test(tag)) {
        for (const li of n.children) {
          const p = el('p', section, '• ');
          inline(li, p);
        }
      } else if (tag === 'P' || tag === 'LI' || tag === 'DT' || tag === 'DD') {
        if (!n.textContent.trim() && !n.querySelector('img')) el('empty-line', section);
        else {
          const img = n.querySelector('img');
          if (img && !n.textContent.trim()) block({ children: [img] }, section);
          else inline(n, el('p', section));
        }
      } else if (n.children.length) block(n, section);
      else if (n.textContent.trim()) inline(n, el('p', section));
    }
  };
  for (const ch of book.chapters) {
    const section = el('section', body);
    el('p', el('title', section), ch.title);
    const html = new DOMParser().parseFromString(`<body>${ch.html}</body>`, 'text/html').body;
    // Первый заголовок главы уже стал <title> — не повторяем
    const first = html.querySelector('h1, h2, h3');
    if (first && first.textContent.trim() === ch.title.trim()) first.remove();
    block(html, section);
    if (!section.children.length || section.children.length === 1) el('empty-line', section);
  }
  for (const id of usedImages) {
    const img = book.images.get(id);
    if (!img || img.mime === 'image/svg+xml') continue;
    const bin = el('binary', root, bytesToB64(img.data));
    bin.setAttribute('id', id);
    bin.setAttribute('content-type', img.mime);
  }
  const xmlText = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc)}`;
  return new Blob([xmlText], { type: 'application/x-fictionbook+xml' });
}

// ---------- Конвертация ----------
export async function convert(file, from, to, opts = {}, onProgress) {
  const book = await readBook(file, from);
  onProgress?.(0.3);
  const name = `${baseName(file.name.replace(/\.zip$/i, ''))}.${to}`;
  const note = `${book.chapters.length} глав, картинок: ${book.images.size}`;
  switch (to) {
    case 'epub': return [{ blob: await writeEpub(book), name, note }];
    case 'fb2': return [{ blob: await writeFb2(book), name, note }];
    case 'html': return [{ blob: new Blob([wrapHtmlDocument(book.title, await bookToHtml(book))], { type: 'text/html;charset=utf-8' }), name }];
    case 'txt': {
      const { htmlToText } = await import('./document.js');
      return [{ blob: new Blob(['﻿' + htmlToText(await bookToHtml(book, { images: false }))], { type: 'text/plain;charset=utf-8' }), name }];
    }
    case 'pdf': {
      const { htmlToPdf } = await import('./document.js');
      return [{ blob: await htmlToPdf(await bookToHtml(book), book.title), name, note }];
    }
    case 'docx': {
      const { buildDocx, htmlToBlocks } = await import('./docxwriter.js');
      return [{ blob: await buildDocx(htmlToBlocks(await bookToHtml(book, { images: false })), { title: book.title }), name, note: 'перенесён текст и оформление; картинки не переносятся' }];
    }
    default:
      throw new Error(`Неподдерживаемый формат: ${to}`);
  }
}
