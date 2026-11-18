// PDF → изображения / текст (pdf.js). Также используется для предпросмотра PDF.
import { vendorUrl, canvasToBlob, baseName, nextFrame } from '../util.js';

let pdfjsPromise;
export function getPdfjs() {
  pdfjsPromise ||= import(vendorUrl('pdfjs/pdf.min.mjs')).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
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

export async function renderPage(doc, pageNo, scale) {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
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

/** opts.dpi — разрешение картинок (по умолчанию 150). onProgress(0..1) */
export async function convert(file, from, to, opts = {}, onProgress) {
  const doc = await openPdf(file);
  const base = baseName(file.name);
  try {
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
      canvas.width = canvas.height = 0; // освобождаем память
      const suffix = doc.numPages > 1 ? `-${String(i).padStart(pad, '0')}` : '';
      outputs.push({ blob, name: `${base}${suffix}.${to}` });
      onProgress?.(i / doc.numPages);
      await nextFrame();
    }
    return outputs;
  } finally {
    doc.destroy();
  }
}
