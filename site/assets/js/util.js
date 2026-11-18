// Общие вспомогательные функции.

const VENDOR = new URL('../../vendor/', import.meta.url);
export const vendorUrl = (path) => new URL(path, VENDOR).href;

/** Подключает классический (UMD) скрипт из vendor/ один раз и возвращает созданный им глобальный объект. */
const scriptCache = new Map();
export function loadScript(path, globalName) {
  if (!scriptCache.has(path)) {
    scriptCache.set(
      path,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = vendorUrl(path);
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          scriptCache.delete(path);
          reject(new Error(`Не удалось загрузить компонент ${path}`));
        };
        document.head.append(s);
      }),
    );
  }
  return scriptCache.get(path).then(() => (globalName ? window[globalName] : undefined));
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i === 0 || bytes >= 100 ? 0 : 1)} ${units[i]}`;
}

export function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Убирает из имени файла символы, запрещённые в Windows/macOS. */
export function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 200) || 'file';
}

/** Скачивание Blob пользователем. URL отзывается позже, чтобы Safari успел начать загрузку. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Декодирует текст: UTF-8 (с BOM или без), UTF-16 по BOM, иначе Windows-1251 —
 * так открываются старые русские TXT/CSV из Excel и Блокнота.
 */
export async function readText(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Мини-конструктор DOM: h('div', {class: 'x'}, 'текст', child). Текст всегда вставляется как текст, не как HTML. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Даёт браузеру перерисовать интерфейс между тяжёлыми шагами. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Браузер не смог закодировать изображение'))), type, quality),
  );
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
