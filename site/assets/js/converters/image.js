// Конвертация изображений: декодирование любых поддерживаемых форматов → Canvas → кодирование.
import { loadScript, canvasToBlob, baseName } from '../util.js';
import { FORMATS } from '../formats.js';
import { buildImagesPdf } from './pdfwriter.js';

const MAX_PIXELS = 100_000_000; // ~100 Мп: дальше браузеры часто падают по памяти

/** Декодирует файл в источник, пригодный для drawImage (ImageBitmap / HTMLImageElement / canvas). */
export async function decodeImage(file, format) {
  if (format === 'heic') {
    const heic2any = await loadScript('heic2any/heic2any.min.js', 'heic2any');
    let png = await heic2any({ blob: file, toType: 'image/png' });
    if (Array.isArray(png)) png = png[0]; // многокадровый HEIC — берём первый кадр
    return createImageBitmap(png);
  }
  if (format === 'tiff') return decodeTiff(file);
  if (format === 'svg') return decodeSvg(file);
  try {
    return await createImageBitmap(file);
  } catch {
    // ICO и некоторые экзотические варианты лучше открываются через <img>
    return loadViaImg(file);
  }
}

async function decodeTiff(file) {
  await loadScript('pako/pako.min.js', 'pako');
  const UTIF = await loadScript('utif/UTIF.js', 'UTIF');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  const page = ifds.find((i) => i.t256 && i.t257) || ifds[0];
  if (!page) throw new Error('В TIFF-файле нет изображений');
  UTIF.decodeImage(buf, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height), 0, 0);
  return canvas;
}

async function decodeSvg(file) {
  // SVG внутри <img> не может выполнять скрипты и грузить внешние ресурсы — это безопасно.
  const img = await loadViaImg(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    // SVG без размеров: задаём разумный размер по умолчанию
    img.width = 1024;
    img.height = 1024;
  }
  return img;
}

function loadViaImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Браузер не смог открыть это изображение'));
    };
    img.src = url;
  });
}

function sizeOf(src) {
  return {
    w: src.naturalWidth || src.width,
    h: src.naturalHeight || src.height,
  };
}

/** Рисует источник на canvas с учётом ограничения размера и фона (для форматов без прозрачности). */
export function drawToCanvas(src, { maxSide = 0, background = null } = {}) {
  let { w, h } = sizeOf(src);
  if (!w || !h) throw new Error('Не удалось определить размер изображения');
  if (maxSide > 0 && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  if (w * h > MAX_PIXELS) throw new Error(`Изображение слишком большое (${w}×${h}). Уменьшите размер в настройках.`);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

async function encodeNative(canvas, mime, quality) {
  const blob = await canvasToBlob(canvas, mime, quality);
  // Браузер молча отдаёт PNG, если не умеет нужный формат — проверяем.
  if (blob.type !== mime) throw new Error(`Ваш браузер не умеет сохранять в ${mime.split('/')[1].toUpperCase()}`);
  return blob;
}

/** BMP 32 бит (BGRA, с альфа-каналом через BITMAPV4HEADER) — открывается везде. */
function encodeBmp(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const headerSize = 14 + 108;
  const size = headerSize + w * h * 4;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint16(0, 0x4d42, true); // 'BM'
  v.setUint32(2, size, true);
  v.setUint32(10, headerSize, true);
  v.setUint32(14, 108, true); // BITMAPV4HEADER
  v.setInt32(18, w, true);
  v.setInt32(22, -h, true); // отрицательная высота = строки сверху вниз
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(30, 3, true); // BI_BITFIELDS
  v.setUint32(34, w * h * 4, true);
  v.setUint32(38, 2835, true); // 72 dpi
  v.setUint32(42, 2835, true);
  v.setUint32(54, 0x00ff0000, true); // маски R, G, B, A
  v.setUint32(58, 0x0000ff00, true);
  v.setUint32(62, 0x000000ff, true);
  v.setUint32(66, 0xff000000, true);
  v.setUint32(70, 0x73524742, true); // 'sRGB'
  const out = new Uint8Array(buf, headerSize);
  for (let i = 0; i < px.length; i += 4) {
    out[i] = px[i + 2];
    out[i + 1] = px[i + 1];
    out[i + 2] = px[i];
    out[i + 3] = px[i + 3];
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/** ICO с несколькими размерами (PNG внутри — поддерживается с Windows Vista). */
async function encodeIco(src) {
  const { w, h } = sizeOf(src);
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter((s) => s <= Math.max(w, h, 16));
  const images = [];
  for (const s of sizes) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const k = s / Math.max(w, h); // вписываем с сохранением пропорций
    const dw = w * k, dh = h * k;
    ctx.drawImage(src, (s - dw) / 2, (s - dh) / 2, dw, dh);
    images.push({ s, data: new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()) });
  }
  const head = 6 + 16 * images.length;
  const total = head + images.reduce((a, i) => a + i.data.length, 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint16(2, 1, true); // тип: иконка
  v.setUint16(4, images.length, true);
  let offset = head;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    buf[e] = img.s >= 256 ? 0 : img.s;
    buf[e + 1] = img.s >= 256 ? 0 : img.s;
    v.setUint16(e + 4, 1, true); // planes
    v.setUint16(e + 6, 32, true); // bpp
    v.setUint32(e + 8, img.data.length, true);
    v.setUint32(e + 12, offset, true);
    buf.set(img.data, offset);
    offset += img.data.length;
  });
  return new Blob([buf], { type: 'image/x-icon' });
}

async function encodeTiff(canvas) {
  await loadScript('pako/pako.min.js', 'pako');
  const UTIF = await loadScript('utif/UTIF.js', 'UTIF');
  const { width: w, height: h } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  return new Blob([UTIF.encodeImage(rgba, w, h)], { type: 'image/tiff' });
}

/**
 * Конвертирует одно изображение.
 * opts: { quality: 0..1, maxSide: px (0 = исходный), background: '#fff' для JPG }
 */
export async function convert(file, from, to, opts = {}) {
  const src = await decodeImage(file, from);
  const quality = opts.quality ?? 0.9;
  const maxSide = opts.maxSide || 0;
  const name = `${baseName(file.name)}.${to}`;
  let blob;
  switch (to) {
    case 'jpg':
      blob = await encodeNative(drawToCanvas(src, { maxSide, background: opts.background || '#ffffff' }), 'image/jpeg', quality);
      break;
    case 'png':
    case 'webp':
    case 'avif':
      blob = await encodeNative(drawToCanvas(src, { maxSide }), FORMATS[to].mime, to === 'png' ? undefined : quality);
      break;
    case 'bmp':
      blob = encodeBmp(drawToCanvas(src, { maxSide }));
      break;
    case 'ico':
      blob = await encodeIco(maxSide ? drawToCanvas(src, { maxSide }) : src);
      break;
    case 'tiff':
      blob = await encodeTiff(drawToCanvas(src, { maxSide }));
      break;
    case 'pdf':
      blob = await imagesToPdf([src], { quality, maxSide });
      break;
    default:
      throw new Error(`Неподдерживаемый формат: ${to}`);
  }
  src.close?.();
  return [{ blob, name }];
}

/** Несколько изображений → один PDF (страница под каждую картинку). */
export async function imagesToPdf(sources, { quality = 0.9, maxSide = 0 } = {}) {
  const pages = [];
  for (const src of sources) {
    const canvas = drawToCanvas(src, { maxSide, background: '#ffffff' });
    const jpeg = await encodeNative(canvas, 'image/jpeg', quality);
    pages.push({ width: canvas.width, height: canvas.height, jpeg: new Uint8Array(await jpeg.arrayBuffer()) });
  }
  return buildImagesPdf(pages);
}
