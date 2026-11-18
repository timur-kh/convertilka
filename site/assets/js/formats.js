// Реестр форматов: как определить формат файла и во что его можно сконвертировать.
import { extOf } from './util.js';

export const GROUPS = {
  image: { label: 'Изображения', icon: '🖼️' },
  document: { label: 'Документы', icon: '📄' },
  sheet: { label: 'Таблицы', icon: '📊' },
  model: { label: '3D-модели', icon: '🧊' },
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
  usdz: { label: 'USDZ', group: 'model', module: 'model', mime: 'model/vnd.usdz+zip' },
};

const IMAGE_OUT = ['png', 'jpg', 'webp', 'avif', 'bmp', 'ico', 'tiff', 'pdf'];
const SHEET_OUT = ['xlsx', 'csv', 'ods', 'json', 'html'];
const MODEL_OUT = ['stl', 'obj', 'ply', 'glb', 'gltf', 'usdz'];

const TARGETS = {
  png: IMAGE_OUT, jpg: IMAGE_OUT, webp: IMAGE_OUT, avif: IMAGE_OUT, gif: IMAGE_OUT, bmp: IMAGE_OUT,
  ico: IMAGE_OUT, tiff: IMAGE_OUT, svg: IMAGE_OUT, heic: IMAGE_OUT,

  pdf: ['png', 'jpg', 'txt'],
  docx: ['pdf', 'html', 'md', 'txt'],
  md: ['html', 'pdf', 'txt'],
  html: ['md', 'pdf', 'txt'],
  txt: ['pdf', 'html'],

  xlsx: SHEET_OUT, xls: SHEET_OUT, ods: SHEET_OUT, csv: SHEET_OUT, json: ['xlsx', 'csv', 'ods'],

  stl: MODEL_OUT, obj: MODEL_OUT, ply: MODEL_OUT, glb: MODEL_OUT, gltf: MODEL_OUT,
  fbx: MODEL_OUT, '3mf': MODEL_OUT, dae: MODEL_OUT,
  step: MODEL_OUT, iges: MODEL_OUT, brep: MODEL_OUT,
};

/** Форматы, которые браузер умеет кодировать, проверяются при запуске (AVIF есть не везде). */
const unsupportedOut = new Set();
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
  const ext = extOf(file.name);
  if (byExt.has(ext)) return byExt.get(ext);
  if (file.type && byMime.has(file.type) && file.type !== 'application/octet-stream') return byMime.get(file.type);
  if (file.type === 'image/jpg') return 'jpg';
  return null;
}

export function targetsFor(format) {
  return (TARGETS[format] || []).filter((t) => t !== format && !unsupportedOut.has(t));
}

/** Какой модуль выполняет конвертацию from → to. */
export function converterFor(from, to) {
  if (FORMATS[from]?.module === 'image') return 'image';
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
