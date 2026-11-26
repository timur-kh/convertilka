// Реестр форматов: как определить формат файла и во что его можно сконвертировать.
import { extOf } from './util.js';

export const GROUPS = {
  image: { label: 'Изображения', icon: '🖼️' },
  document: { label: 'Документы', icon: '📄' },
  sheet: { label: 'Таблицы', icon: '📊' },
  model: { label: '3D-модели', icon: '🧊' },
  video: { label: 'Видео', icon: '🎬' },
  audio: { label: 'Аудио', icon: '🎵' },
};

// group — для иконок и интерфейса, module — какой конвертер читает этот формат
export const FORMATS = {
  png: { label: 'PNG', group: 'image', module: 'image', mime: 'image/png' },
  jpg: { label: 'JPG', group: 'image', module: 'image', mime: 'image/jpeg', aliases: ['jpeg', 'jfif', 'jpe'] },
  webp: { label: 'WebP', group: 'image', module: 'image', mime: 'image/webp' },
  avif: { label: 'AVIF', group: 'image', module: 'image', mime: 'image/avif' },
  gif: { label: 'GIF', group: 'image', module: 'image', mime: 'image/gif' },
  bmp: { label: 'BMP', group: 'image', module: 'image', mime: 'image/bmp' },
  ico: { label: 'ICO', group: 'image', module: 'image', mime: 'image/x-icon' },
  tiff: { label: 'TIFF', group: 'image', module: 'image', mime: 'image/tiff', aliases: ['tif'] },
  svg: { label: 'SVG', group: 'image', module: 'image', mime: 'image/svg+xml' },
  heic: { label: 'HEIC', group: 'image', module: 'image', mime: 'image/heic', aliases: ['heif'] },

  pdf: { label: 'PDF', group: 'document', module: 'pdf', mime: 'application/pdf' },
  docx: { label: 'DOCX', group: 'document', module: 'doc', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  md: { label: 'Markdown', group: 'document', module: 'doc', mime: 'text/markdown', aliases: ['markdown'] },
  html: { label: 'HTML', group: 'document', module: 'doc', mime: 'text/html', aliases: ['htm', 'xhtml'] },
  txt: { label: 'TXT', group: 'document', module: 'doc', mime: 'text/plain', aliases: ['text', 'log'] },
  fb2: { label: 'FB2', group: 'document', module: 'ebook', mime: 'application/x-fictionbook+xml' },
  epub: { label: 'EPUB', group: 'document', module: 'ebook', mime: 'application/epub+zip' },
  djvu: { label: 'DjVu', group: 'document', module: 'djvu', mime: 'image/vnd.djvu', aliases: ['djv'] },

  xlsx: { label: 'XLSX', group: 'sheet', module: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xls: { label: 'XLS', group: 'sheet', module: 'sheet', mime: 'application/vnd.ms-excel' },
  ods: { label: 'ODS', group: 'sheet', module: 'sheet', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  csv: { label: 'CSV', group: 'sheet', module: 'sheet', mime: 'text/csv' },
  json: { label: 'JSON', group: 'sheet', module: 'sheet', mime: 'application/json' },

  stl: { label: 'STL', group: 'model', module: 'model', mime: 'model/stl' },
  obj: { label: 'OBJ', group: 'model', module: 'model', mime: 'model/obj' },
  ply: { label: 'PLY', group: 'model', module: 'model', mime: 'application/octet-stream' },
  glb: { label: 'GLB', group: 'model', module: 'model', mime: 'model/gltf-binary' },
  gltf: { label: 'glTF', group: 'model', module: 'model', mime: 'model/gltf+json' },
  fbx: { label: 'FBX', group: 'model', module: 'model', mime: 'application/octet-stream' },
  '3mf': { label: '3MF', group: 'model', module: 'model', mime: 'model/3mf' },
  dae: { label: 'DAE (Collada)', group: 'model', module: 'model', mime: 'model/vnd.collada+xml' },
  // CAD-форматы (точная геометрия) — только чтение, при конвертации превращаются в сетку треугольников
  step: { label: 'STEP', group: 'model', module: 'model', mime: 'model/step', aliases: ['stp'] },
  iges: { label: 'IGES', group: 'model', module: 'model', mime: 'model/iges', aliases: ['igs'] },
  brep: { label: 'BREP', group: 'model', module: 'model', mime: 'application/octet-stream', aliases: ['brp'] },

  // Видео и звук — FFmpeg (WebAssembly)
  mp4: { label: 'MP4', group: 'video', module: 'media', mime: 'video/mp4' },
  mov: { label: 'MOV', group: 'video', module: 'media', mime: 'video/quicktime', aliases: ['qt'] },
  mkv: { label: 'MKV', group: 'video', module: 'media', mime: 'video/x-matroska' },
  webm: { label: 'WebM', group: 'video', module: 'media', mime: 'video/webm' },
  avi: { label: 'AVI', group: 'video', module: 'media', mime: 'video/x-msvideo' },
  wmv: { label: 'WMV', group: 'video', module: 'media', mime: 'video/x-ms-wmv' },
  flv: { label: 'FLV', group: 'video', module: 'media', mime: 'video/x-flv' },
  m4v: { label: 'M4V', group: 'video', module: 'media', mime: 'video/x-m4v' },
  '3gp': { label: '3GP', group: 'video', module: 'media', mime: 'video/3gpp' },
  mpg: { label: 'MPEG', group: 'video', module: 'media', mime: 'video/mpeg', aliases: ['mpeg', 'vob', 'mts', 'm2ts'] },

  mp3: { label: 'MP3', group: 'audio', module: 'media', mime: 'audio/mpeg' },
  wav: { label: 'WAV', group: 'audio', module: 'media', mime: 'audio/wav', aliases: ['wave'] },
  ogg: { label: 'OGG', group: 'audio', module: 'media', mime: 'audio/ogg', aliases: ['oga'] },
  opus: { label: 'Opus', group: 'audio', module: 'media', mime: 'audio/opus' },
  m4a: { label: 'M4A', group: 'audio', module: 'media', mime: 'audio/mp4' },
  aac: { label: 'AAC', group: 'audio', module: 'media', mime: 'audio/aac' },
  flac: { label: 'FLAC', group: 'audio', module: 'media', mime: 'audio/flac' },
  wma: { label: 'WMA', group: 'audio', module: 'media', mime: 'audio/x-ms-wma' },
  aiff: { label: 'AIFF', group: 'audio', module: 'media', mime: 'audio/aiff', aliases: ['aif'] },
  amr: { label: 'AMR', group: 'audio', module: 'media', mime: 'audio/amr' },
  usdz: { label: 'USDZ', group: 'model', module: 'model', mime: 'model/vnd.usdz+zip' },
};

const IMAGE_OUT = ['png', 'jpg', 'webp', 'avif', 'bmp', 'ico', 'tiff', 'pdf'];
const SHEET_OUT = ['xlsx', 'csv', 'ods', 'json', 'html'];
const MODEL_OUT = ['stl', 'obj', 'ply', 'glb', 'gltf', 'usdz'];
const VIDEO_OUT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'm4a', 'wav', 'ogg', 'flac'];
const AUDIO_OUT = ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac'];

const TARGETS = {
  png: IMAGE_OUT, jpg: IMAGE_OUT, webp: IMAGE_OUT, avif: IMAGE_OUT, bmp: IMAGE_OUT,
  gif: [...IMAGE_OUT, 'mp4', 'webm'], // анимированный GIF → видео
  ico: IMAGE_OUT, tiff: IMAGE_OUT, svg: IMAGE_OUT, heic: IMAGE_OUT,

  pdf: ['docx', 'jpg', 'png', 'txt', 'pdf'],
  fb2: ['epub', 'pdf', 'docx', 'txt', 'html'],
  epub: ['fb2', 'pdf', 'docx', 'txt', 'html'],
  djvu: ['pdf', 'jpg', 'png', 'txt'],
  docx: ['pdf', 'html', 'md', 'txt', 'epub', 'fb2'],
  md: ['html', 'pdf', 'docx', 'epub', 'fb2', 'txt'],
  html: ['pdf', 'docx', 'md', 'epub', 'fb2', 'txt'],
  txt: ['pdf', 'docx', 'html', 'epub', 'fb2'],

  xlsx: SHEET_OUT, xls: SHEET_OUT, ods: SHEET_OUT, csv: SHEET_OUT, json: ['xlsx', 'csv', 'ods'],

  stl: MODEL_OUT, obj: MODEL_OUT, ply: MODEL_OUT, glb: MODEL_OUT, gltf: MODEL_OUT,
  fbx: MODEL_OUT, '3mf': MODEL_OUT, dae: MODEL_OUT,
  step: MODEL_OUT, iges: MODEL_OUT, brep: MODEL_OUT,

  mp4: VIDEO_OUT, mov: VIDEO_OUT, mkv: VIDEO_OUT, webm: VIDEO_OUT, avi: VIDEO_OUT, wmv: VIDEO_OUT,
  flv: VIDEO_OUT, m4v: VIDEO_OUT, '3gp': VIDEO_OUT, mpg: VIDEO_OUT,
  mp3: AUDIO_OUT, wav: AUDIO_OUT, ogg: AUDIO_OUT, opus: AUDIO_OUT, m4a: AUDIO_OUT, aac: AUDIO_OUT,
  flac: AUDIO_OUT, wma: AUDIO_OUT, aiff: AUDIO_OUT, amr: AUDIO_OUT,
};

/** Форматы, которые браузер умеет кодировать, проверяются при запуске (AVIF есть не везде). */
const unsupportedOut = new Set();
/** Сайт умеет from → to, но этот браузер не может сохранить в to (например, AVIF в старом Safari). */
export const browserCantEncode = (from, to) => unsupportedOut.has(to) && (TARGETS[from] || []).includes(to);
export async function probeEncoders() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const b = await new Promise((r) => c.toBlob(r, 'image/avif', 0.5));
    if (!b || b.type !== 'image/avif') unsupportedOut.add('avif');
  } catch {
    unsupportedOut.add('avif');
  }
}

const byExt = new Map();
for (const [key, f] of Object.entries(FORMATS)) {
  byExt.set(key, key);
  for (const a of f.aliases || []) byExt.set(a, key);
}
const byMime = new Map(Object.entries(FORMATS).map(([k, f]) => [f.mime, k]));

/** Определяет формат по расширению, затем по MIME-типу. Возвращает ключ FORMATS или null. */
export function detectFormat(file) {
  if (/.fb2.zip$/i.test(file.name)) return 'fb2'; // книги FB2 часто лежат в zip-архиве
  const ext = extOf(file.name);
  if (byExt.has(ext)) return byExt.get(ext);
  if (file.type && byMime.has(file.type) && file.type !== 'application/octet-stream') return byMime.get(file.type);
  if (file.type === 'image/jpg') return 'jpg';
  return null;
}

// В тот же формат имеет смысл конвертировать только с изменениями: сжатие картинки/PDF или правки видео и звука
const SAME_FORMAT = new Set(['jpg', 'webp', 'pdf', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'ogg', 'opus', 'flac', 'wav']);

export function targetsFor(format) {
  const list = (TARGETS[format] || []).filter((t) => (t !== format || SAME_FORMAT.has(t)) && !unsupportedOut.has(t));
  if (SAME_FORMAT.has(format) && TARGETS[format] && !list.includes(format)) list.push(format);
  return list;
}

/** Подпись варианта в списке: для того же формата поясняем, что произойдёт. */
export function targetLabel(from, to) {
  if (from !== to) return FORMATS[to].label;
  return FORMATS[to].module === 'media' ? `${FORMATS[to].label} — с правками` : `${FORMATS[to].label} — сжать`;
}

/** Какой модуль выполняет конвертацию from → to. */
export function converterFor(from, to) {
  // GIF → MP4/WebM и любые видео/звук — через FFmpeg
  if (FORMATS[to]?.module === 'media') return 'media';
  return FORMATS[from]?.module;
}

export const extensionFor = (fmt) => fmt;

/** Список поддерживаемых расширений для атрибута accept у <input type=file>. */
export function acceptAttribute() {
  return [...byExt.keys()].filter((e) => TARGETS[byExt.get(e)]).map((e) => '.' + e).join(',');
}

export function inputFormatsByGroup() {
  const out = {};
  for (const [k, f] of Object.entries(FORMATS)) {
    if (!TARGETS[k]) continue;
    (out[f.group] ||= []).push(f.label);
  }
  return out;
}
