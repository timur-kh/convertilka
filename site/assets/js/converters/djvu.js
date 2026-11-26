// DjVu (сканы книг и документов) → PDF / JPG / PNG / TXT. Расшифровка — в отдельном потоке (workers/djvu-worker.js).
import { loadScript, canvasToBlob, baseName, nextFrame } from '../util.js';

/** Открывает DjVu в своём потоке. Возвращает { pages, sizes, page(n, {text}), text(n), close() }. */
export async function openDjvu(file) {
  const worker = new Worker(new URL('../workers/djvu-worker.js', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) p?.resolve(data);
    else p?.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`Модуль DjVu не загрузился: ${e.message || ''}`));
    pending.clear();
  };
  const call = (msg, transfer = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
  const buffer = await file.arrayBuffer();
  let info;
  try {
    info = await call({ cmd: 'open', buffer }, [buffer]);
  } catch (e) {
    worker.terminate();
    throw e;
  }
  return {
    pages: info.pages,
    sizes: info.sizes,
    /** Страница → canvas (+ dpi, text). maxDpi — уменьшить, если скан слишком подробный. */
    async page(n, { text = false, maxDpi = 0 } = {}) {
      const r = await call({ cmd: 'page', n, text });
      let canvas = document.createElement('canvas');
      canvas.width = r.width;
      canvas.height = r.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      let dpi = r.dpi || 300;
      if (maxDpi && dpi > maxDpi) {
        const k = maxDpi / dpi;
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(r.width * k));
        small.height = Math.max(1, Math.round(r.height * k));
        const ctx = small.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, small.width, small.height);
        canvas.width = canvas.height = 0;
        canvas = small;
        dpi = maxDpi;
      }
      return { canvas, dpi, text: r.text };
    },
    async text(n) {
      return (await call({ cmd: 'text', n })).text;
    },
    close() {
      worker.terminate();
    },
  };
}

/** Чёрно-белый или серый скан? Тогда PNG (чёткий текст, маленький файл), иначе JPEG. */
function isGray(canvas) {
  const { width: w, height: h } = canvas;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (Math.abs(px[i] - px[i + 1]) > 12 || Math.abs(px[i + 1] - px[i + 2]) > 12) return false;
    }
  }
  return true;
}

export async function convert(file, from, to, opts = {}, onProgress) {
  const book = await openDjvu(file);
  const base = baseName(file.name);
  const pad = String(book.pages).length;
  try {
    if (to === 'txt') {
      const parts = [];
      for (let n = 1; n <= book.pages; n++) {
        parts.push((await book.text(n)).trim());
        onProgress?.(n / book.pages);
      }
      const text = parts.join('\n\n\f\n\n');
      if (!text.replace(/\f/g, '').trim()) throw new Error('В этом DjVu нет текстового слоя — только изображения страниц. Распознавание текста пока не поддерживается.');
      return [{ blob: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name: `${base}.txt` }];
    }
    if (to === 'pdf') {
      // Страницы — картинками в исходном размере (по dpi скана); серые сканы — PNG, цветные — JPEG
      const PDFLib = await loadScript('pdf-lib/pdf-lib.min.js', 'PDFLib');
      const pdf = await PDFLib.PDFDocument.create();
      const maxDpi = Math.max(150, Math.min(opts.dpi || 300, 300));
      for (let n = 1; n <= book.pages; n++) {
        const { canvas, dpi } = await book.page(n, { maxDpi });
        const gray = isGray(canvas);
        const blob = await canvasToBlob(canvas, gray ? 'image/png' : 'image/jpeg', gray ? undefined : (opts.quality ?? 0.85));
        const bytes = await blob.arrayBuffer();
        const img = gray ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const w = (canvas.width / dpi) * 72, h = (canvas.height / dpi) * 72; // размер страницы — как у бумажного оригинала
        pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
        canvas.width = canvas.height = 0;
        onProgress?.(n / book.pages);
        await nextFrame();
      }
      return [{ blob: new Blob([await pdf.save()], { type: 'application/pdf' }), name: `${base}.pdf`, note: `${book.pages} стр.; страницы — изображения, как в DjVu` }];
    }
    // Картинки по страницам
    const mime = to === 'png' ? 'image/png' : 'image/jpeg';
    const outputs = [];
    for (let n = 1; n <= book.pages; n++) {
      const { canvas } = await book.page(n, { maxDpi: opts.dpi && opts.dpi < 300 ? opts.dpi : 0 });
      const blob = await canvasToBlob(canvas, mime, opts.quality ?? 0.9);
      const size = `${canvas.width}×${canvas.height}`;
      canvas.width = canvas.height = 0;
      outputs.push({ blob, name: `${base}${book.pages > 1 ? `-${String(n).padStart(pad, '0')}` : ''}.${to}`, note: size });
      onProgress?.(n / book.pages);
      await nextFrame();
    }
    return outputs;
  } finally {
    book.close();
  }
}
