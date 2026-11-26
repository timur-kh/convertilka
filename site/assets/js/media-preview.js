// Предпросмотр видео и звука: плеер, звуковые дорожки (волна, громкость, удаление),
// выбор кодеков и сжатие видео до нужного размера.
//
// ctx (только для исходного файла, не для результата):
//   edit           — объект правок файла { videoCodec, audioCodec, tracks: [{keep, gain}], compress }
//   target         — выбранный формат результата
//   onEditChange() — сообщить, что правки изменились
//   onTargetChange(fmt) — попросить сменить формат результата
import { h, formatSize } from './util.js';
import { FORMATS } from './formats.js';

const LANGS = { rus: 'русский', ru: 'русский', eng: 'английский', en: 'английский', ukr: 'украинский', uk: 'украинский', deu: 'немецкий', ger: 'немецкий', fra: 'французский', fre: 'французский', spa: 'испанский', ita: 'итальянский', jpn: 'японский', chi: 'китайский', zho: 'китайский', kor: 'корейский', por: 'португальский', pol: 'польский', tur: 'турецкий' };
const LAYOUTS = { mono: 'моно', stereo: 'стерео', '5.1': '5.1', '5.1(side)': '5.1', '7.1': '7.1' };
const CODEC_NAMES = { h264: 'H.264', hevc: 'H.265', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', mpeg4: 'MPEG-4', prores: 'ProRes', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC-3', eac3: 'E-AC-3', pcm_s16le: 'PCM', pcm_s24le: 'PCM 24', wmav2: 'WMA', amr_nb: 'AMR' };
const codecName = (c) => CODEC_NAMES[c] || String(c || '').toUpperCase();
const COMPRESS_TARGETS = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi']);

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? `${hh}:${String(mm).padStart(2, '0')}` : `${mm}`) + `:${String(ss).padStart(2, '0')}`;
}

// ---------- Громкость в децибелах ----------
const DB_FLOOR = -60; // ниже — тишина
const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fromDb = (db) => 10 ** (db / 20);
const fmtDb = (db) => (Number.isFinite(db) ? `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(Math.round(db))} дБ` : '−∞ дБ');
/** Высота столбика 0..1 по шкале децибел: тихий звук тоже виден, как в звуковых редакторах. */
const dbHeight = (amp) => Math.max(0, Math.min(1, (toDb(amp) - DB_FLOOR) / -DB_FLOOR));

// ---------- График звуковой дорожки ----------
/**
 * Огибающая дорожки в децибелах со шкалой времени и пиковым уровнем.
 * Учитывает усиление (где звук упрётся в 0 дБ — красным) и позицию воспроизведения.
 */
function createWaveform(peaks, { tall = false, onSeek, duration = 0 } = {}) {
  const canvas = h('canvas', { class: `wave${tall ? ' wave-tall' : ''}`, 'aria-hidden': 'true' });
  const peak = peaks.reduce((m, v) => Math.max(m, v), 0);
  const peakLabel = h('span', { class: 'wave-peak' });
  const ruler = h('div', { class: 'wave-ruler' },
    h('span', {}, '0:00'), duration ? h('span', {}, formatTime(duration / 2)) : '', h('span', {}, duration ? formatTime(duration) : ''), peakLabel);
  const el = h('div', { class: 'wave-box' }, canvas, ruler,
    peaks.phaseCancel ? h('p', { class: 'wave-warn' }, '⚠ Левый и правый каналы в противофазе: в наушниках и колонках звук нормальный, но при сведении в моно (галочка «Звук в моно», моно-MP3, телефонный динамик) он почти исчезнет. Так бывает с некоторыми микрофонами и звуковыми картами.') : '');
  let gain = 1, progress = 0, dimmed = false;
  const css = getComputedStyle(document.documentElement);
  const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const updatePeak = () => {
    const db = toDb(peak * gain);
    peakLabel.textContent = peak ? `пик ${fmtDb(db)}${db > 0 ? ' — перегрузка' : ''}` : 'тишина';
    peakLabel.classList.toggle('over', db > 0);
  };
  const draw = () => {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const accent = color('--accent', '#4f46e5');
    const muted = color('--border', '#ccc');
    const err = color('--err', '#dc2626');
    const mid = hgt / 2, step = 3, bar = 2;
    // Вспомогательные линии −6/−20 дБ — чтобы на глаз оценивать громкость
    ctx.fillStyle = muted;
    for (const db of [-6, -20]) {
      const y = ((db - DB_FLOOR) / -DB_FLOOR) * (mid - 1);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, Math.round(mid - y), w, 1);
      ctx.fillRect(0, Math.round(mid + y), w, 1);
    }
    ctx.globalAlpha = 1;
    for (let x = 0; x < w; x += step) {
      // В столбик попадает максимум из всех пиков, приходящихся на эти пиксели
      const i0 = Math.floor((x / w) * peaks.length), i1 = Math.max(i0 + 1, Math.floor(((x + step) / w) * peaks.length));
      let p = 0;
      for (let i = i0; i < Math.min(i1, peaks.length); i++) p = Math.max(p, peaks[i]);
      const amp = p * gain;
      const v = Math.max(0.015, dbHeight(amp)) * (mid - 1);
      ctx.fillStyle = dimmed ? muted : amp > 1 ? err : x / w <= progress ? accent : color('--g-audio-soft', 'rgba(99,102,241,.45)');
      ctx.fillRect(x, mid - v, bar, v * 2);
    }
    if (progress > 0 && progress < 1 && !dimmed) {
      ctx.fillStyle = color('--text', '#111');
      ctx.fillRect(Math.round(progress * w), 0, 1, hgt);
    }
  };
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  if (onSeek) {
    canvas.classList.add('seekable');
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      onSeek((e.clientX - r.left) / r.width);
    });
  }
  updatePeak();
  return {
    el,
    peak,
    setGain(g) { gain = g; updatePeak(); draw(); },
    setProgress(p) { progress = p; draw(); },
    setDimmed(d) { dimmed = d; el.classList.toggle('dimmed', d); draw(); },
    /** Пояснение под графиком (например, «дорожка беззвучная»). */
    setNote(text, kind = 'info') {
      el.querySelector('.wave-note')?.remove();
      if (text) el.append(h('p', { class: `wave-note ${kind}` }, text));
    },
    dispose() { ro.disconnect(); },
  };
}

/**
 * График пустой — проверяем по всем отсчётам (volumedetect), действительно ли в дорожке нет звука,
 * и объясняем, что это значит. Если звук всё-таки есть (очень тихий), показываем его уровень.
 */
async function checkSilence(wave, measure, duration) {
  if (wave.peak > 0.001) return; // выше −60 дБ график виден сам
  wave.setNote('График почти пустой — проверяем всю дорожку…');
  let peak = 0;
  try {
    peak = await measure();
  } catch {
    wave.setNote('');
    return;
  }
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  if (db <= -90) {
    const mins = duration ? `все ${formatTime(duration)}` : 'вся запись';
    wave.setNote(`В дорожке нет звука: ${mins} — цифровая тишина (проверено по всем отсчётам). Так бывает, когда программа записи создаёт звуковую дорожку, но ни микрофон, ни звук компьютера не были включены (в OBS: «Настройки → Аудио»). Беззвучную дорожку можно удалить — файл станет немного меньше.`, 'silent');
  } else {
    wave.setNote(`Звук есть, но очень тихий: пик ${fmtDb(db)}. Нажмите «Нормализовать», чтобы сделать громче.`, 'quiet');
  }
}

/** Пики небольших аудиофайлов считает сам браузер (быстро, без загрузки FFmpeg). */
async function browserPeaks(file, points) {
  if (file.size > 25 * 1024 * 1024) return null; // большие файлы — через FFmpeg, чтобы не съесть память
  try {
    const ctx = new OfflineAudioContext(1, 1, 8000);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    // По каждому отсчёту — максимум из всех каналов (не сумма: каналы в противофазе взаимно погасились бы)
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    const mixed = chans.length > 1 ? Float32Array.from(chans[0], (v, i) => chans.reduce((m, ch) => (Math.abs(ch[i]) > Math.abs(m) ? ch[i] : m), v)) : chans[0];
    const media = await import('./converters/media.js');
    const peaks = media.peaksFromPcm(mixed, points, 1);
    if (chans.length === 2) {
      const inter = new Float32Array(chans[0].length * 2);
      for (let i = 0; i < chans[0].length; i++) {
        inter[2 * i] = chans[0][i];
        inter[2 * i + 1] = chans[1][i];
      }
      peaks.phaseCancel = media.phaseCancels(inter);
    }
    return { peaks, duration: buf.duration, channels: buf.numberOfChannels, exact: true };
  } catch {
    return null;
  }
}

// ---------- Живое изменение громкости в плеере ----------
function liveGain(player) {
  try {
    const ac = new AudioContext();
    const node = ac.createGain();
    ac.createMediaElementSource(player).connect(node).connect(ac.destination);
    player.addEventListener('play', () => ac.resume().catch(() => {}));
    return { set: (g) => (node.gain.value = g), dispose: () => ac.close().catch(() => {}) };
  } catch {
    return { set() {}, dispose() {} };
  }
}

// ---------- Главная функция ----------
export async function renderMedia(container, file, format, ctx, cleanups, show, info) {
  const isVideo = FORMATS[format].group === 'video';
  const edit = ctx?.edit || null;
  const url = URL.createObjectURL(file);
  const player = h(isVideo ? 'video' : 'audio', { class: isVideo ? 'pv-video' : 'pv-audio', controls: true, preload: 'metadata', playsinline: true });
  cleanups.push(() => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    URL.revokeObjectURL(url);
  });
  const meta = info(formatSize(file.size));
  let playable = true;
  player.addEventListener('error', () => {
    playable = false;
    player.replaceWith(h('div', { class: 'pv-nomedia' },
      h('b', {}, `Браузер не умеет воспроизводить ${FORMATS[format].label}`),
      h('span', {}, 'Это не мешает конвертации и правкам — результат можно будет послушать.')));
  }, { once: true });
  player.src = url;

  const tracksBox = h('div', { class: 'mx-section' });
  const extra = h('div', { class: 'mx' });
  const waves = []; // волны для синхронизации с плеером
  let gainNode = null;

  // Частота кадров станет известна после чтения файла; до этого покадровый шаг считает 30 к/с
  let knownFps = 0;
  if (isVideo) {
    const { rotateControl, frameStepper, playBar } = await import('./view-tools.js');
    const tools = h('div', { class: 'pv-tools' });
    const stepper = frameStepper(player, () => knownFps);
    cleanups.push(stepper.dispose);
    tools.append(stepper.el);
    const bar = playBar(player);
    // Поворот — только для исходного файла с правками (не для просмотра результата)
    const syncControls = () => {
      const rotated = !!edit?.rotate;
      player.controls = !rotated; // встроенные кнопки повернулись бы вместе с видео
      bar.el.hidden = !rotated;
    };
    if (edit) {
      const rot = rotateControl(player, edit, () => { syncControls(); ctx.onEditChange(); });
      cleanups.push(rot.dispose);
      tools.prepend(rot.el);
    }
    syncControls();
    show(h('div', { class: 'pv-video-wrap pv-rotatable' }, player), bar.el, tools, meta, extra);
  } else show(h('div', { class: 'pv-audio-wrap' }, player), meta, extra);

  // Синхронизация курсора на волнах с плеером
  const sync = () => {
    const p = player.duration ? player.currentTime / player.duration : 0;
    for (const w of waves) w.setProgress(p);
  };
  let raf = 0;
  const loop = () => {
    sync();
    raf = requestAnimationFrame(loop);
  };
  player.addEventListener('play', () => (raf = requestAnimationFrame(loop)));
  player.addEventListener('pause', () => cancelAnimationFrame(raf));
  player.addEventListener('seeked', sync);
  cleanups.push(() => cancelAnimationFrame(raf), () => waves.forEach((w) => w.dispose()));

  // Громкость в плеере вживую — только для исходного файла с правками
  if (edit) {
    gainNode = liveGain(player);
    cleanups.push(() => gainNode.dispose());
  }
  const applyLive = () => {
    if (!gainNode || !edit) return;
    const t0 = edit.tracks[0] || { keep: true, gain: 1 };
    gainNode.set(t0.keep === false ? 0 : t0.gain ?? 1); // браузер играет первую дорожку
  };

  // ---- Сведения о файле (FFmpeg) ----
  const media = await import('./converters/media.js');
  let probeInfo = null;
  const status = h('p', { class: 'pv-info mx-status' }, isVideo ? 'Читаем дорожки…' : '');
  extra.append(status);
  const onStatus = (text) => (status.textContent = text);

  if (!isVideo) {
    // Аудио: волна от браузера, если получится; иначе — через FFmpeg
    let res = await browserPeaks(file, 1200);
    if (!res) {
      try {
        probeInfo = await media.probe(file, format, onStatus);
        res = { peaks: await media.audioPeaks(file, format, 0, 1200, onStatus), duration: probeInfo.duration, channels: probeInfo.audio[0]?.channels };
      } catch (e) {
        status.textContent = `Не удалось построить волну: ${e.message}`;
      }
    }
    if (res) {
      status.textContent = '';
      meta.textContent = [formatTime(res.duration), res.channels === 1 ? 'моно' : res.channels === 2 ? 'стерео' : res.channels ? `${res.channels} кан.` : '', formatSize(file.size)].filter(Boolean).join(' · ');
      const wave = createWaveform(res.peaks, { tall: true, duration: res.duration, onSeek: (p) => playable && player.duration && (player.currentTime = p * player.duration) });
      waves.push(wave);
      player.before(wave.el);
      checkSilence(wave, () => (res.exact ? Promise.resolve(0) : media.measurePeak(file, format, 0)), res.duration);
      if (edit) {
        edit.tracks[0] ||= { keep: true, gain: 1 };
        wave.setGain(edit.tracks[0].gain);
        // Пик из браузерного декодирования точный (все отсчёты); из FFmpeg — меряем отдельно
        const measurePeak = res.exact ? async () => wave.peak : () => media.measurePeak(file, format, 0);
        extra.append(h('div', { class: 'mx-section' }, h('h4', {}, 'Громкость'), volumeControl(edit.tracks[0], (g) => {
          wave.setGain(g);
          applyLive();
          ctx.onEditChange();
        }, { measurePeak })));
        applyLive();
      }
    }
  } else {
    try {
      probeInfo = await media.probe(file, format, onStatus);
      knownFps = probeInfo.video?.fps || 0;
    } catch (e) {
      status.textContent = `Не удалось прочитать дорожки: ${e.message}`;
      return;
    }
    status.remove();
    const v = probeInfo.video;
    meta.textContent = [
      formatTime(probeInfo.duration),
      v ? `${codecName(v.codec)} · ${v.width}×${v.height}${v.fps ? ` · ${Math.round(v.fps * 100) / 100} к/с` : ''}` : '',
      formatSize(file.size),
    ].filter(Boolean).join(' · ');

    // Звуковые дорожки
    tracksBox.append(h('h4', {}, `Звуковые дорожки${probeInfo.audio.length ? ` (${probeInfo.audio.length})` : ''}`));
    extra.append(tracksBox);
    if (!probeInfo.audio.length) tracksBox.append(h('p', { class: 'pv-info' }, 'В видео нет звука.'));
    if (edit) edit.tracks.length = Math.max(edit.tracks.length, probeInfo.audio.length);
    const rows = probeInfo.audio.map((a, i) => {
      const st = edit ? (edit.tracks[i] ||= { keep: true, gain: 1 }) : { keep: true, gain: 1 };
      const label = `${i + 1}. ` + [codecName(a.codec), LAYOUTS[a.layout] || (a.channels ? `${a.channels} кан.` : ''), LANGS[a.lang] || a.lang.toUpperCase(), a.title ? `«${a.title}»` : ''].filter(Boolean).join(' · ');
      const waveSlot = h('div', { class: 'wave-slot' }, h('span', { class: 'spinner' }));
      const row = h('div', { class: 'track' }, h('div', { class: 'track-head' }, h('span', { class: 'track-label' }, label)), waveSlot);
      tracksBox.append(row);
      return { a, i, st, row, waveSlot };
    });
    if (probeInfo.audio.length > 1) tracksBox.append(h('p', { class: 'pv-info' }, 'Плеер браузера проигрывает только первую дорожку, но волны и правки работают для всех.'));

    // Волны строим по очереди — каждая требует прохода FFmpeg по звуку
    for (const r of rows) {
      let wave = null;
      try {
        const peaks = await media.audioPeaks(file, format, r.i, 800);
        wave = createWaveform(peaks, { duration: probeInfo.duration, onSeek: (p) => playable && player.duration && (player.currentTime = p * player.duration) });
        waves.push(wave);
        r.waveSlot.replaceChildren(wave.el);
        checkSilence(wave, () => media.measurePeak(file, format, r.i), probeInfo.duration);
        wave.setGain(r.st.gain);
        wave.setDimmed(r.st.keep === false);
        sync();
      } catch {
        r.waveSlot.replaceChildren(h('span', { class: 'pv-info' }, 'волну построить не удалось'));
      }
      if (!edit) continue;
      const remove = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
      const vol = volumeControl(r.st, (g) => {
        wave?.setGain(g);
        if (r.i === 0) applyLive();
        ctx.onEditChange();
      }, { measurePeak: () => media.measurePeak(file, format, r.i) });
      const refresh = () => {
        const kept = r.st.keep !== false;
        remove.textContent = kept ? 'Удалить' : 'Вернуть';
        r.row.classList.toggle('removed', !kept);
        vol.hidden = !kept;
        wave?.setDimmed(!kept);
      };
      remove.addEventListener('click', () => {
        r.st.keep = r.st.keep === false;
        refresh();
        if (r.i === 0) applyLive();
        ctx.onEditChange();
      });
      r.row.querySelector('.track-head').append(remove);
      r.row.append(vol);
      refresh();
    }
    applyLive();
  }

  if (!edit) return;

  // ---- Кодеки ----
  const opts = media.codecOptions(ctx.target);
  const codecBox = h('div', { class: 'mx-section mx-codecs' });
  const compressedNote = h('p', { class: 'pv-info', hidden: true }, 'Видеокодек и битрейт заданы сжатием до размера.');
  const makeSelect = (label, list, key) => {
    if (!list.length) return '';
    if (!list.some((o) => o.id === edit[key])) edit[key] = 'auto';
    const sel = h('select', { 'aria-label': label }, list.map((o) => h('option', { value: o.id, selected: o.id === edit[key] }, o.label)));
    sel.addEventListener('change', () => {
      edit[key] = sel.value;
      ctx.onEditChange();
    });
    return h('label', { class: 'mx-field' }, h('span', {}, label), sel);
  };
  const vSel = isVideo ? makeSelect('Видеокодек', opts.video, 'videoCodec') : '';
  // H.265 / AV1 / VP9 кодирует браузер — отключаем те, что недоступны на этом устройстве
  if (vSel && probeInfo?.video) {
    media.webCodecsSupport(probeInfo.video.width, probeInfo.video.height).then((sup) => {
      for (const o of vSel.querySelector('select').options) {
        if (o.value in sup && o.value !== 'avc' && !sup[o.value]) {
          o.disabled = true;
          o.textContent += ' — недоступно в этом браузере';
        }
      }
    });
  }
  const aSel = makeSelect('Аудиокодек', opts.audio, 'audioCodec');
  if (vSel || aSel) {
    codecBox.append(h('h4', {}, `Кодеки в ${FORMATS[ctx.target]?.label || ctx.target}`), h('div', { class: 'mx-row' }, vSel, aSel), compressedNote,
      h('p', { class: 'pv-info' }, '«Авто» — без перекодирования, если исходный кодек подходит к формату, иначе самый совместимый.'));
    extra.append(codecBox);
  }

  // ---- Сжатие до размера (видео) ----
  // Пока показывается только на странице «Сжать видео» (/compress-video/): там это весь инструмент.
  // Чтобы вернуть блок везде — уберите проверку dataset.tool.
  if (isVideo && probeInfo?.video && document.body.dataset.tool === 'compress-video') {
    extra.append(compressPanel(probeInfo, edit, ctx, media, () => {
      const on = !!edit.compress;
      compressedNote.hidden = !on;
      const sel = vSel && vSel.querySelector('select');
      if (sel) sel.disabled = on;
    }));
  }
}

/**
 * Громкость в децибелах: −30…+30 дБ (×0,03…×32). measurePeak() → точный пик 0..1 для «Нормализовать».
 */
function volumeControl(st, onChange, { measurePeak } = {}) {
  const MIN = -30, MAX = 30;
  const val = h('output', { class: 'vol-value' });
  const reset = h('button', { class: 'link-btn', type: 'button' }, 'сбросить');
  const norm = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Поднять громкость до максимума без перегрузки (пик −1 дБ)' }, 'Нормализовать');
  const dbNow = () => Math.max(MIN, Math.min(MAX, Math.round(toDb(st.gain ?? 1) * 2) / 2));
  const range = h('input', { type: 'range', min: String(MIN), max: String(MAX), step: '0.5', value: String(dbNow()), 'aria-label': 'Громкость дорожки, дБ' });
  const show = () => {
    const db = Number(range.value);
    const k = fromDb(db);
    val.textContent = db === 0 ? '0 дБ' : `${fmtDb(db)} (×${k >= 10 ? Math.round(k) : k.toFixed(k < 1 ? 2 : 1).replace('.', ',')})`;
    reset.hidden = db === 0;
  };
  const set = (db) => {
    range.value = String(db);
    st.gain = Number(range.value) === 0 ? 1 : fromDb(Number(range.value));
    show();
    onChange(st.gain);
  };
  range.addEventListener('input', () => set(Number(range.value)));
  reset.addEventListener('click', () => set(0));
  if (measurePeak) {
    norm.addEventListener('click', async () => {
      norm.disabled = true;
      const label = norm.textContent;
      norm.textContent = 'Измеряем…';
      try {
        const peak = await measurePeak();
        if (!(peak > 0)) throw new Error('тишина');
        set(Math.max(MIN, Math.min(MAX, Math.floor((-1 - toDb(peak)) * 2) / 2))); // пик → −1 дБ
      } catch {
        norm.textContent = 'не удалось';
        setTimeout(() => (norm.textContent = label), 1500);
      } finally {
        norm.disabled = false;
        if (norm.textContent === 'Измеряем…') norm.textContent = label;
      }
    });
  }
  show();
  return h('div', { class: 'vol' }, h('span', { class: 'vol-icon', 'aria-hidden': 'true' }, '🔊'), range, val, reset, measurePeak ? norm : '');
}

/**
 * Панель «Сжать до размера»: нужный размер → кодек и тонкие настройки → варианты → выбор.
 * Настройки панели хранятся в edit.cs, выбранный вариант — в edit.compress (его читает конвертер).
 */
function compressPanel(info, edit, ctx, media, onApplied) {
  const sizeMB = info.size / 1048576;
  const cs = (edit.cs ||= { targetMB: '', codec: 'avc', fps: 0, gop: 2, hw: 'auto', akbps: 'auto', mono: false });
  const v = info.video;

  // --- Размер
  const input = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', class: 'mx-mb', placeholder: String(Math.max(1, Math.round(sizeMB / 4))), 'aria-label': 'Нужный размер в мегабайтах', value: cs.targetMB || '' });
  const go = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Подобрать');
  const clear = h('button', { class: 'link-btn', type: 'button', hidden: !edit.compress }, 'не сжимать');
  const out = h('div', { class: 'mx-variants' });

  // --- Кодек: карточки с пояснением; недоступные отключаются после проверки браузера
  const codecBtns = media.COMPRESS_CODECS.map((c) => h('button', { type: 'button', class: 'codec-opt', dataset: { codec: c.id }, 'aria-pressed': String(cs.codec === c.id) },
    h('b', {}, c.label), h('span', {}, c.hint)));
  const codecNote = h('p', { class: 'pv-info' });
  const codecRow = h('div', { class: 'codec-row', role: 'group', 'aria-label': 'Кодек' }, codecBtns);
  media.webCodecsSupport(v.width, v.height, 3000).then((sup) => {
    const off = [];
    for (const b of codecBtns) {
      const id = b.dataset.codec;
      // H.264 есть всегда: если браузер не умеет, кодирует FFmpeg (медленнее)
      if (id !== 'avc' && !sup[id]) {
        b.disabled = true;
        b.title = 'Ваш браузер или видеокарта не умеют кодировать в этот формат';
        off.push(media.COMPRESS_CODECS.find((c) => c.id === id).label);
        if (cs.codec === id) setCodec('avc');
      }
    }
    codecNote.textContent = [
      sup.avc ? 'H.264 кодирует видеокарта или браузер — быстро.' : 'H.264 кодирует FFmpeg на процессоре — медленнее.',
      off.length ? `Недоступно в этом браузере: ${off.join(', ')}. Обычно они есть в свежих Chrome и Edge${off.includes('H.265 (HEVC)') ? '; H.265 — только с видеокартой, которая умеет его кодировать' : ''}.` : '',
    ].filter(Boolean).join(' ');
  });

  // --- Тонкие настройки
  const sel = (label, key, options) => {
    const s = h('select', {}, options.map(([val, text]) => h('option', { value: String(val), selected: String(cs[key]) === String(val) }, text)));
    s.addEventListener('change', () => {
      cs[key] = /^\d+$/.test(s.value) ? Number(s.value) : s.value;
      changed();
    });
    return h('label', { class: 'mx-field' }, h('span', {}, label), s);
  };
  const mono = h('input', { type: 'checkbox', checked: cs.mono });
  mono.addEventListener('change', () => {
    cs.mono = mono.checked;
    changed();
  });
  const fpsSrc = v.fps ? Math.round(v.fps * 100) / 100 : 0;
  const fine = h('details', { class: 'mx-fine' },
    h('summary', {}, 'Тонкие настройки'),
    h('div', { class: 'mx-fine-grid' },
      sel('Частота кадров', 'fps', [[0, fpsSrc ? `как в оригинале (${fpsSrc})` : 'как в оригинале'], ...[30, 25, 24, 15].filter((f) => !fpsSrc || f < fpsSrc).map((f) => [f, `${f} к/с${f <= 15 ? ' — для презентаций и записей экрана' : ''}`])]),
      sel('Ключевой кадр', 'gop', [[1, 'каждую секунду — точная перемотка'], [2, 'каждые 2 с — обычно'], [5, 'каждые 5 с — файл чуть меньше'], [10, 'каждые 10 с — для статичных записей']]),
      sel('Кодирование', 'hw', [['auto', 'автоматически'], ['prefer-hardware', 'видеокарта — быстрее'], ['prefer-software', 'процессор — стабильнее качество']]),
      sel('Звук', 'akbps', [['auto', 'автоматически по бюджету'], [64, '64 кбит/с — речь'], [96, '96 кбит/с'], [128, '128 кбит/с — музыка'], [160, '160 кбит/с']]),
      h('label', { class: 'check' }, mono, 'Звук в моно — меньше размер, для речи не заметно'),
    ),
    h('p', { class: 'pv-info' }, 'Чем меньше частота кадров и чем реже ключевые кадры, тем больше битрейта достаётся каждой картинке. «Кодирование» влияет только на H.264, H.265, AV1 и VP9 через браузер.'));

  function setCodec(id) {
    cs.codec = id;
    for (const b of codecBtns) b.setAttribute('aria-pressed', String(b.dataset.codec === id));
    // Кодек должен помещаться в формат файла: H.265 — в MP4/MOV/MKV, VP9 — в WebM и т.д.
    const allowed = media.COMPRESS_CODECS.find((c) => c.id === id).containers;
    if (!allowed.includes(ctx.target)) ctx.onTargetChange(allowed[0]);
  }
  for (const b of codecBtns) b.addEventListener('click', () => {
    setCodec(b.dataset.codec);
    changed();
  });

  let chosenHeight = edit.compress?.height || 0;
  function apply(variant, target) {
    edit.compress = { targetMB: target, height: variant.height, codec: cs.codec, vkbps: variant.vkbps, akbps: variant.akbps, fps: cs.fps || 0, gop: cs.gop, hw: cs.hw, mono: cs.mono };
    chosenHeight = variant.height;
    clear.hidden = false;
    onApplied();
    ctx.onEditChange();
  }

  function render() {
    const target = Number(input.value);
    cs.targetMB = input.value;
    out.replaceChildren();
    if (!(target > 0)) return;
    const kept = info.audio.filter((_, i) => edit.tracks[i]?.keep !== false).length;
    const plan = media.planCompression(info, target, kept, cs);
    if (!plan.ok) {
      out.append(h('p', { class: 'mx-warn' }, plan.message));
      return;
    }
    const b = plan.budget;
    out.append(h('p', { class: 'pv-info' }, `Длительность ${formatTime(info.duration)}: на всё видео ${b.totalKbps} кбит/с — ${b.vkbps} на изображение${kept ? ` и ${b.akbps} на звук${kept > 1 ? ` (×${kept} дорожки)` : ''}` : ''}, ${b.fps} к/с. Выберите вариант:`));
    let chosenCard = null;
    for (const variant of plan.variants) {
      const card = h('button', { type: 'button', class: `variant q${variant.quality.level}`, 'aria-pressed': 'false' },
        h('span', { class: 'variant-top' }, h('b', {}, variant.title), variant.recommended ? h('span', { class: 'variant-tag' }, 'рекомендуем') : ''),
        h('span', { class: 'variant-q' }, `качество: ${variant.quality.label}`),
        h('span', { class: 'variant-hint' }, variant.hint));
      card.addEventListener('click', () => {
        for (const x of out.querySelectorAll('.variant')) {
          x.classList.toggle('chosen', x === card);
          x.setAttribute('aria-pressed', String(x === card));
        }
        apply(variant, target);
      });
      out.append(card);
      if (edit.compress && variant.height === chosenHeight) chosenCard = card;
    }
    // Настройки поменялись после выбора — выбор сохраняем, пересчитав битрейт
    if (chosenCard) chosenCard.click();
  }
  function changed() {
    if (Number(input.value) > 0) render();
  }

  go.addEventListener('click', render);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && render());
  input.addEventListener('input', () => (cs.targetMB = input.value));
  clear.addEventListener('click', () => {
    edit.compress = null;
    chosenHeight = 0;
    clear.hidden = true;
    out.querySelectorAll('.variant').forEach((x) => x.classList.remove('chosen'));
    onApplied();
    ctx.onEditChange();
  });
  if (cs.targetMB) render();
  onApplied();
  return h('div', { class: 'mx-section mx-compress' },
    h('h4', {}, 'Сжать до размера'),
    h('p', { class: 'pv-info' }, `Сейчас ${sizeMB.toFixed(1)} МБ. Сколько должно получиться?`),
    h('div', { class: 'mx-row' }, h('label', { class: 'mx-mb-wrap' }, input, h('span', {}, 'МБ')), go, clear),
    h('h5', {}, 'Кодек'), codecRow, codecNote, fine,
    out);
}
