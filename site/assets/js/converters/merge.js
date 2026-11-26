// Объединение PDF-файлов и изображений в один PDF (pdf-lib). Порядок — как в списке файлов.
import { loadScript, canvasToBlob } from '../util.js';
import { FORMATS } from '../formats.js';

const LONG_SIDE_PT = 842; // картинка-страница: длинная сторона как у A4

/** parts: [{ file, format }] → Blob PDF. onProgress(0..1) */
export async function mergeToPdf(parts, onProgress) {
  const PDFLib = await loadScript('pdf-lib/pdf-lib.min.js', 'PDFLib');
  const out = await PDFLib.PDFDocument.create();
  let n = 0;
  for (const { file, format } of parts) {
    if (format === 'pdf') {
      let src;
      try {
        src = await PDFLib.PDFDocument.load(await file.arrayBuffer());
      } catch (e) {
        throw new Error(/encrypt/i.test(e.message) ? `«${file.name}» защищён паролем — такие PDF объединить нельзя` : `«${file.name}» повреждён или это не PDF`);
      }
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    } else if (FORMATS[format]?.module === 'image') {
      // JPEG и PNG встраиваются как есть; остальные форматы — через перекодирование в JPEG
      let img;
      if (format === 'jpg') img = await out.embedJpg(await file.arrayBuffer());
      else if (format === 'png') img = await out.embedPng(await file.arrayBuffer());
      else {
        const { decodeImage, drawToCanvas } = await import('./image.js');
        const canvas = drawToCanvas(await decodeImage(file, format), { background: '#ffffff' });
        img = await out.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
      }
      const k = LONG_SIDE_PT / Math.max(img.width, img.height);
      const page = out.addPage([img.width * k, img.height * k]);
      page.drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
    }
    onProgress?.(++n / parts.length);
  }
  if (!out.getPageCount()) throw new Error('Нечего объединять');
  return new Blob([await out.save()], { type: 'application/pdf' });
}
