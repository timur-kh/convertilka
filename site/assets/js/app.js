// Главная страница: выбор файлов, конвертация, предпросмотр, скачивание.
import { CONFIG } from './config.js';
import { FORMATS, detectFormat, targetsFor, targetLabel, converterFor, probeEncoders, acceptAttribute } from './formats.js';
import { h, formatSize, downloadBlob, baseName, nextFrame, vendorUrl } from './util.js';
import { renderPreview } from './preview.js';
import { initAds } from './ads.js';
import { noteConversion } from './share.js';
import { goal } from './analytics.js';

const CONVERTERS = {
  image: () => import('./converters/image.js'),
  pdf: () => import('./converters/pdf.js'),
  doc: () => import('./converters/document.js'),
  sheet: () => import('./converters/sheet.js'),
  model: () => import('./converters/model.js'),
  media: () => import('./converters/media.js'),
  ebook: () => import('./converters/ebook.js'),
  djvu: () => import('./converters/djvu.js'),
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
    videoQuality: f.get('videoQuality') || 'medium',
    maxHeight: Number(f.get('maxHeight')) || 0,
    audioBitrate: Number(f.get('audioBitrate')) || 192,
    fastRemux: f.get('fastRemux') === 'on',
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
    // Правки видео и звука: кодеки, дорожки (оставить/громкость), сжатие до размера
    if (FORMATS[format].module === 'media') item.edit = { videoCodec: 'auto', audioCodec: 'auto', tracks: [], compress: null, rotate: 0 };
    // Картинки: поворот на 90° (кнопки в предпросмотре)
    if (FORMATS[format].module === 'image') item.edit = { rotate: 0 };
    item.el = renderItem(item);
    items.push(item);
    added.push(item);
    els.list.append(item.el);
  }
  if (skipped.length) toast(`Формат не поддерживается: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`, 'error');
  refreshToolbar();
  // Если ничего не выбрано — сразу показываем первый добавленный файл
  if (added[0] && previewItemId === null) selectItem(added[0], { scroll: false });
  if (added.length) revealTool();
}

/** Файл бросили, пролистав страницу вниз, — возвращаем к конвертеру, чтобы было видно, что добавилось. */
function revealTool() {
  const tool = $('#tool');
  const top = tool.getBoundingClientRect().top;
  const header = $('.site-header')?.offsetHeight || 0;
  // Конвертер и так на виду (его верх в пределах верхней трети экрана) — не дёргаем страницу
  if (top >= header - 4 && top < innerHeight / 3) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  tool.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

// Страница конкретной пары (например /heic-to-jpg/) задаёт формат в <body data-to="jpg">
// …или ссылка из поиска: /formats/png/?to=avif — «PNG в AVIF», для которой нет отдельной страницы
const PRESET_TO = new URLSearchParams(location.search).get('to')?.toLowerCase() || document.body.dataset.to || '';

function defaultTarget(format, targets) {
  if (PRESET_TO && targets.includes(PRESET_TO)) return PRESET_TO;
  const prefs = { heic: 'jpg', webp: 'png', avif: 'png', png: 'jpg', jpg: 'png', svg: 'png', tiff: 'jpg', bmp: 'png', gif: 'png', ico: 'png',
    docx: 'pdf', djvu: 'pdf', fb2: 'epub', epub: 'fb2', md: 'html', html: 'pdf', txt: 'pdf', pdf: 'jpg', xls: 'xlsx', xlsx: 'csv', ods: 'xlsx', csv: 'xlsx', json: 'xlsx',
    stl: 'glb', obj: 'stl', fbx: 'glb', glb: 'stl', gltf: 'glb', ply: 'stl', '3mf': 'stl', dae: 'glb', step: 'stl', iges: 'stl', brep: 'stl',
    mp4: 'mp3', mov: 'mp4', mkv: 'mp4', webm: 'mp4', avi: 'mp4', wmv: 'mp4', flv: 'mp4', m4v: 'mp4', '3gp': 'mp4', mpg: 'mp4',
    mp3: 'wav', wav: 'mp3', ogg: 'mp3', opus: 'mp3', m4a: 'mp3', aac: 'mp3', flac: 'mp3', wma: 'mp3', aiff: 'mp3', amr: 'mp3' };
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
    targetsFor(format).map((t) => h('option', { value: t, selected: t === item.target }, targetLabel(format, t))));
  select.addEventListener('change', () => setTarget(item, select.value));

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
        h('button', { class: 'btn btn-primary btn-sm convert', type: 'button', onclick: () => (item.state === 'working' ? item.abort?.abort() : runQueue([item])) }, 'Конвертировать'),
      ),
      h('div', { class: 'item-edits' }),
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
    // Порядок с клавиатуры: Alt+↑ / Alt+↓
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target === el) {
      e.preventDefault();
      moveItem(item, e.key === 'ArrowUp' ? -1 : 1);
      el.focus();
    }
  });
  enableDrag(item, el);
  return el;
}

// ---------- Порядок файлов: перетаскивание мышью (важно для «Объединить в PDF») ----------
let dragged = null;
function enableDrag(item, el) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    if (e.target.closest('select, input, button')) return e.preventDefault();
    dragged = item;
    el.classList.add('dragging-item');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id));
  });
  el.addEventListener('dragend', () => {
    dragged = null;
    el.classList.remove('dragging-item');
    for (const x of els.list.children) x.classList.remove('drop-before', 'drop-after');
  });
  el.addEventListener('dragover', (e) => {
    if (!dragged || dragged === item) return;
    e.preventDefault();
    e.stopPropagation();
    const after = e.offsetY > el.offsetHeight / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    if (!dragged || dragged === item) return;
    e.preventDefault();
    e.stopPropagation();
    const after = el.classList.contains('drop-after');
    el.classList.remove('drop-before', 'drop-after');
    items.splice(items.indexOf(dragged), 1);
    items.splice(items.indexOf(item) + (after ? 1 : 0), 0, dragged);
    el[after ? 'after' : 'before'](dragged.el);
  });
}

function moveItem(item, dir) {
  const i = items.indexOf(item);
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  if (dir < 0) items[i].el.before(item.el);
  else items[i].el.after(item.el);
}

function setState(item, state, text = '') {
  item.state = state;
  item.el.dataset.state = state;
  item.el.querySelector('.item-status').textContent = text;
  const btn = item.el.querySelector('.convert');
  btn.textContent = state === 'working' ? 'Отменить' : 'Конвертировать';
  btn.classList.toggle('btn-primary', state !== 'working');
  btn.classList.toggle('btn-ghost', state === 'working');
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

/** Перезапустить разовую вспышку кнопки (класс is-new снимается по окончании анимации). */
function flash(btn) {
  btn.classList.remove('is-new');
  void btn.offsetWidth; // новый кадр — анимация начнётся заново
  btn.classList.add('is-new');
}

// «Скачать ZIP»: зелёная, когда есть что скачать, и мигает, когда добавился новый результат
let zipCount = 0;
function updateZipButton() {
  const n = items.reduce((s, i) => s + i.outputs.length, 0);
  const btn = els.zipAll;
  btn.disabled = !n;
  btn.classList.toggle('btn-download', n > 0);
  btn.classList.toggle('btn-ghost', !n);
  if (!btn.querySelector('.dl-icon')) btn.prepend(h('span', { class: 'dl-icon', 'aria-hidden': 'true' }));
  btn.querySelector('.dl-icon').hidden = !n;
  if (n > zipCount) flash(btn);
  zipCount = n;
}
els.zipAll.addEventListener('animationend', (e) => e.target === els.zipAll && els.zipAll.classList.remove('is-new'));

function refreshToolbar() {
  const has = items.length > 0;
  els.workspace.hidden = !has;
  els.drop.hidden = has;
  els.mergePdf.hidden = items.filter(mergeable).length < 2 && document.body.dataset.tool !== 'merge-pdf';
  els.mergePdf.disabled = items.filter(mergeable).length < 1;
  els.list.classList.toggle('sortable', items.length > 1);
  updateZipButton();
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
  const ctrl = new AbortController();
  item.abort = ctrl;
  setState(item, 'working', 'Конвертация…');
  setProgress(item, 0.05);
  await nextFrame();
  const started = performance.now();
  const status = item.el.querySelector('.item-status');
  const onProgress = (p, text) => {
    if (ctrl.signal.aborted) return;
    if (Number.isFinite(p)) setProgress(item, Math.max(0.05, p));
    if (text) status.textContent = text;
  };
  try {
    const mod = await CONVERTERS[converterFor(item.format, item.target)]();
    const outputs = await mod.convert(item.file, item.format, item.target, { ...opts, signal: ctrl.signal, edit: item.edit }, onProgress);
    // Конвертеры без поддержки отмены просто доработают — результат тогда отбрасываем
    if (ctrl.signal.aborted) throw new DOMException('Отменено', 'AbortError');
    item.outputs = outputs;
    setState(item, 'done', `Готово за ${formatDuration((performance.now() - started) / 1000)}`);
    renderOutputs(item);
    // На каждой 10-й конвертации — окно «Спасибо» со скачиванием и кнопками «поделиться»
    goal('convert', { from: item.format, to: item.target, pair: `${item.format}-${item.target}` });
    noteConversion(outputs.length > 1
      ? { name: `${baseName(item.file.name)}.zip`, download: () => downloadZip(outputs, `${baseName(item.file.name)}.zip`) }
      : { name: outputs[0].name, download: () => downloadBlob(outputs[0].blob, outputs[0].name) });
  } catch (e) {
    item.outputs = [];
    if (ctrl.signal.aborted || e?.name === 'AbortError') {
      setState(item, 'ready', 'Отменено');
    } else {
      console.error(e);
      setState(item, 'error', `Ошибка: ${e?.message || e}`);
    }
  } finally {
    item.abort = null;
  }
}

function formatDuration(sec) {
  if (sec < 60) return `${sec.toFixed(1)} с`;
  return `${Math.floor(sec / 60)} мин ${Math.round(sec % 60)} с`;
}

function renderOutputs(item) {
  const list = item.el.querySelector('.outputs');
  const MAX_SHOWN = 6;
  list.replaceChildren(
    ...item.outputs.slice(0, MAX_SHOWN).map((o) => {
      const fmt = item.target;
      return h('li', {},
        // Новая кнопка пару раз «вспыхивает», чтобы её заметили; при повторной отрисовке — уже нет
        h('button', {
          class: `btn btn-download${o.shown ? '' : ' is-new'}`,
          type: 'button',
          title: `Скачать ${o.name}`,
          onclick: () => { downloadBlob(o.blob, o.name); goal('download', { to: item.target }); },
          onanimationend: (e) => e.target === e.currentTarget && e.currentTarget.classList.remove('is-new'),
        }, h('span', { class: 'dl-icon', 'aria-hidden': 'true' }), h('span', { class: 'dl-text' }, 'Скачать'), h('span', { class: 'dl-name' }, o.name)),
        h('span', { class: 'out-size' }, formatSize(o.blob.size)),
        o.note ? h('span', { class: 'out-note' }, o.note) : '',
        canPreviewResult(fmt)
          ? h('button', { class: 'link-btn', type: 'button', onclick: () => openPreview(o.blob, fmt, `Результат: ${o.name}`, item) }, 'посмотреть')
          : '',
      );
    }),
    item.outputs.length > 1
      ? h('li', {}, h('button', { class: `btn btn-download${item.outputs.some((o) => !o.shown) ? ' is-new' : ''}`, type: 'button', onclick: () => downloadZip(item.outputs, `${baseName(item.file.name)}.zip`), onanimationend: (e) => e.target === e.currentTarget && e.currentTarget.classList.remove('is-new') }, h('span', { class: 'dl-icon', 'aria-hidden': 'true' }), h('span', { class: 'dl-text' }, `Скачать все ${item.outputs.length} файлов (ZIP)`)))
      : '',
  );
  for (const o of item.outputs) o.shown = true;
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
    if (item.state === 'error') setState(item, 'ready');
    setTarget(item, t);
  }
  els.allTarget.value = '';
  toast(`Для всех файлов выбран ${FORMATS[t].label}`, 'ok');
});

els.clearAll.addEventListener('click', () => {
  if (busy) return;
  for (const item of [...items]) removeItem(item);
});

// PDF-файлы и картинки из списка → один PDF в порядке списка (порядок меняется перетаскиванием)
const mergeable = (i) => i.format === 'pdf' || FORMATS[i.format].module === 'image';
els.mergePdf.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  els.mergePdf.disabled = true;
  try {
    const { mergeToPdf } = await import('./converters/merge.js');
    const parts = items.filter(mergeable);
    const blob = await mergeToPdf(parts);
    const name = parts.length && parts.every((p) => p.format === 'pdf') ? 'объединённый.pdf' : 'документ.pdf';
    downloadBlob(blob, name);
    toast(`Готово: ${parts.length} файлов в одном PDF (${formatSize(blob.size)})`, 'ok');
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
  goal('download_zip');
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

/** Исходный файл показываем вместе с панелью правок (для видео и звука). */
const selectItem = (item, opts = {}) => openPreview(item.file, item.format, item.file.name, item, {
  ...opts,
  ctx: item.edit ? {
    edit: item.edit,
    target: item.target,
    onEditChange: () => {
      renderEdits(item);
      if (item.state === 'done' || item.state === 'error') setState(item, 'ready', 'Есть изменения — сконвертируйте заново');
    },
    onTargetChange: (t) => setTarget(item, t),
  } : null,
});

function setTarget(item, t) {
  item.target = t;
  item.el.querySelector('select.target').value = t;
  if (item.state === 'done') setState(item, 'ready');
  renderEdits(item);
  // Списки кодеков зависят от формата — обновляем панель правок
  if (item.edit && previewItemId === item.id) selectItem(item, { scroll: false });
}

/** Короткая сводка правок под именем файла: «H.264 · громкость 150% · дорожек 1 из 2 · ≤ 30 МБ». */
function renderEdits(item) {
  const box = item.el.querySelector('.item-edits');
  const e = item.edit;
  if (!e) return;
  const parts = [];
  const CODEC = { avc: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9' };
  if (e.rotate) parts.push(`поворот ${e.rotate}°`);
  if (e.compress) parts.push(`≤ ${e.compress.targetMB} МБ, ${e.compress.height}p ${CODEC[e.compress.codec] || ''}`.trim());
  const vlabel = { copy: 'видео без перекодирования', h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4', prores: 'ProRes' }[e.videoCodec];
  if (!e.compress && vlabel && FORMATS[item.target]?.group === 'video') parts.push(vlabel);
  const alabel = { copy: 'звук без перекодирования', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC-3', pcm16: 'PCM 16', pcm24: 'PCM 24' }[e.audioCodec];
  if (alabel) parts.push(alabel);
  const tracks = e.tracks || [];
  const gains = tracks.filter((t) => t && t.keep !== false && Math.abs((t.gain ?? 1) - 1) > 0.001).map((t) => { const db = 20 * Math.log10(t.gain); return t.gain > 0 ? `${db > 0 ? '+' : '−'}${Math.abs(Math.round(db))} дБ` : 'без звука'; });
  if (gains.length) parts.push(`громкость ${gains.join(', ')}`);
  const total = tracks.filter(Boolean).length;
  const kept = tracks.filter((t) => t && t.keep !== false).length;
  if (total && kept < total) parts.push(kept ? `дорожек ${kept} из ${total}` : 'без звука');
  box.textContent = parts.length ? `✎ ${parts.join(' · ')}` : '';
}

/** Показывает файл (исходный или результат конвертации) в панели предпросмотра. */
async function openPreview(blob, format, title, item = null, { scroll = true, ctx = null } = {}) {
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
  const dispose = await renderPreview(box, file, format, ctx);
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


// ---------- Вкладки в блоке «Популярные конвертации» ----------
{
  const tabs = [...document.querySelectorAll('.links-tab')];
  const panels = [...document.querySelectorAll('.links-panel')];
  if (tabs.length && panels.length) {
    const open = (id) => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === id));
      for (const p of panels) p.hidden = p.dataset.panel !== id;
    };
    document.querySelector('.links-tabs').hidden = false;
    for (const t of tabs) t.addEventListener('click', () => open(t.dataset.tab));
    // На странице конвертации сразу открываем её категорию
    const current = document.querySelector('.links-panel:not([data-panel="top"]) a[aria-current="page"]');
    open(current?.closest('.links-panel').dataset.panel || 'top');
  }
}

// ---------- Страница «Объединить PDF»: главная кнопка — объединение ----------
if (document.body.dataset.tool === 'merge-pdf') {
  els.mergePdf.classList.replace('btn-ghost', 'btn-primary');
  els.convertAll.hidden = true;
  els.allTarget.remove();
}

// ---------- Настройки по умолчанию со страниц-инструментов (например, «Сжать изображение») ----------
{
  const { quality, maxSide } = document.body.dataset;
  if (quality) {
    els.settings.elements.quality.value = quality;
    $('#quality-value').textContent = `${quality}%`;
  }
  if (maxSide) els.settings.elements.maxSide.value = maxSide;
}

// ---------- Старт ----------
// Только на HTTPS (на боевом сайте): при локальной разработке кэш мешал бы видеть правки
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Путь от app.js, а не от страницы: страницы пар лежат в подпапках (/heic-to-jpg/)
  const root = new URL('../../', import.meta.url);
  navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname }).catch(() => {});
}
await probeEncoders();
initAds();
