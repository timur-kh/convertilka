// Инструменты предпросмотра: поворот изображения/видео на 90° и покадровое перемещение по видео.
import { h } from './util.js';

const norm = (deg) => ((deg % 360) + 360) % 360;

/**
 * Кнопки «повернуть влево / вправо». Поворот хранится в edit.rotate (0, 90, 180, 270 — по часовой)
 * и применяется при конвертации. Предпросмотр поворачивается сразу — через CSS, без перекодирования.
 * target — <img> или <video>; onChange() — сообщить, что правки изменились.
 */
export function rotateControl(target, edit, onChange) {
  const label = h('span', { class: 'rot-label', 'aria-live': 'polite' });
  const btn = (dir, title, glyph) => {
    const b = h('button', { type: 'button', class: 'icon-btn rot-btn', title, 'aria-label': title }, glyph);
    b.addEventListener('click', () => {
      edit.rotate = norm((edit.rotate || 0) + dir * 90);
      apply();
      onChange?.();
    });
    return b;
  };
  const el = h('div', { class: 'rot-tools' }, btn(-1, 'Повернуть влево на 90°', '↺'), btn(1, 'Повернуть вправо на 90°', '↻'), label);

  function apply() {
    const deg = norm(edit.rotate || 0);
    // Повёрнутое на 90° изображение должно поместиться в тот же прямоугольник: уменьшаем пропорционально
    const w = target.offsetWidth, hh = target.offsetHeight;
    const k = deg % 180 && w && hh ? Math.min(w / hh, hh / w) : 1;
    target.style.transform = deg ? `rotate(${deg}deg) scale(${k})` : '';
    label.textContent = deg ? `повёрнуто на ${deg}°` : '';
    label.hidden = !deg;
  }
  // Размеры элемента известны только после загрузки
  target.addEventListener('load', apply);
  target.addEventListener('loadedmetadata', apply);
  const ro = new ResizeObserver(apply);
  ro.observe(target);
  apply();
  return { el, apply, dispose: () => ro.disconnect() };
}

// Шаги масштаба — множители относительно «по размеру окна» (1)
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/**
 * Панель масштаба «− 100% + ⤢»: кнопки шагами, щелчок по проценту — снова «по размеру окна»,
 * Ctrl + колесо мыши над документом (bindWheel). onChange(z) — применить множитель z (1 = по размеру окна).
 * label() — подпись после применения: реальный масштаб, например «35%» (100% — натуральный размер).
 */
export function zoomControl(onChange, { label = (z) => `${Math.round(z * 100)}%`, max = 8 } = {}) {
  const steps = ZOOM_STEPS.filter((s) => s <= max);
  let z = 1;
  const out = h('button', { type: 'button', class: 'zoom-val', title: 'По размеру окна', 'aria-label': 'Масштаб: вернуть по размеру окна' }, '');
  const minus = h('button', { type: 'button', class: 'icon-btn zoom-btn', title: 'Уменьшить (Ctrl + колесо мыши)', 'aria-label': 'Уменьшить' }, '−');
  const plus = h('button', { type: 'button', class: 'icon-btn zoom-btn', title: 'Увеличить (Ctrl + колесо мыши)', 'aria-label': 'Увеличить' }, '+');
  const fit = h('button', { type: 'button', class: 'icon-btn zoom-btn', title: 'По размеру окна', 'aria-label': 'По размеру окна' }, '⤢');
  const el = h('div', { class: 'zoom-tools', role: 'group', 'aria-label': 'Масштаб' }, minus, out, plus, fit);

  const refresh = () => {
    out.textContent = label(z);
    minus.disabled = z <= steps[0];
    plus.disabled = z >= steps[steps.length - 1];
    fit.disabled = z === 1;
  };
  const set = (nz) => {
    z = Math.min(steps[steps.length - 1], Math.max(steps[0], nz));
    onChange(z);
    requestAnimationFrame(refresh); // подпись — после того как раскладка обновилась
  };
  // Ближайший шаг больше (или меньше) текущего значения
  const step = (dir) => {
    const next = dir > 0 ? steps.find((s) => s > z + 1e-6) : [...steps].reverse().find((s) => s < z - 1e-6);
    if (next !== undefined) set(next);
  };
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  out.addEventListener('click', () => set(1));
  fit.addEventListener('click', () => set(1));

  /** Ctrl + колесо (и жест «щипок» на тачпаде — браузер присылает его так же) над target. */
  const bindWheel = (target) => {
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => target.removeEventListener('wheel', onWheel);
  };
  requestAnimationFrame(refresh);
  return { el, set, get: () => z, refresh, bindWheel };
}

/**
 * Простая панель «▶ / ⏸ + полоса времени» — вместо встроенных кнопок плеера, когда видео повёрнуто
 * (встроенные кнопки поворачиваются вместе с видео и становятся неудобными).
 */
export function playBar(player) {
  const btn = h('button', { type: 'button', class: 'icon-btn play-btn', 'aria-label': 'Воспроизвести' }, '▶');
  const range = h('input', { type: 'range', class: 'play-range', min: '0', max: '1000', value: '0', 'aria-label': 'Позиция в видео' });
  btn.addEventListener('click', () => (player.paused ? player.play().catch(() => {}) : player.pause()));
  const sync = () => {
    btn.textContent = player.paused ? '▶' : '⏸';
    btn.setAttribute('aria-label', player.paused ? 'Воспроизвести' : 'Пауза');
    if (document.activeElement !== range && player.duration) range.value = String(Math.round((player.currentTime / player.duration) * 1000));
  };
  range.addEventListener('input', () => player.duration && (player.currentTime = (range.value / 1000) * player.duration));
  for (const ev of ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata']) player.addEventListener(ev, sync);
  return { el: h('div', { class: 'play-bar' }, btn, range) };
}

const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

/**
 * Покадровое перемещение: «‹ кадр», «кадр ›» и клавиши «,» / «.» (как в YouTube).
 * getFps() — частота кадров (известна после чтения файла; до этого — 30).
 */
export function frameStepper(player, getFps) {
  const info = h('span', { class: 'frame-info' }, 'кадр 1');
  const step = (dir) => {
    const fps = getFps() || 30;
    player.pause();
    const dur = Number.isFinite(player.duration) ? player.duration : Infinity;
    // Встаём в середину нужного кадра — так браузер не промахивается на границе соседних кадров
    const frame = Math.max(0, frameOf(player.currentTime, fps) + dir);
    player.currentTime = Math.min(dur - 0.5 / fps, (frame + 0.5) / fps);
  };
  const frameOf = (t, fps) => Math.floor(t * fps + 1e-6);
  const update = () => {
    const fps = getFps() || 30;
    info.textContent = `кадр ${frameOf(player.currentTime, fps) + 1} · ${fmtTime(player.currentTime)}`;
  };
  const btn = (dir, text, title) => {
    const b = h('button', { type: 'button', class: 'btn btn-ghost btn-sm frame-btn', title, 'aria-label': title }, text);
    b.addEventListener('click', () => step(dir));
    return b;
  };
  const el = h('div', { class: 'frame-tools' },
    btn(-1, '‹ кадр', 'Предыдущий кадр (клавиша ,)'),
    info,
    btn(1, 'кадр ›', 'Следующий кадр (клавиша .)'));
  player.addEventListener('seeked', update);
  player.addEventListener('timeupdate', update);
  player.addEventListener('loadedmetadata', update);
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!player.isConnected) return;
    if (e.key === ',' || e.key === 'б') { e.preventDefault(); step(-1); }
    else if (e.key === '.' || e.key === 'ю') { e.preventDefault(); step(1); }
  };
  document.addEventListener('keydown', onKey);
  return { el, update, dispose: () => document.removeEventListener('keydown', onKey) };
}
