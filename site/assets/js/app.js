// Главная страница: выбор файлов, конвертация, предпросмотр, скачивание.
import { CONFIG } from './config.js';
import { FORMATS, detectFormat, targetsFor, converterFor, probeEncoders, acceptAttribute, inputFormatsByGroup } from './formats.js';
import { h, formatSize, downloadBlob, baseName, nextFrame, vendorUrl } from './util.js';
import { renderPreview } from './preview.js';
import { initAds } from './ads.js';

const CONVERTERS = {
  image: () => import('./converters/image.js'),
  pdf: () => import('./converters/pdf.js'),
  doc: () => import('./converters/document.js'),
  sheet: () => import('./converters/sheet.js'),
  model: () => import('./converters/model.js'),
};

const $ = (sel) => document.querySelector(sel);
const els = {
  drop: $('#dropzone'),
  input: $('#file-input'),
  list: $('#file-list'),
  workspace: $('#workspace'),
  addMore: $('#add-more'),
  convertAll: $('#convert-all'),
  zipAll: $('#zip-all'),
  mergePdf: $('#merge-pdf'),
  clearAll: $('#clear-all'),
  allTarget: $('#all-target'),
  settings: $('#settings'),
  panel: $('#preview-panel'),
  ppBody: $('#pp-body'),
  ppTitle: $('#pp-title'),
  ppExpand: $('#pp-expand'),
  ppFullscreen: $('#pp-fullscreen'),
  backdrop: $('#pp-backdrop'),
  toast: $('#toast'),
};

/** @type {Array<{id:number, file:File, format:string, target:string, state:string, outputs:Array, el:HTMLElement, thumbUrl?:string}>} */
const items = [];
let nextId = 1;
let busy = false;

// ---------- Настройки ----------
function getOptions() {
  const f = new FormData(els.settings);
  return {
    quality: Number(f.get('quality')) / 100,
    maxSide: Number(f.get('maxSide')) || 0,
    background: f.get('background') || '#ffffff',
    dpi: Number(f.get('dpi')) || 150,
    csvSeparator: f.get('csvSeparator') === 'semicolon' ? ';' : f.get('csvSeparator') === 'tab' ? '\t' : ',',
  };
}
els.settings.addEventListener('input', (e) => {
  if (e.target.name === 'quality') $('#quality-value').textContent = `${e.target.value}%`;
});
els.settings.addEventListener('submit', (e) => e.preventDefault());

// ---------- Уведомления ----------
let toastTimer;
function toast(message, kind = 'info') {
  els.toast.textContent = message;
  els.toast.dataset.kind = kind;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 5000);
}

// ---------- Добавление файлов ----------
function addFiles(fileList) {
  const files = [...fileList];
  const skipped = [];
  const added = [];
  for (const file of files) {
    const format = detectFormat(file);
    const targets = format ? targetsFor(format) : [];
    if (!targets.length) {
      skipped.push(file.name);
      continue;
    }
    if (file.size > CONFIG.warnFileSizeMB * 1024 * 1024) {
      toast(`«${file.name}» очень большой (${formatSize(file.size)}) — конвертация может занять время или не хватить памяти.`, 'warn');
    }
    const item = { id: nextId++, file, format, target: defaultTarget(format, targets), state: 'ready', outputs: [] };
    item.el = renderItem(item);
    items.push(item);
    added.push(item);
    els.list.append(item.el);
  }
  if (skipped.length) toast(`Формат не поддерживается: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`, 'error');
  refreshToolbar();
  // Если ничего не выбрано — сразу показываем первый добавленный файл
  if (added[0] && previewItemId === null) selectItem(added[0], { scroll: false });
}

function defaultTarget(format, targets) {
  const prefs = { heic: 'jpg', webp: 'png', avif: 'png', png: 'jpg', jpg: 'png', svg: 'png', tiff: 'jpg', bmp: 'png', gif: 'png', ico: 'png',
    docx: 'pdf', md: 'html', html: 'pdf', txt: 'pdf', pdf: 'jpg', xls: 'xlsx', xlsx: 'csv', ods: 'xlsx', csv: 'xlsx', json: 'xlsx',
    stl: 'glb', obj: 'stl', fbx: 'glb', glb: 'stl', gltf: 'glb', ply: 'stl', '3mf': 'stl', dae: 'glb', step: 'stl', iges: 'stl', brep: 'stl' };
  return targets.includes(prefs[format]) ? prefs[format] : targets[0];
}

const NATIVE_THUMB = new Set(['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'ico']);

function renderItem(item) {
  const { file, format } = item;
  const group = FORMATS[format].group;
  let thumb;
  if (NATIVE_THUMB.has(format) && file.size < 30 * 1024 * 1024) {
    item.thumbUrl = URL.createObjectURL(file);
    thumb = h('img', { class: 'thumb', src: item.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' });
  } else {
    thumb = h('div', { class: `thumb thumb-icon g-${group}` }, h('span', {}, format.toUpperCase()));
  }

  const select = h('select', { class: 'target', 'aria-label': `Формат для ${file.name}` },
    targetsFor(format).map((t) => h('option', { value: t, selected: t === item.target }, FORMATS[t].label)));
  select.addEventListener('change', () => {
    item.target = select.value;
    if (item.state === 'done') setState(item, 'ready');
  });

  // Вся строка — «кнопка» выбора файла для предпросмотра; внутренние кнопки и список работают сами по себе
  const el = h('li', { class: 'item', tabindex: '0', 'aria-label': `${file.name}, показать` , dataset: { id: item.id } },
    thumb,
    h('div', { class: 'item-main' },
      h('div', { class: 'item-top' },
        h('div', { class: 'item-name', title: file.name }, file.name),
        h('button', { class: 'icon-btn item-remove', type: 'button', title: 'Убрать', 'aria-label': `Убрать ${file.name}`, onclick: () => removeItem(item) }, '✕'),
      ),
      h('div', { class: 'item-row' },
        h('span', { class: 'item-meta' }, h('span', { class: `badge g-${group}` }, FORMATS[format].label), ` ${formatSize(file.size)}`),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        select,
        h('button', { class: 'btn btn-primary btn-sm convert', type: 'button', onclick: () => runQueue([item]) }, 'Конвертировать'),
      ),
      h('div', { class: 'item-status', role: 'status' }),
      h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-bar' })),
      h('ul', { class: 'outputs' }),
    ),
  );
  const isControl = (t) => t.closest('button, select, input, a, .outputs');
  el.addEventListener('click', (e) => {
    if (!isControl(e.target)) selectItem(item);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
      e.preventDefault();
      selectItem(item);
    }
  });
  return el;
}

function setState(item, state, text = '') {
  item.state = state;
  item.el.dataset.state = state;
  item.el.querySelector('.item-status').textContent = text;
  item.el.querySelector('.convert').disabled = state === 'working';
  item.el.querySelector('.progress').hidden = state !== 'working';
  if (state !== 'done') item.el.querySelector('.outputs').replaceChildren();
}

function setProgress(item, p) {
  item.el.querySelector('.progress-bar').style.width = `${Math.round(p * 100)}%`;
}

function removeItem(item) {
  if (item.state === 'working') return;
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  const idx = items.indexOf(item);
  item.el.remove();
  items.splice(idx, 1);
  // Удалили показываемый файл — показываем соседний, а если файлов не осталось — очищаем
  if (previewItemId === item.id) {
    const next = items[idx] || items[idx - 1];
    if (next) selectItem(next, { scroll: false });
    else clearPreview();
  }
  refreshToolbar();
}

function refreshToolbar() {
  const has = items.length > 0;
  els.workspace.hidden = !has;
  els.drop.hidden = has;
  const images = items.filter((i) => FORMATS[i.format].module === 'image');
  els.mergePdf.hidden = images.length < 2;
  els.zipAll.disabled = !items.some((i) => i.outputs.length);
  // Общий список форматов — пересечение доступных для всех файлов
  const common = items.reduce((acc, i, idx) => {
    const t = targetsFor(i.format);
    return idx === 0 ? t : acc.filter((x) => t.includes(x));
  }, []);
  // «Формат для всех…» — разовое действие: проставляет формат во всех строках и возвращается к подсказке
  els.allTarget.hidden = items.length < 2 || common.length === 0;
  els.allTarget.replaceChildren(
    h('option', { value: '', selected: true, disabled: true, hidden: true }, 'Формат для всех…'),
    ...common.map((t) => h('option', { value: t }, FORMATS[t].label)),
  );
  els.convertAll.textContent = items.length > 1 ? 'Конвертировать все' : 'Конвертировать';
}

// ---------- Конвертация ----------
async function convertItem(item, opts) {
  setState(item, 'working', 'Конвертация…');
  setProgress(item, 0.05);
  await nextFrame();
  const started = performance.now();
  try {
    const mod = await CONVERTERS[converterFor(item.format, item.target)]();
    const outputs = await mod.convert(item.file, item.format, item.target, opts, (p) => setProgress(item, Math.max(0.05, p)));
    item.outputs = outputs;
    setState(item, 'done', `Готово за ${((performance.now() - started) / 1000).toFixed(1)} с`);
    renderOutputs(item);
  } catch (e) {
    console.error(e);
    item.outputs = [];
    setState(item, 'error', `Ошибка: ${e?.message || e}`);
  }
}

function renderOutputs(item) {
  const list = item.el.querySelector('.outputs');
  const MAX_SHOWN = 6;
  list.replaceChildren(
    ...item.outputs.slice(0, MAX_SHOWN).map((o) => {
      const fmt = item.target;
      return h('li', {},
        h('button', { class: 'btn btn-success btn-sm', type: 'button', onclick: () => downloadBlob(o.blob, o.name) }, `⬇ ${o.name}`),
        h('span', { class: 'out-size' }, formatSize(o.blob.size)),
        canPreviewResult(fmt)
          ? h('button', { class: 'link-btn', type: 'button', onclick: () => openPreview(o.blob, fmt, `Результат: ${o.name}`, item) }, 'посмотреть')
          : '',
      );
    }),
    item.outputs.length > 1
      ? h('li', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => downloadZip(item.outputs, `${baseName(item.file.name)}.zip`) }, `Скачать все ${item.outputs.length} файлов (ZIP)`))
      : '',
  );
  refreshToolbar();
}

// USDZ открывается только в AR Quick Look (iOS/macOS) — предпросмотра в браузере нет
const canPreviewResult = (fmt) => fmt !== 'usdz';

async function runQueue(queue) {
  if (busy) return toast('Подождите, идёт конвертация…');
  busy = true;
  document.body.classList.add('busy');
  const opts = getOptions();
  try {
    for (const item of queue) await convertItem(item, opts);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
  const failed = queue.filter((i) => i.state === 'error').length;
  if (queue.length > 1) toast(failed ? `Готово, с ошибками: ${failed}` : 'Все файлы сконвертированы', failed ? 'warn' : 'ok');
}

els.convertAll.addEventListener('click', () => runQueue(items.filter((i) => i.state !== 'working')));

els.allTarget.addEventListener('change', () => {
  const t = els.allTarget.value;
  if (!t) return;
  for (const item of items) {
    if (item.state === 'working' || item.target === t) continue;
    item.target = t;
    item.el.querySelector('select.target').value = t;
    if (item.state === 'done' || item.state === 'error') setState(item, 'ready');
  }
  els.allTarget.value = '';
  toast(`Для всех файлов выбран ${FORMATS[t].label}`, 'ok');
});

els.clearAll.addEventListener('click', () => {
  if (busy) return;
  for (const item of [...items]) removeItem(item);
});

els.mergePdf.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  els.mergePdf.disabled = true;
  try {
    const { decodeImage, imagesToPdf } = await import('./converters/image.js');
    const images = items.filter((i) => FORMATS[i.format].module === 'image');
    const sources = [];
    for (const i of images) sources.push(await decodeImage(i.file, i.format));
    const opts = getOptions();
    const blob = await imagesToPdf(sources, opts);
    downloadBlob(blob, 'images.pdf');
    toast(`PDF из ${images.length} изображений готов (${formatSize(blob.size)})`, 'ok');
  } catch (e) {
    toast(`Ошибка: ${e.message}`, 'error');
  } finally {
    busy = false;
    els.mergePdf.disabled = false;
  }
});

// ---------- ZIP ----------
async function downloadZip(outputs, name) {
  const { zipSync } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const used = new Set();
  const files = {};
  for (const o of outputs) {
    let n = o.name, k = 2;
    while (used.has(n)) n = `${baseName(o.name)} (${k++}).${o.name.split('.').pop()}`;
    used.add(n);
    const compressible = /\.(txt|csv|json|html|md|obj|gltf|stl|ply|bmp|tiff)$/i.test(n);
    files[n] = [new Uint8Array(await o.blob.arrayBuffer()), { level: compressible ? 6 : 0 }];
  }
  downloadBlob(new Blob([zipSync(files)], { type: 'application/zip' }), name);
}

els.zipAll.addEventListener('click', () => {
  const all = items.flatMap((i) => i.outputs);
  if (all.length) downloadZip(all, 'converted.zip');
});

// ---------- Предпросмотр ----------
// Правая часть рабочего окна (на узких экранах — под списком файлов)
const narrow = matchMedia('(max-width: 1023px)');
let disposePreview = null;
let previewGen = 0; // защищает от гонки, если быстро открыть другой файл, пока готовится предыдущий
let previewItemId = null;

function clearPreview() {
  previewGen++;
  disposePreview?.();
  disposePreview = null;
  previewItemId = null;
  markSelected();
  els.ppTitle.textContent = 'Предпросмотр';
  els.ppBody.replaceChildren();
  setExpanded(false);
}

function markSelected() {
  for (const it of items) {
    const on = it.id === previewItemId;
    it.el.classList.toggle('selected', on);
    it.el.setAttribute('aria-current', String(on));
  }
}

const selectItem = (item, opts) => openPreview(item.file, item.format, item.file.name, item, opts);

/** Показывает файл (исходный или результат конвертации) в панели предпросмотра. */
async function openPreview(blob, format, title, item = null, { scroll = true } = {}) {
  previewGen++;
  disposePreview?.();
  disposePreview = null;
  const gen = previewGen;
  previewItemId = item?.id ?? null;
  markSelected();
  els.ppTitle.textContent = title;
  els.ppTitle.title = title;
  if (scroll && narrow.matches && !els.panel.classList.contains('expanded')) {
    els.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Каждый предпросмотр — в своём контейнере, чтобы устаревший не перезаписал новый
  const box = h('div', { class: 'pp-content' });
  els.ppBody.replaceChildren(box);
  const file = blob instanceof File ? blob : new File([blob], title, { type: blob.type });
  const dispose = await renderPreview(box, file, format);
  // Пока готовился предпросмотр, открыли другой файл или закрыли панель — освобождаем ресурсы
  if (gen !== previewGen) return dispose();
  disposePreview = dispose;
}

function setExpanded(on) {
  els.panel.classList.toggle('expanded', on);
  els.backdrop.hidden = !on;
  document.body.classList.toggle('pp-locked', on);
  els.ppExpand.setAttribute('aria-pressed', String(on));
  els.ppExpand.title = on ? 'Свернуть' : 'Развернуть';
  els.ppExpand.setAttribute('aria-label', on ? 'Свернуть предпросмотр' : 'Развернуть предпросмотр');
}
els.ppExpand.addEventListener('click', () => setExpanded(!els.panel.classList.contains('expanded')));
els.backdrop.addEventListener('click', () => setExpanded(false));
els.ppFullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await els.panel.requestFullscreen();
  } catch {
    setExpanded(true); // например, iPhone не даёт полноэкранный режим для элементов
  }
});
// Полноэкранный режим есть не во всех браузерах (iPhone) — там кнопка не нужна
if (!document.fullscreenEnabled) els.ppFullscreen.hidden = true;
document.addEventListener('fullscreenchange', () => {
  els.panel.classList.toggle('fullscreen', document.fullscreenElement === els.panel);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.panel.classList.contains('expanded') && !document.fullscreenElement) setExpanded(false);
});

// ---------- Drag & drop, выбор, вставка ----------
els.input.accept = acceptAttribute();
els.input.addEventListener('change', () => {
  addFiles(els.input.files);
  els.input.value = '';
});
els.addMore.addEventListener('click', () => els.input.click());
els.drop.addEventListener('click', (e) => {
  if (e.target === els.drop || e.target.closest('.drop-inner')) els.input.click();
});
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.input.click();
  }
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
window.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  // У вставленных скриншотов имя «image.png» — делаем понятнее
  addFiles(files.map((f) => (f.name === 'image.png' ? new File([f], `screenshot-${Date.now()}.png`, { type: f.type }) : f)));
});
window.addEventListener('beforeunload', (e) => {
  if (busy) e.preventDefault();
});

// ---------- Список форматов на странице ----------
function renderFormatList() {
  const box = $('#format-groups');
  if (!box) return;
  const byGroup = inputFormatsByGroup();
  for (const [g, labels] of Object.entries(byGroup)) {
    const card = box.querySelector(`[data-group="${g}"] .fmt-list`);
    if (card) card.replaceChildren(...labels.map((l) => h('span', { class: `chip g-${g}` }, l)));
  }
}

// ---------- Старт ----------
// Только на HTTPS (на боевом сайте): при локальной разработке кэш мешал бы видеть правки
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
await probeEncoders();
renderFormatList();
initAds();
