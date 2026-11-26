// Постраничный просмотр (PDF, DjVu): сразу видны все страницы, рисуются по мере прокрутки,
// навигация «◀ [N] из M ▶» с переходом на нужную страницу.
// Страницы далеко от видимой области освобождаются — даже книга на сотни страниц не съест память.
import { h } from './util.js';
import { zoomControl } from './view-tools.js';

/**
 * opts:
 *   count — число страниц
 *   size(i) → { w, h } — пропорции страницы i (1-based), можно приблизительно
 *   render(i, cssWidth) → Promise<HTMLCanvasElement> — нарисовать страницу под ширину cssWidth
 *   realWidth — ширина первой страницы в CSS-пикселях при 100% (для подписи масштаба), необязательно
 * Возвращает { el, dispose() }.
 */
/**
 * Панель «‹ Страница [N] из M ›». go(n) — перейти на страницу n (1-based).
 * Возвращает { el, setCurrent(n) } — setCurrent вызывают при прокрутке, чтобы номер и кнопки обновлялись.
 */
export function createPageBar(count, go) {
  const input = h('input', { type: 'number', min: '1', max: String(count), value: '1', class: 'pg-input', 'aria-label': 'Номер страницы' });
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущая страница', title: 'Предыдущая страница' }, '‹');
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующая страница', title: 'Следующая страница' }, '›');
  const el = h('div', { class: 'pg-bar' }, prev, h('label', { class: 'pg-label' }, 'Страница ', input, ` из ${count}`), next);
  let current = 1;
  const clamp = (n) => Math.max(1, Math.min(count, Math.round(n) || 1));
  const jump = (n) => {
    const i = clamp(n);
    go(i);
    setCurrent(i);
  };
  function setCurrent(n) {
    current = clamp(n);
    if (document.activeElement !== input) input.value = String(current);
    prev.disabled = current <= 1;
    next.disabled = current >= count;
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jump(Number(input.value));
      input.blur();
    }
  });
  input.addEventListener('change', () => jump(Number(input.value)));
  prev.addEventListener('click', () => jump(current - 1));
  next.addEventListener('click', () => jump(current + 1));
  setCurrent(1);
  return { el, setCurrent };
}

export function createPagedViewer({ count, size, render, realWidth = 0 }) {
  const scroller = h('div', { class: 'pv-pages pv-paged' });
  // .pv-paged — position: relative, поэтому offsetTop страницы отсчитывается от начала прокрутки
  const bar = createPageBar(count, (i) => scroller.scrollTo({ top: slots[i - 1].offsetTop - 8 }));
  // Масштаб: ширина страниц = «по размеру окна» × z; после изменения страницы перерисовываются чётко
  const zoom = zoomControl((z) => applyZoom(z), {
    label: (z) => (realWidth && slots[0]?.clientWidth ? `${Math.round((slots[0].clientWidth / realWidth) * 100)}%` : `${Math.round(z * 100)}%`),
  });
  const el = h('div', { class: 'pg-viewer' }, h('div', { class: 'pg-top' }, bar.el, zoom.el), scroller);

  // Заготовки под все страницы с правильными пропорциями
  const slots = [];
  for (let i = 1; i <= count; i++) {
    const { w, h: hh } = size(i);
    const slot = h('div', { class: 'pg-slot', dataset: { page: i } }, h('span', { class: 'pg-num' }, String(i)));
    slot.style.aspectRatio = `${w} / ${hh}`;
    scroller.append(slot);
    slots.push(slot);
  }

  // Очередь отрисовки: по одной странице, ближайшие к экрану — первыми
  const state = new Map(); // i → 'queued' | 'drawing' | 'done'
  const queue = [];
  let busy = false;
  let disposed = false;
  const pump = async () => {
    if (busy || disposed) return;
    const i = queue.shift();
    if (i === undefined) return;
    if (state.get(i) !== 'queued') return pump();
    busy = true;
    state.set(i, 'drawing');
    try {
      const slot = slots[i - 1];
      const canvas = await render(i, slot.clientWidth || scroller.clientWidth - 16);
      if (disposed || state.get(i) !== 'drawing') {
        canvas.width = canvas.height = 0;
      } else {
        canvas.className = 'pv-page';
        slot.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
        slot.replaceChildren(canvas);
        state.set(i, 'done');
      }
    } catch {
      slots[i - 1].replaceChildren(h('span', { class: 'pg-num' }, `${i} — не удалось показать`));
      state.set(i, 'done');
    }
    busy = false;
    pump();
  };
  const free = (i) => {
    const slot = slots[i - 1];
    const c = slot.querySelector('canvas');
    if (c) c.width = c.height = 0;
    slot.replaceChildren(h('span', { class: 'pg-num' }, String(i)));
    state.delete(i);
  };

  // Рисуем страницы, подходящие к видимой области; далёкие — освобождаем
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = Number(e.target.dataset.page);
      if (e.isIntersecting) {
        if (!state.has(i)) {
          state.set(i, 'queued');
          queue.push(i);
        }
      } else if (state.get(i) === 'queued') state.delete(i);
    }
    pump();
  }, { root: scroller, rootMargin: '600px 0px' });
  const far = new IntersectionObserver((entries) => {
    for (const e of entries) if (!e.isIntersecting && state.get(Number(e.target.dataset.page)) === 'done') free(Number(e.target.dataset.page));
  }, { root: scroller, rootMargin: '4000px 0px' });
  for (const s of slots) {
    near.observe(s);
    far.observe(s);
  }

  let currentPage = 1;
  let fitW = 0;
  function applyZoom(z) {
    const keep = currentPage;
    // Ширина «по размеру окна» — как в CSS: вся ширина прокрутки (без полей), но не больше 900 px.
    // Считаем в пикселях: процент от прокручиваемой области при увеличении «плывёт».
    if (z === 1) scroller.style.removeProperty('--pg-w');
    else {
      if (!scroller.style.getPropertyValue('--pg-w')) fitW = Math.min(slots[0].clientWidth || scroller.clientWidth - 16, 900);
      scroller.style.setProperty('--pg-w', `${Math.round(fitW * z)}px`);
    }
    scroller.classList.toggle('is-zoomed', z > 1);
    // Нарисованные страницы — заново под новую ширину (иначе при увеличении будут мыльными)
    queue.length = 0;
    for (let i = 1; i <= count; i++) {
      if (state.get(i) === 'done') free(i);
      else state.delete(i); // «в очереди» и «рисуется» — результат старого размера отбросится
    }
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: slots[keep - 1].offsetTop - 8 });
      for (const sl of slots) {
        near.unobserve(sl);
        near.observe(sl); // наблюдатель заново сообщит, какие страницы рядом с экраном
      }
    });
  }
  const unbindWheel = zoom.bindWheel(scroller);

  // Номер текущей страницы — та, что в верхней трети видимой области
  const updateCurrent = () => {
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let lo = 0, hi = slots.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (slots[m].offsetTop <= mid) lo = m;
      else hi = m - 1;
    }
    currentPage = lo + 1;
    bar.setCurrent(currentPage);
  };
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(updateCurrent);
  }, { passive: true });
  requestAnimationFrame(updateCurrent);

  return {
    el,
    go: (n) => scroller.scrollTo({ top: slots[Math.max(1, Math.min(count, n)) - 1].offsetTop - 8 }),
    dispose() {
      disposed = true;
      unbindWheel();
      near.disconnect();
      far.disconnect();
      for (let i = 1; i <= count; i++) if (state.get(i) === 'done') free(i);
    },
  };
}
