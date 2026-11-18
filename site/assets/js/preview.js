// Предпросмотр файлов. Каждая функция наполняет контейнер и возвращает функцию очистки.
import { h, readText, formatSize, canvasToBlob } from './util.js';
import { FORMATS } from './formats.js';
import { previewDocument } from './sanitize.js';

const TEXT_LIMIT = 300_000;
const NATIVE_IMAGES = new Set(['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'ico', 'svg']);

/** Изолированный iframe: без скриптов, без доступа к нашей странице, наследует наш CSP. */
function sandboxFrame(html) {
  const frame = h('iframe', { class: 'pv-frame', sandbox: '', referrerpolicy: 'no-referrer', title: 'Предпросмотр документа' });
  frame.srcdoc = html;
  return frame;
}

/** Число с разумной точностью: 1234.5 → «1 234,5», 0.01234 → «0,0123». */
function num(v) {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : abs > 0 ? Math.min(6, 2 - Math.floor(Math.log10(abs))) : 0;
  return v.toLocaleString('ru', { maximumFractionDigits: digits });
}

/** Карточка с габаритами и объёмом 3D-модели. */
function dimsBlock(d, format) {
  const u = d.unit;
  const cell = (label, value, hint) => h('div', { class: 'dim', title: hint || '' }, h('span', { class: 'dim-label' }, label), h('b', {}, value));
  // Объём для 3D-печати удобнее в см³
  let volume;
  if (u === 'мм') volume = `${num(d.volume / 1000)} см³`;
  else if (u === 'м') volume = `${num(d.volume * 1e6)} см³`;
  else volume = `${num(d.volume)} ед.³`;
  return h('div', { class: 'pv-dims' },
    h('div', { class: 'dims-row' },
      cell('Ширина (X)', `${num(d.width)} ${u}`),
      cell('Глубина', `${num(d.depth)} ${u}`),
      cell('Высота', `${num(d.height)} ${u}`),
      cell('Объём', `≈ ${volume}`, 'Точен только для замкнутых (водонепроницаемых) моделей'),
    ),
    d.assumed
      ? h('p', { class: 'pv-info' }, u === 'мм'
        ? `В формате ${FORMATS[format].label} единицы не записаны — показано в миллиметрах, как принято для 3D-печати.`
        : `В формате ${FORMATS[format].label} единицы не записаны — размеры в единицах модели.`)
      : '',
  );
}

export async function renderPreview(container, file, format) {
  container.replaceChildren(h('div', { class: 'pv-loading' }, h('span', { class: 'spinner' }), 'Готовим предпросмотр…'));
  const cleanups = [];
  const show = (...nodes) => container.replaceChildren(...nodes);
  const info = (text) => h('p', { class: 'pv-info' }, text);
  const module = FORMATS[format]?.module;

  try {
    if (module === 'image') {
      let blob = file;
      if (!NATIVE_IMAGES.has(format)) {
        const { decodeImage, drawToCanvas } = await import('./converters/image.js');
        const src = await decodeImage(file, format);
        blob = await canvasToBlob(drawToCanvas(src, { maxSide: 2400 }), 'image/png');
      }
      const url = URL.createObjectURL(blob);
      cleanups.push(() => URL.revokeObjectURL(url));
      const img = h('img', { class: 'pv-image', src: url, alt: file.name, decoding: 'async' });
      const meta = info('');
      img.addEventListener('load', () => (meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatSize(file.size)}`));
      show(h('div', { class: 'pv-checker' }, img), meta);
    } else if (format === 'pdf') {
      const { openPdf, renderPage } = await import('./converters/pdf.js');
      const doc = await openPdf(file);
      cleanups.push(() => doc.destroy());
      const pages = h('div', { class: 'pv-pages' });
      const meta = info(`Страниц: ${doc.numPages} · ${formatSize(file.size)}`);
      show(meta, pages);
      let next = 1;
      const more = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Показать ещё страницы');
      const renderBatch = async (count) => {
        more.disabled = true;
        const last = Math.min(doc.numPages, next + count - 1);
        for (; next <= last; next++) {
          const canvas = await renderPage(doc, next, 1.4);
          canvas.className = 'pv-page';
          pages.append(canvas);
        }
        more.disabled = false;
        if (next > doc.numPages) more.remove();
        else if (!more.isConnected) container.append(more);
      };
      more.addEventListener('click', () => renderBatch(5));
      await renderBatch(3);
    } else if (module === 'doc' && format !== 'txt') {
      const { toSafeHtml } = await import('./converters/document.js');
      const html = await toSafeHtml(file, format);
      show(sandboxFrame(previewDocument(html)), info(`${FORMATS[format].label} · ${formatSize(file.size)} · скрипты и внешние ресурсы отключены`));
    } else if (format === 'txt' || format === 'json' && file.size > 5_000_000) {
      const text = await readText(file.slice(0, TEXT_LIMIT));
      show(h('pre', { class: 'pv-text' }, text), info(file.size > TEXT_LIMIT ? `Показано начало файла (${formatSize(TEXT_LIMIT)} из ${formatSize(file.size)})` : formatSize(file.size)));
    } else if (module === 'sheet') {
      const { readWorkbook, sheetTable, getXLSX } = await import('./converters/sheet.js');
      const XLSX = await getXLSX();
      const wb = await readWorkbook(file, format);
      const frameBox = h('div', { class: 'pv-sheet' });
      const tabs = h('div', { class: 'pv-tabs', role: 'tablist' });
      const open = (name) => {
        for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.name === name));
        frameBox.replaceChildren(sandboxFrame(previewDocument(sheetTable(XLSX, wb.Sheets[name], 500), 'body{max-width:none;font-size:13px}td{white-space:nowrap}')));
      };
      for (const name of wb.SheetNames) {
        tabs.append(h('button', { type: 'button', role: 'tab', class: 'pv-tab', dataset: { name }, onclick: () => open(name) }, name));
      }
      show(wb.SheetNames.length > 1 ? tabs : '', frameBox, info(`Листов: ${wb.SheetNames.length} · показаны первые 500 строк`));
      open(wb.SheetNames[0]);
    } else if (module === 'model') {
      const { createViewer } = await import('./converters/model.js');
      const stage = h('div', { class: 'pv-3d' });
      // Сцена должна быть в DOM (нужен размер), а индикатор загрузки висит поверх неё
      const loading = h('div', { class: 'pv-loading pv-overlay' }, h('span', { class: 'spinner' }), 'Загружаем модель…');
      show(h('div', { class: 'pv-3d-wrap' }, stage, loading));
      const viewer = await createViewer(stage, file, format);
      loading.remove();
      cleanups.push(() => viewer.dispose());
      container.append(
        dimsBlock(viewer.dims, format),
        h('div', { class: 'pv-toolbar' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => viewer.setBounds(e.target.checked) }), 'Габариты'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => viewer.setWireframe(e.target.checked) }), 'Каркас'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => viewer.resetView() }, 'Сбросить вид'),
        ),
        info(`Вершин: ${viewer.stats.vertices.toLocaleString('ru')} · Треугольников: ${viewer.stats.triangles.toLocaleString('ru')} · ${formatSize(file.size)}`),
        info('Вращайте мышью или пальцем, колесо — масштаб, правая кнопка — сдвиг.'),
      );
    } else {
      show(info('Для этого формата предпросмотр недоступен.'));
    }
  } catch (e) {
    console.error(e);
    show(h('p', { class: 'pv-error' }, `Не удалось показать файл: ${e.message || e}`));
  }

  return () => {
    for (const fn of cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    container.replaceChildren();
  };
}
