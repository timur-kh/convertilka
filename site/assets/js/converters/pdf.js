// PDF → изображения / текст (pdf.js). Также используется для предпросмотра PDF.
import { vendorUrl, canvasToBlob, baseName, nextFrame } from '../util.js';

let pdfjsPromise;
export function getPdfjs() {
  if (!pdfjsPromise) {
    // Рабочий поток pdf.js (самый большой файл) качаем параллельно с библиотекой, а не после неё:
    // ответ попадёт в кэш, и Worker запустится без второго ожидания сети
    fetch(vendorUrl('pdfjs/pdf.worker.min.js')).catch(() => {});
  }
  pdfjsPromise ||= import(vendorUrl('pdfjs/pdf.min.js')).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.js');
    return lib;
  });
  return pdfjsPromise;
}

export async function openPdf(blob) {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false, // никакого eval, совместимо со строгим CSP
    enableXfa: false,
    cMapUrl: vendorUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
  }).promise;
}

// Предел холста: Safari не рисует больше ~16,7 Мп, остальные браузеры — сторону больше 16 384 px.
// Страница A4 при 600 dpi — 4960×7016 (~35 Мп) — укладывается в Chrome/Firefox/Edge.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_PIXELS = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ? 16_700_000 : 100_000_000;

/** Рисует страницу; если она не помещается в предел холста — уменьшает масштаб (возвращает canvas.downscaled = true). */
export async function renderPage(doc, pageNo, scale) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const maxScale = Math.min(MAX_CANVAS_SIDE / base.width, MAX_CANVAS_SIDE / base.height, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
  const downscaled = scale > maxScale;
  if (downscaled) scale = maxScale;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  canvas.downscaled = downscaled;
  return canvas;
}

/** Страница в canvas заданной ширины в пикселях (для предпросмотра). */
export async function getPageCanvas(doc, pageNo, pxWidth) {
  const page = await doc.getPage(pageNo);
  const scale = pxWidth / page.getViewport({ scale: 1 }).width;
  return renderPage(doc, pageNo, Math.max(0.2, Math.min(scale, 4)));
}

/** Текст страницы с переносами строк там, где меняется вертикальная позиция. */
async function pageText(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const { items } = await page.getTextContent();
  let out = '';
  let lastY = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
    out += it.str;
    if (it.hasEOL) out += '\n';
    lastY = y;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- PDF → Word: восстановление строк и абзацев из позиций текста ----------

/** Строки страницы: [{ y, x, right, size, runs: [{text, bold, italic}] }] сверху вниз. */
async function pageLines(page) {
  await page.getOperatorList(); // подгружает шрифты — по ним узнаём жирный и курсив
  const { items } = await page.getTextContent();
  const fontStyle = new Map();
  const styleOf = (id) => {
    if (!fontStyle.has(id)) {
      let st = { bold: false, italic: false };
      try {
        const f = page.commonObjs.get(id);
        const name = f?.name || '';
        st = { bold: !!f?.bold || /bold|black|heavy|semibold|demi|medium/i.test(name), italic: !!f?.italic || /italic|oblique/i.test(name) };
      } catch { /* шрифт не загружен — считаем обычным */ }
      fontStyle.set(id, st);
    }
    return fontStyle.get(id);
  };
  const glyphs = items
    .filter((it) => 'str' in it && it.str !== '')
    .map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
      ...styleOf(it.fontName),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const g of glyphs) {
    let line = lines.find((l) => Math.abs(l.y - g.y) < Math.max(l.size, g.size) * 0.45);
    if (!line) {
      line = { y: g.y, size: g.size, parts: [] };
      lines.push(line);
    }
    line.parts.push(g);
    line.size = Math.max(line.size, g.size);
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.x = l.parts[0].x;
    const last = l.parts[l.parts.length - 1];
    l.right = last.x + last.w;
    l.runs = [];
    let prevEnd = null;
    for (const p of l.parts) {
      let text = p.text;
      // Пробел между кусками, если между ними видимый промежуток
      if (prevEnd !== null && p.x - prevEnd > p.size * 0.2 && !/\s$/.test(l.runs[l.runs.length - 1]?.text || '') && !/^\s/.test(text)) text = ' ' + text;
      const lr = l.runs[l.runs.length - 1];
      if (lr && lr.bold === p.bold && lr.italic === p.italic) lr.text += text;
      else l.runs.push({ text, bold: p.bold, italic: p.italic });
      prevEnd = p.x + p.w;
    }
    l.text = l.runs.map((r) => r.text).join('');
  }
  return lines.filter((l) => l.text.trim()).sort((a, b) => b.y - a.y);
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const BULLET = /^\s*([•●▪◦‣∙·–—\-*]|\d{1,3}[.)])\s+/;

/** Все страницы → блоки для DOCX. */
async function pdfToBlocks(doc, onProgress) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [, , , pageTop] = page.view;
    const lines = await pageLines(page);
    // Номера страниц у верхнего и нижнего края не нужны в документе
    pages.push(lines.filter((l) => !(/^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$/.test(l.text) && (l.y < pageTop * 0.08 || l.y > pageTop * 0.92))));
    page.cleanup();
    onProgress?.((i / doc.numPages) * 0.9);
  }
  const all = pages.flat();
  if (!all.length) throw new Error('В PDF нет текстового слоя (скорее всего, это скан). Распознавание текста пока не поддерживается.');
  // Основной размер шрифта и межстрочный интервал документа
  const body = median(all.flatMap((l) => Array(Math.min(l.text.length, 200)).fill(Math.round(l.size * 10) / 10)));
  const gaps = [];
  for (const lines of pages) for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    if (d > 0 && Math.abs(lines[i].size - body) < body * 0.15) gaps.push(d);
  }
  const lineGap = median(gaps) || body * 1.2;
  const left = median(all.map((l) => Math.round(l.x)));
  // Правый край полных строк: 90-й перцентиль (медиана занижена, если коротких строк много)
  const rights = all.map((l) => l.right).sort((x, y) => x - y);
  const right = rights[Math.floor(rights.length * 0.9)] || rights[rights.length - 1];

  const blocks = [];
  pages.forEach((lines, pi) => {
    if (pi > 0 && blocks.length) blocks.push({ type: 'pagebreak' });
    let cur = null;
    let prev = null;
    for (const l of lines) {
      const kind = l.size >= body * 1.45 ? 'h1' : l.size >= body * 1.18 ? 'h2' : BULLET.test(l.text) ? 'li' : 'p';
      const gap = prev ? prev.y - l.y : 0;
      const closeGap = gap <= lineGap * 1.45;
      // Абзац закончился: строка с точкой не дотянута до правого края, или строка совсем короткая
      // (пункты списка с нарисованными маркерами, подписи) — такие строки не склеиваем
      const prevEnded = prev && ((/[.!?:;»"]\s*$/.test(prev.text) && prev.right < right - body * 2) || prev.right < left + (right - left) * 0.45);
      const redLine = l.x > left + body * 1.2 && /[.!?:]\s*$/.test(prev?.text || ''); // абзацный отступ
      // Строку можно приклеить к текущему абзацу или пункту списка (перенос длинной строки)
      const continues = cur && kind === 'p' && closeGap && !prevEnded && !redLine
        && (cur.type === 'p' || (cur.type === 'li' && l.x > left + body * 0.5));
      const runs = l.runs.map((r) => ({ ...r }));
      if (kind === 'li') runs[0].text = runs[0].text.replace(BULLET, '');
      if (!continues) {
        // Короткая полностью жирная строка обычного размера — подзаголовок
        const type = kind === 'p' && l.runs.every((r) => r.bold) && l.text.length < 90 && !closeGap ? 'h3' : kind;
        cur = { type, runs };
        blocks.push(cur);
      } else {
        // Продолжение абзаца: склеиваем перенос «сло-\nво», иначе через пробел
        const lr = cur.runs[cur.runs.length - 1];
        if (/[a-zа-яё]-$/i.test(lr.text) && /^[a-zа-яё]/.test(runs[0].text)) lr.text = lr.text.slice(0, -1);
        else if (!/\s$/.test(lr.text)) runs[0].text = ' ' + runs[0].text.replace(/^\s+/, '');
        for (const r of runs) {
          const last = cur.runs[cur.runs.length - 1];
          if (last.bold === r.bold && last.italic === r.italic) last.text += r.text;
          else cur.runs.push(r);
        }
      }
      prev = l;
      if (cur.type !== 'p' && cur.type !== 'li') cur = null; // заголовок — отдельный блок, к нему не приклеиваем
    }
  });
  return blocks;
}

/** opts.dpi — разрешение картинок (по умолчанию 150). onProgress(0..1) */
export async function convert(file, from, to, opts = {}, onProgress) {
  const doc = await openPdf(file);
  const base = baseName(file.name);
  try {
    if (to === 'docx') {
      const blocks = await pdfToBlocks(doc, onProgress);
      const { buildDocx } = await import('./docxwriter.js');
      const blob = await buildDocx(blocks, { title: base });
      return [{ blob, name: `${base}.docx`, note: 'перенесён текст с заголовками и списками; картинки и сложная вёрстка не переносятся' }];
    }
    if (to === 'pdf') return [await compressPdf(doc, file, base, opts, onProgress)];
    if (to === 'txt') {
      const parts = [];
      for (let i = 1; i <= doc.numPages; i++) {
        parts.push(await pageText(doc, i));
        onProgress?.(i / doc.numPages);
      }
      const text = parts.join('\n\n\f\n\n'); // \f — разрыв страницы
      if (!text.replace(/\f/g, '').trim()) {
        throw new Error('В PDF нет текстового слоя (скорее всего, это скан). Распознавание текста пока не поддерживается.');
      }
      return [{ blob: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name: `${base}.txt` }];
    }
    const mime = to === 'png' ? 'image/png' : 'image/jpeg';
    const scale = (opts.dpi || 150) / 72;
    const outputs = [];
    const pad = String(doc.numPages).length;
    for (let i = 1; i <= doc.numPages; i++) {
      const canvas = await renderPage(doc, i, scale);
      const blob = await canvasToBlob(canvas, mime, opts.quality ?? 0.9);
      const size = `${canvas.width}×${canvas.height}`;
      const note = canvas.downscaled ? `${size} — страница слишком большая для ${opts.dpi} dpi, разрешение снижено до предела браузера` : size;
      canvas.width = canvas.height = 0; // освобождаем память
      const suffix = doc.numPages > 1 ? `-${String(i).padStart(pad, '0')}` : '';
      outputs.push({ blob, name: `${base}${suffix}.${to}`, note });
      onProgress?.(i / doc.numPages);
      await nextFrame();
    }
    return outputs;
  } finally {
    doc.destroy();
  }
}

/**
 * Сжатие PDF перерисовкой страниц в JPEG. Сильно помогает для сканов и PDF с фотографиями;
 * текст при этом становится картинкой. Если файл не уменьшился — честно говорим об этом.
 */
async function compressPdf(doc, file, base, opts, onProgress) {
  const { buildImagesPdf } = await import('./pdfwriter.js');
  const dpi = Math.min(opts.dpi || 150, 150);
  const quality = Math.min(opts.quality ?? 0.75, 0.8);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = await renderPage(doc, i, dpi / 72);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
    pages.push({ width: canvas.width, height: canvas.height, jpeg: new Uint8Array(await jpeg.arrayBuffer()) });
    canvas.width = canvas.height = 0;
    onProgress?.(i / doc.numPages);
    await nextFrame();
  }
  const blob = buildImagesPdf(pages);
  if (blob.size >= file.size * 0.95) {
    throw new Error('Этот PDF уже компактный (в нём в основном текст) — сжатие сделало бы его больше..');
  }
  const pct = Math.round((1 - blob.size / file.size) * 100);
  return { blob, name: `${base}.pdf`, note: `меньше на ${pct}%; текст стал изображением — выделять и искать его нельзя` };
}
