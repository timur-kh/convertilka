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

/** ctx — правки исходного файла (сейчас используются для видео и звука), см. media-preview.js */
export async function renderPreview(container, file, format, ctx = null) {
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
      const describe = () => {
        const odd = (ctx?.edit?.rotate || 0) % 180;
        const [w, hh] = odd ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight];
        meta.textContent = `${w} × ${hh} px · ${formatSize(file.size)}`;
      };
      img.addEventListener('load', describe);
      const { rotateControl, zoomControl } = await import('./view-tools.js');
      const box = h('div', { class: 'pv-checker pv-rotatable' }, img);
      // Масштаб: 1 = по размеру окна; подпись — реальный масштаб (100% = пиксель в пиксель)
      let fitW = 0;
      const zoom = zoomControl((z) => {
        if (z === 1) {
          img.style.width = '';
          box.classList.remove('is-zoomed');
        } else {
          if (!box.classList.contains('is-zoomed')) fitW = img.offsetWidth; // ширина «по размеру окна»
          box.classList.add('is-zoomed');
          img.style.width = `${Math.round(fitW * z)}px`;
        }
      }, { label: () => (img.naturalWidth ? `${Math.round((img.offsetWidth / img.naturalWidth) * 100)}%` : '') });
      img.addEventListener('load', () => zoom.refresh());
      cleanups.push(zoom.bindWheel(box));
      const tools = h('div', { class: 'pv-tools' });
      // Поворот — только для исходного файла в редакторе (не для просмотра результата)
      if (ctx?.edit && 'rotate' in ctx.edit) {
        const rot = rotateControl(img, ctx.edit, () => { describe(); ctx.onEditChange(); });
        cleanups.push(rot.dispose);
        tools.append(rot.el);
      }
      tools.append(zoom.el);
      show(box, tools, meta);
    } else if (format === 'pdf') {
      const { openPdf, getPageCanvas } = await import('./converters/pdf.js');
      const doc = await openPdf(file);
      const p1 = (await doc.getPage(1)).getViewport({ scale: 1 });
      const { createPagedViewer } = await import('./paged-viewer.js');
      const viewer = createPagedViewer({
        count: doc.numPages,
        size: () => ({ w: p1.width, h: p1.height }), // точные пропорции придут при отрисовке
        render: (i, cssW) => getPageCanvas(doc, i, cssW * Math.min(devicePixelRatio || 1, 2)),
        realWidth: (p1.width * 96) / 72,
      });
      cleanups.push(() => viewer.dispose(), () => doc.destroy());
      show(info(`Страниц: ${doc.numPages} · ${formatSize(file.size)}`), viewer.el);
    } else if (format === 'docx') {
      // Word: страницы реального размера, как в документе
      const { renderDocx } = await import('./converters/docx-layout.js');
      const holder = h('div', { class: 'docx-holder' });
      const meta = info(formatSize(file.size));
      show(holder, meta);
      const r = await renderDocx(file, holder);
      cleanups.push(() => r.dispose());
      const p0 = r.pages[0];
      const mm = (px) => Math.round((px * 0.75) / 72 * 25.4);
      const fmt = p0 ? `${mm(p0.offsetWidth)}×${mm(p0.offsetHeight)} мм${Math.abs(mm(p0.offsetWidth) - 210) <= 1 && Math.abs(mm(p0.offsetHeight) - 297) <= 1 ? ' (A4)' : ''}` : '';
      meta.textContent = [`Страниц: ${r.pages.length}`, fmt, formatSize(file.size), 'скрипты и внешние ресурсы отключены'].filter(Boolean).join(' · ');
      // Масштаб страниц Word: 100% — реальный размер листа
      const { zoomControl } = await import('./view-tools.js');
      const zoom = zoomControl((z) => r.setZoom(z), { label: () => `${Math.round(r.zoomLevel() * 100)}%`, max: 5 });
      cleanups.push(zoom.bindWheel(r.win)); // колесо внутри документа (рамка — того же источника)
      const topRow = h('div', { class: 'pg-top' }, zoom.el);
      holder.prepend(topRow);
      // Навигация по страницам, как у PDF: «‹ Страница [N] из M ›»
      if (r.pages.length > 1) {
        const { createPageBar } = await import('./paged-viewer.js');
        const top = (p) => p.getBoundingClientRect().top + r.win.scrollY; // учитывает уменьшение (zoom)
        const bar = createPageBar(r.pages.length, (i) => r.win.scrollTo({ top: Math.max(0, top(r.pages[i - 1]) - 8) }));
        topRow.prepend(bar.el); // страницы и масштаб — в одной строке
        let raf = 0;
        const onScroll = () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const mark = r.win.scrollY + r.win.innerHeight / 3;
            let n = 1;
            r.pages.forEach((p, i) => { if (top(p) <= mark) n = i + 1; });
            bar.setCurrent(n);
          });
        };
        r.win.addEventListener('scroll', onScroll, { passive: true });
        cleanups.push(() => r.win.removeEventListener('scroll', onScroll));
      }
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
    } else if (format === 'djvu') {
      const { openDjvu } = await import('./converters/djvu.js');
      const book = await openDjvu(file);
      const { createPagedViewer } = await import('./paged-viewer.js');
      const viewer = createPagedViewer({
        count: book.pages,
        size: (i) => {
          const sz = book.sizes?.[i - 1] || book.sizes?.[0];
          return { w: sz?.width || 210, h: sz?.height || 297 };
        },
        render: async (i, cssW) => {
          const sz = book.sizes?.[i - 1];
          // Разрешение — под ширину на экране (сканы бывают 600 dpi, рисовать их целиком незачем)
          const need = sz?.width ? Math.ceil((cssW * Math.min(devicePixelRatio || 1, 2) / sz.width) * (sz.dpi || 300)) : 110;
          return (await book.page(i, { maxDpi: Math.max(72, need) })).canvas;
        },
        realWidth: book.sizes?.[0]?.width ? (book.sizes[0].width / (book.sizes[0].dpi || 300)) * 96 : 0,
      });
      cleanups.push(() => viewer.dispose(), () => book.close());
      const s0 = book.sizes?.[0];
      show(info(`Страниц: ${book.pages}${s0?.dpi ? ` · скан ${s0.dpi} dpi` : ''} · ${formatSize(file.size)}`), viewer.el);
    } else if (module === 'ebook') {
      const { readBook, bookToHtml } = await import('./converters/ebook.js');
      const book = await readBook(file, format);
      const html = await bookToHtml(book);
      show(sandboxFrame(previewDocument(html, 'body{font-family:Georgia,serif;font-size:17px}img{display:block;margin:1rem auto;max-height:420px}p{margin:.2em 0;text-indent:1.5em}h1,h2,h3{font-family:system-ui,sans-serif}')),
        info([book.author, `глав: ${book.chapters.length}`, book.images.size ? `картинок: ${book.images.size}` : '', formatSize(file.size)].filter(Boolean).join(' · ')));
    } else if (module === 'media') {
      const { renderMedia } = await import('./media-preview.js');
      await renderMedia(container, file, format, ctx, cleanups, show, info);
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
