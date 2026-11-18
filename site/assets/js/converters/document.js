// Документы: DOCX / Markdown / HTML / TXT → PDF / HTML / Markdown / TXT.
import { loadScript, vendorUrl, readText, baseName, escapeHtml } from '../util.js';
import { sanitizeHtml, wrapHtmlDocument } from '../sanitize.js';

const getMammoth = () => loadScript('mammoth/mammoth.browser.min.js', 'mammoth');
let markedLib, turndownLib;
async function getMarked() {
  markedLib ||= (await import(vendorUrl('marked/marked.esm.js'))).marked;
  return markedLib;
}
async function getTurndown() {
  if (!turndownLib) {
    const TurndownService = (await import(vendorUrl('turndown/turndown.browser.es.js'))).default;
    turndownLib = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  }
  return turndownLib;
}
async function getPdfMake() {
  const pdfMake = await loadScript('pdfmake/pdfmake.min.js', 'pdfMake');
  await loadScript('pdfmake/vfs_fonts.js'); // шрифт Roboto с кириллицей
  return pdfMake;
}
const getHtmlToPdfmake = () => loadScript('html-to-pdfmake/browser.js', 'htmlToPdfmake');

/** Любой входной документ → очищенный HTML (фрагмент body). */
export async function toSafeHtml(file, from) {
  switch (from) {
    case 'docx': {
      const mammoth = await getMammoth();
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      return sanitizeHtml(value);
    }
    case 'md': {
      const marked = await getMarked();
      return sanitizeHtml(marked.parse(await readText(file), { gfm: true }));
    }
    case 'html':
      return sanitizeHtml(await readText(file));
    case 'txt':
      return textToHtml(await readText(file));
    default:
      throw new Error(`Не умею читать ${from}`);
  }
}

function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'HR']);

/** HTML → обычный текст с сохранением абзацев, списков и строк таблиц. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.parentElement?.closest('pre') ? n.data : n.data.replace(/\s+/g, ' ');
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName;
        if (tag === 'BR') { out += '\n'; continue; }
        if (tag === 'LI') out += n.parentElement?.tagName === 'OL' ? `${[...n.parentElement.children].indexOf(n) + 1}. ` : '• ';
        walk(n);
        if (tag === 'TD' || tag === 'TH') out += '\t';
        if (BLOCK.has(tag)) out += '\n';
        if (/^(P|H\d|BLOCKQUOTE|PRE|TABLE)$/.test(tag)) out += '\n';
      }
    }
  };
  walk(doc.body);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const PDF_CONTENT_WIDTH = 515; // A4 (595pt) минус поля по 40pt

/** Готовит картинки к pdfmake: только PNG/JPEG и ширина не больше страницы. */
async function prepareImagesForPdf(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const img of [...doc.images]) {
    const src = img.getAttribute('src') || '';
    if (!/^data:image\/(png|jpe?g);base64,/i.test(src)) {
      img.remove();
      continue;
    }
    const size = await new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = src;
    });
    if (!size || !size.w) {
      img.remove();
      continue;
    }
    const w = Math.min(size.w * 0.75, PDF_CONTENT_WIDTH); // px → pt
    img.setAttribute('width', String(Math.round(w)));
    img.removeAttribute('height');
  }
  return doc.body.innerHTML;
}

async function htmlToPdf(html, title) {
  const [pdfMake, htmlToPdfmake] = await Promise.all([getPdfMake(), getHtmlToPdfmake()]);
  const content = htmlToPdfmake(await prepareImagesForPdf(html), {
    window,
    defaultStyles: { h1: { fontSize: 22, bold: true, marginBottom: 8 }, a: { color: '#1a56db', decoration: 'underline' } },
  });
  return makePdf(pdfMake, { content, info: { title } });
}

async function textToPdf(text, title) {
  const pdfMake = await getPdfMake();
  return makePdf(pdfMake, { content: [{ text: text.replace(/\r\n?/g, '\n'), preserveLeadingSpaces: true }], info: { title } });
}

function makePdf(pdfMake, def) {
  const docDef = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25 },
    ...def,
  };
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDef).getBlob((blob) => resolve(blob));
    } catch (e) {
      reject(e);
    }
  });
}

export async function convert(file, from, to) {
  const base = baseName(file.name);
  const name = `${base}.${to}`;
  const text = (s) => new Blob(['﻿' + s], { type: 'text/plain;charset=utf-8' });

  if (from === 'txt' && to === 'pdf') return [{ blob: await textToPdf(await readText(file), base), name }];
  if (from === 'docx' && to === 'txt') {
    const mammoth = await getMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return [{ blob: text(value.replace(/\n{3,}/g, '\n\n')), name }];
  }

  const html = await toSafeHtml(file, from);
  switch (to) {
    case 'html':
      return [{ blob: new Blob([wrapHtmlDocument(base, html)], { type: 'text/html;charset=utf-8' }), name }];
    case 'md': {
      const td = await getTurndown();
      return [{ blob: new Blob([td.turndown(html)], { type: 'text/markdown;charset=utf-8' }), name }];
    }
    case 'txt':
      return [{ blob: text(htmlToText(html)), name }];
    case 'pdf':
      return [{ blob: await htmlToPdf(html, base), name }];
    default:
      throw new Error(`Неподдерживаемый формат: ${to}`);
  }
}
