// Видео и звук: FFmpeg, скомпилированный в WebAssembly (ffmpeg.wasm), работает в Web Worker.
// Ядро (~31 МБ) загружается один раз при первой конвертации медиа, дальше берётся из кэша.
import { vendorUrl, baseName, formatSize } from '../util.js';
import { FORMATS } from '../formats.js';

let ffPromise = null;

/** Скачивает ядро с прогрессом (fetch сам по себе прогресс не показывает) и запускает FFmpeg. */
export function getFFmpeg(onStatus) {
  ffPromise ||= (async () => {
    const { FFmpeg } = await import(vendorUrl('ffmpeg/ffmpeg/index.js'));
    // Ядро разрезано на части по 16 МБ (tools/vendor.mjs): так его принимает любой хостинг
    const base = vendorUrl('ffmpeg/core/');
    const manifest = await fetch(base + 'ffmpeg-core.wasm.parts.json').then((r) => {
      if (!r.ok) throw new Error('Не удалось загрузить модуль FFmpeg');
      return r.json();
    });
    const total = manifest.size;
    const chunks = [];
    let got = 0;
    for (const part of manifest.parts) {
      const res = await fetch(base + part);
      if (!res.ok) throw new Error('Не удалось загрузить модуль FFmpeg');
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onStatus?.(`Загружаем модуль видео и звука: ${formatSize(got)} из ${formatSize(total)} (один раз)`, (got / total) * 0.15);
      }
    }
    if (got !== total) throw new Error('Модуль FFmpeg загрузился не полностью — обновите страницу');
    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
    const ff = new FFmpeg();
    try {
      await ff.load({ coreURL: vendorUrl('ffmpeg/core/ffmpeg-core.js'), wasmURL: blobUrl });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    return ff;
  })().catch((e) => {
    ffPromise = null;
    throw e;
  });
  return ffPromise;
}

// ---------- Очередь: FFmpeg один, команды выполняются строго по одной ----------
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Подключает исходный файл к виртуальной ФС FFmpeg без копирования (WORKERFS), вызывает fn(путь), убирает за собой. */
async function withInput(ff, file, from, fn) {
  const dir = `/in${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  let input;
  let mounted = false;
  try {
    await ff.createDir(dir);
    await ff.mount('WORKERFS', { files: [file] }, dir);
    input = `${dir}/${file.name}`;
    mounted = true;
  } catch {
    input = `input${Date.now()}.${from}`;
    await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
  }
  try {
    return await fn(input);
  } finally {
    if (ffPromise) {
      if (mounted) {
        await ff.unmount(dir).catch(() => {});
        await ff.deleteDir(dir).catch(() => {});
      } else {
        await ff.deleteFile(input).catch(() => {});
      }
    }
  }
}

// ---------- Анализ файла (ffprobe) ----------
async function probeInput(ff, input) {
  const out = `probe${Date.now()}.json`;
  await ff.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input, '-o', out]);
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(await ff.readFile(out)));
  } catch {
    throw new Error('Файл повреждён или это не медиафайл');
  } finally {
    await ff.deleteFile(out).catch(() => {});
  }
  const streams = data.streams || [];
  const fps = (r) => {
    const [a, b] = String(r || '0/1').split('/').map(Number);
    return b ? a / b : 0;
  };
  // Обложки альбомов в MP3/M4A — это «видеопоток» из одной картинки, их пропускаем
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const duration = Number(data.format?.duration) || Number(v?.duration) || 0;
  return {
    duration,
    size: Number(data.format?.size) || 0,
    bitrate: Number(data.format?.bit_rate) || 0,
    video: v ? { index: v.index, codec: v.codec_name, width: v.width, height: v.height, fps: fps(v.avg_frame_rate) || fps(v.r_frame_rate) } : null,
    audio: streams.filter((s) => s.codec_type === 'audio').map((s) => ({
      index: s.index,
      codec: s.codec_name,
      channels: s.channels,
      layout: s.channel_layout,
      rate: Number(s.sample_rate) || 0,
      bitrate: Number(s.bit_rate) || 0,
      lang: s.tags?.language && s.tags.language !== 'und' ? s.tags.language : '',
      // В MP4/MOV название дорожки хранится в handler_name; стандартные «SoundHandler» и т.п. не показываем
      title: s.tags?.title || (/^(Sound|Video|Core Media Audio|ISO Media file|GPAC|L-SMASH)/i.test(s.tags?.handler_name || '') ? '' : s.tags?.handler_name || ''),
    })),
  };
}

// ---------- Защита от «зависшего» FFmpeg ----------
// После долгой работы (сотни операций, нехватка памяти WebAssembly) модуль может перестать выполнять
// команды: сразу печатает «Aborted()». Тогда перезапускаем его и повторяем задачу один раз.
class FFmpegCrashed extends Error {}
const isCrash = (e) => e instanceof FFmpegCrashed || /RuntimeError|memory access|unreachable|Aborted\(/i.test(`${e?.name} ${e?.message}`);
function resetFFmpeg(ff, reason = '') {
  console.warn('FFmpeg перезапущен' + (reason ? `: ${reason}` : ''));
  try {
    ff.terminate();
  } catch { /* уже остановлен */ }
  ffPromise = null;
}

/** Задача над файлом с FFmpeg: по очереди, с подключением файла и одним перезапуском при аварии модуля. */
function withFFmpegInput(file, from, fn, onStatus) {
  return exclusive(async () => {
    for (let attempt = 0; ; attempt++) {
      const ff = await getFFmpeg(onStatus);
      try {
        return await withInput(ff, file, from, (input) => fn(ff, input));
      } catch (e) {
        if (!isCrash(e) || attempt) throw e instanceof FFmpegCrashed ? new Error('FFmpeg не смог обработать файл') : e;
        resetFFmpeg(ff, `${e?.name}: ${e?.message || 'Aborted()'}`);
      }
    }
  });
}

/** Выполняет команду и собирает журнал FFmpeg (строки итогов могут прийти чуть позже ответа exec). */
async function execLogged(ff, args, until) {
  const log = [];
  const onLog = ({ message }) => log.push(message);
  ff.on('log', onLog);
  let code;
  try {
    code = await ff.exec(args);
    for (let i = 0; i < 25 && until && !until(log.join('\n')); i++) await new Promise((r) => setTimeout(r, 20));
  } finally {
    ff.off('log', onLog);
  }
  // Модуль «умер»: вместо работы — только Aborted()
  if (code !== 0 && log.length <= 2 && log.some((l) => /Aborted\(\)/.test(l))) throw new FFmpegCrashed();
  return { code, text: log.join('\n') };
}

// ---------- Встроенные средства браузера (Mediabunny + WebCodecs) — без загрузки FFmpeg ----------
// Контейнеры, которые Mediabunny умеет читать; AVI, WMV, FLV, MPEG, AMR, WMA — только через FFmpeg.
const MB_READABLE = new Set(['mp4', 'mov', 'm4v', '3gp', 'mkv', 'webm', 'mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac']);
const MB_CODEC = { avc: 'h264', hevc: 'hevc', vp8: 'vp8', vp9: 'vp9', av1: 'av1', aac: 'aac', opus: 'opus', mp3: 'mp3', flac: 'flac', vorbis: 'vorbis', ac3: 'ac3', eac3: 'eac3', alac: 'alac', 'pcm-s16': 'pcm_s16le', 'pcm-s24': 'pcm_s24le', 'pcm-s32': 'pcm_s32le', 'pcm-f32': 'pcm_f32le', 'pcm-u8': 'pcm_u8', ulaw: 'pcm_mulaw', alaw: 'pcm_alaw' };

async function withMbInput(file, fn) {
  const mb = await getMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    return await fn(mb, input);
  } finally {
    input.dispose?.();
  }
}

const DEFAULT_HANDLER = /^(Sound|Video|Core Media Audio|ISO Media file|GPAC|L-SMASH)/i;

/**
 * Названия звуковых дорожек MP4/MOV из hdlr (там их хранят FFmpeg и OBS; Mediabunny их не читает).
 * Обходит только заголовки блоков: moov читается целиком, mdat пропускается.
 */
async function mp4AudioNames(file) {
  const u32 = (dv, o) => dv.getUint32(o);
  const head = async (pos) => new DataView(await file.slice(pos, pos + 16).arrayBuffer());
  let pos = 0, moov = null;
  while (pos + 8 <= file.size) {
    const dv = await head(pos);
    let size = u32(dv, 0), hdr = 8;
    const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; }
    else if (size === 0) size = file.size - pos;
    if (size < hdr) return [];
    if (type === 'moov') {
      if (size > 64 * 1048576) return [];
      moov = new DataView(await file.slice(pos + hdr, pos + size).arrayBuffer());
      break;
    }
    pos += size;
  }
  if (!moov) return [];
  const boxes = (dv, start, end) => {
    const out = [];
    for (let p = start; p + 8 <= end;) {
      const size = u32(dv, p);
      if (size < 8 || p + size > end) break;
      out.push({ type: String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7)), start: p + 8, end: p + size });
      p += size;
    }
    return out;
  };
  const names = [];
  for (const trak of boxes(moov, 0, moov.byteLength).filter((b) => b.type === 'trak')) {
    const mdia = boxes(moov, trak.start, trak.end).find((b) => b.type === 'mdia');
    const hdlr = mdia && boxes(moov, mdia.start, mdia.end).find((b) => b.type === 'hdlr');
    if (!hdlr || hdlr.end - hdlr.start < 24) continue;
    const kind = String.fromCharCode(...[8, 9, 10, 11].map((i) => moov.getUint8(hdlr.start + i)));
    if (kind !== 'soun') continue;
    let bytes = new Uint8Array(moov.buffer, moov.byteOffset + hdlr.start + 24, hdlr.end - hdlr.start - 24);
    if (bytes[0] && bytes[0] === bytes.length - 1) bytes = bytes.subarray(1); // в MOV — строка Pascal
    const zero = bytes.indexOf(0);
    const name = new TextDecoder().decode(zero >= 0 ? bytes.subarray(0, zero) : bytes).trim();
    names.push(DEFAULT_HANDLER.test(name) ? '' : name);
  }
  return names;
}

/** Сведения о файле силами браузера — в том же виде, что и через ffprobe. */
function mbProbe(file, from) {
  return withMbInput(file, async (mb, input) => {
    const [videos, audios] = await Promise.all([input.getVideoTracks(), input.getAudioTracks()]);
    if (!videos.length && !audios.length) throw new Error('нет дорожек');
    // Кодек, которого Mediabunny не знает (ALAC, MP3 в MKV…) — пусть точно скажет ffprobe
    if ([...videos, ...audios].some((t) => !t.codec)) throw new Error('неизвестный кодек');
    const names = ['mp4', 'mov', 'm4v', 'm4a', '3gp'].includes(from) ? await mp4AudioNames(file).catch(() => []) : [];
    const v = videos[0];
    const fps = v ? (await v.computePacketStats(150).catch(() => null))?.averagePacketRate || 0 : 0;
    return {
      duration: await input.computeDuration(),
      size: file.size,
      bitrate: 0,
      video: v ? { index: -1, codec: MB_CODEC[v.codec] || v.codec || '', width: v.displayWidth, height: v.displayHeight, fps } : null,
      audio: audios.map((a, i) => ({
        index: -1,
        codec: MB_CODEC[a.codec] || a.codec || '',
        channels: a.numberOfChannels,
        layout: a.numberOfChannels === 1 ? 'mono' : a.numberOfChannels === 2 ? 'stereo' : '',
        rate: a.sampleRate,
        bitrate: 0,
        lang: a.languageCode && a.languageCode !== 'und' ? a.languageCode : '',
        title: (a.name && !DEFAULT_HANDLER.test(a.name) ? a.name : '') || names[i] || '',
      })),
    };
  });
}

/**
 * Пики дорожки силами браузера: встроенный декодер звука, все отсчёты (поэтому пик точный).
 * Возвращает Float32Array пиков с полями phaseCancel и exactPeak.
 */
function mbPeaks(file, track, points) {
  return withMbInput(file, async (mb, input) => {
    const t = (await input.getAudioTracks())[track];
    if (!t || !(await t.canDecode())) throw new Error('браузер не умеет декодировать эту дорожку');
    const duration = (await input.computeDuration()) || 1;
    const peaks = new Float32Array(points);
    let exact = 0, both = 0, sum = 0;
    const sink = new mb.AudioSampleSink(t);
    for await (const s of sink.samples()) {
      const n = s.numberOfFrames, ch = s.numberOfChannels;
      const buf = new Float32Array(s.allocationSize({ planeIndex: 0, format: 'f32' }) / 4);
      s.copyTo(buf, { planeIndex: 0, format: 'f32' }); // чередующиеся отсчёты всех каналов
      const k = points / duration;
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let c = 0; c < ch; c++) {
          const a = Math.abs(buf[i * ch + c]);
          if (a > m) m = a;
        }
        const b = Math.min(points - 1, Math.floor((s.timestamp + i / s.sampleRate) * k));
        if (b >= 0 && m > peaks[b]) peaks[b] = m;
        if (m > exact) exact = m;
        if (ch === 2) {
          sum = Math.max(sum, Math.abs(buf[2 * i] + buf[2 * i + 1]) / 2);
          both = Math.max(both, m);
        }
      }
      s.close();
    }
    for (let i = 0; i < points; i++) peaks[i] = Math.min(1, peaks[i]);
    peaks.phaseCancel = both > 0 && sum < both * 0.1;
    peaks.exactPeak = Math.min(1, exact);
    return peaks;
  });
}

/** Сведения о файле: длительность, видео, звуковые дорожки. Сначала — силами браузера, без FFmpeg. */
export async function probe(file, from, onStatus) {
  if (MB_READABLE.has(from)) {
    try {
      return await mbProbe(file, from);
    } catch { /* не вышло — через FFmpeg */ }
  }
  return withFFmpegInput(file, from, (ff, input) => probeInput(ff, input), onStatus);
}

/** Огибающая звуковой дорожки для рисования графика: массив пиков 0..1. Сначала — силами браузера. */
export async function audioPeaks(file, from, track, points = 800, onStatus) {
  if (MB_READABLE.has(from)) {
    try {
      return await mbPeaks(file, track, points);
    } catch { /* не вышло — через FFmpeg */ }
  }
  return withFFmpegInput(file, from, async (ff, input) => {
    const info = await probeInput(ff, input);
    const rate = info.duration > 900 ? 1000 : info.duration > 120 ? 2000 : 8000;
    // Каналы НЕ сводим в моно: у некоторых микрофонов левый и правый в противофазе, и при сложении
    // звук взаимно гасится до нуля — график показал бы «тишину». Берём максимум по всем каналам.
    const channels = Math.min(info.audio[track]?.channels || 2, 8);
    const out = `peaks${Date.now()}.raw`;
    const { code } = await execLogged(ff, ['-hide_banner', '-v', 'error', '-i', input, '-map', `0:a:${track}`, '-ac', String(channels), '-ar', String(rate), '-f', 's16le', '-c:a', 'pcm_s16le', out]);
    if (code !== 0) throw new Error('Не удалось прочитать дорожку');
    const raw = await ff.readFile(out);
    await ff.deleteFile(out).catch(() => {});
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const peaks = peaksFromPcm(pcm, points, 32768); // по чередующимся отсчётам всех каналов
    peaks.phaseCancel = channels === 2 && phaseCancels(pcm);
    return peaks;
  }, onStatus);
}

/** Точный пиковый уровень дорожки (0..1) для «Нормализовать»: браузером по всем отсчётам, иначе volumedetect FFmpeg. */
export async function measurePeak(file, from, track) {
  if (MB_READABLE.has(from)) {
    try {
      return (await mbPeaks(file, track, 100)).exactPeak;
    } catch { /* не вышло — через FFmpeg */ }
  }
  const re = /max_volume:\s*(-?[\d.]+|-inf) dB/;
  return withFFmpegInput(file, from, async (ff, input) => {
    const { text } = await execLogged(ff, ['-hide_banner', '-i', input, '-map', `0:a:${track}`, '-af', 'volumedetect', '-f', 'null', '-'], (t) => re.test(t));
    const m = re.exec(text);
    if (!m) {
      if (/Aborted\(\)/.test(text) && !/Stream mapping/.test(text)) throw new FFmpegCrashed();
      throw new Error('Не удалось измерить громкость');
    }
    return m[1] === '-inf' ? 0 : 10 ** (Number(m[1]) / 20);
  });
}

/**
 * Стерео в противофазе: сумма каналов (моно) намного тише самих каналов — при сведении в моно звук исчезнет.
 * pcm — чередующиеся отсчёты L, R (Int16Array или Float32Array).
 */
export function phaseCancels(pcm) {
  let both = 0, sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    both = Math.max(both, Math.abs(pcm[i]), Math.abs(pcm[i + 1]));
    sum = Math.max(sum, Math.abs(pcm[i] + pcm[i + 1]) / 2);
  }
  return both > 0 && sum < both * 0.1;
}

/** Пики по корзинам: максимум модуля амплитуды в каждой. */
export function peaksFromPcm(samples, points, scale = 1) {
  const out = new Float32Array(points);
  const per = samples.length / points;
  for (let i = 0; i < points; i++) {
    let max = 0;
    const end = Math.min(samples.length, Math.floor((i + 1) * per));
    for (let j = Math.floor(i * per); j < end; j++) {
      const a = Math.abs(samples[j]);
      if (a > max) max = a;
    }
    out[i] = Math.min(1, max / scale);
  }
  return out;
}

// ---------- Кодеки ----------
// H.265 (libx265) и VP9 в однопоточной сборке ffmpeg.wasm зависают или падают —
// эти кодеки (и AV1) кодируются через WebCodecs, см. convertWebCodecs
const CRF = { h264: { high: 20, medium: 23, low: 28 } };

export const VIDEO_CODECS = {
  copy: { label: 'Без перекодирования (быстро, как в оригинале)' },
  h264: { label: 'H.264 (AVC) — открывается везде' },
  vp8: { label: 'VP8' },
  hevc: { label: 'H.265 (HEVC) — файл меньше; кодирует видеокарта' },
  av1: { label: 'AV1 — файл ещё меньше; кодирует браузер' },
  vp9: { label: 'VP9 — кодирует браузер' },
  mpeg4: { label: 'MPEG-4 Part 2 (Xvid/DivX)' },
  prores: { label: 'ProRes 422 — для монтажа, файл очень большой' },
};

export const AUDIO_CODECS = {
  copy: { label: 'Без перекодирования (как в оригинале)' },
  aac: { label: 'AAC' },
  mp3: { label: 'MP3' },
  opus: { label: 'Opus' },
  vorbis: { label: 'Vorbis' },
  flac: { label: 'FLAC — без потерь' },
  alac: { label: 'ALAC — без потерь (Apple)' },
  ac3: { label: 'AC-3 (Dolby Digital)' },
  pcm16: { label: 'PCM 16 бит — без сжатия' },
  pcm24: { label: 'PCM 24 бит — без сжатия' },
};

// Какие кодеки можно положить в контейнер (первый — по умолчанию при перекодировании)
const CONTAINER = {
  mp4: { video: ['h264', 'hevc', 'av1', 'vp9'], audio: ['aac', 'mp3', 'alac', 'ac3'] },
  mov: { video: ['h264', 'hevc', 'prores'], audio: ['aac', 'alac', 'pcm16', 'pcm24'] },
  mkv: { video: ['h264', 'hevc', 'av1', 'vp9'], audio: ['aac', 'opus', 'mp3', 'flac', 'vorbis', 'ac3'] },
  webm: { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
  avi: { video: ['mpeg4', 'h264'], audio: ['mp3', 'ac3', 'pcm16'] },
  gif: { video: [], audio: [] },
  mp3: { video: [], audio: ['mp3'] },
  m4a: { video: [], audio: ['aac', 'alac'] },
  ogg: { video: [], audio: ['vorbis', 'opus'] },
  opus: { video: [], audio: ['opus'] },
  flac: { video: [], audio: ['flac'] },
  wav: { video: [], audio: ['pcm16', 'pcm24'] },
};

// Исходные кодеки (имена ffprobe), которые можно скопировать в контейнер без перекодирования
const COPY_OK = {
  video: {
    mp4: ['h264', 'hevc', 'mpeg4', 'av1', 'vp9'],
    mov: ['h264', 'hevc', 'mpeg4', 'prores', 'mjpeg'],
    mkv: '*',
    webm: ['vp8', 'vp9', 'av1'],
    avi: ['mpeg4', 'h264', 'mjpeg', 'msmpeg4v3', 'mpeg2video'],
  },
  audio: {
    mp4: ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'opus', 'flac'],
    mov: ['aac', 'mp3', 'alac', 'ac3', 'pcm_s16le', 'pcm_s24le'],
    mkv: '*',
    webm: ['opus', 'vorbis'],
    avi: ['mp3', 'ac3', 'pcm_s16le'],
    mp3: ['mp3'],
    m4a: ['aac', 'alac'],
    ogg: ['vorbis', 'opus', 'flac'],
    opus: ['opus'],
    flac: ['flac'],
    wav: ['pcm_s16le', 'pcm_s24le'],
  },
};
/** Поворот из редактора → 0, 90, 180 или 270. */
const normRotate = (deg) => (((Math.round((deg || 0) / 90) * 90) % 360) + 360) % 360;

const canCopy = (kind, to, codec) => {
  const ok = COPY_OK[kind][to];
  return ok === '*' || (Array.isArray(ok) && ok.includes(codec));
};
// В MP4 положить их можно, но браузеры, iPhone и многие телефоны такой файл не проиграют.
// Явное «без перекодирования» это разрешает, а «Авто» перекодирует в H.264 / AAC.
const NOT_PORTABLE = { video: { mp4: ['mpeg4'] }, audio: { mp4: ['ac3', 'eac3', 'flac'] } };
const autoCopy = (kind, to, codec) => canCopy(kind, to, codec) && !NOT_PORTABLE[kind][to]?.includes(codec);

/** Варианты кодеков для выбранного формата — для списков в интерфейсе. */
export function codecOptions(to) {
  const c = CONTAINER[to] || { video: [], audio: [] };
  const list = (ids, all) => ids.map((id) => ({ id, label: all[id].label }));
  return {
    video: c.video.length ? [{ id: 'auto', label: 'Авто' }, { id: 'copy', label: VIDEO_CODECS.copy.label }, ...list(c.video, VIDEO_CODECS)] : [],
    audio: c.audio.length ? [{ id: 'auto', label: 'Авто' }, { id: 'copy', label: AUDIO_CODECS.copy.label }, ...list(c.audio, AUDIO_CODECS)] : [],
  };
}

function videoEncoderArgs(codec, opts, bitrate) {
  const q = opts.videoQuality || 'medium';
  // При сжатии до размера — средний битрейт с ограничением пиков, иначе — постоянное качество (CRF)
  const rate = (crf) => (bitrate
    ? ['-b:v', `${bitrate}k`, '-maxrate', `${Math.round(bitrate * 1.5)}k`, '-bufsize', `${bitrate * 2}k`]
    : ['-crf', String(crf)]);
  switch (codec) {
    case 'h264': return ['-c:v', 'libx264', '-preset', 'veryfast', ...rate(CRF.h264[q]), '-pix_fmt', 'yuv420p'];
    case 'vp8': return ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', ...(bitrate ? ['-b:v', `${bitrate}k`] : ['-crf', { high: '8', medium: '12', low: '24' }[q], '-b:v', '3M'])];
    case 'mpeg4': return ['-c:v', 'mpeg4', ...(bitrate ? ['-b:v', `${bitrate}k`] : ['-q:v', { high: '2', medium: '4', low: '8' }[q]])];
    case 'prores': return ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'];
    default: throw new Error(`Неизвестный видеокодек ${codec}`);
  }
}

/** Параметры аудиокодека в виде [опция, значение] — потом к опции добавляется номер дорожки. */
function audioEncoderOpts(codec, opts, bitrate) {
  const br = bitrate || opts.audioBitrate || 192;
  switch (codec) {
    case 'aac': return [['c', 'aac'], ['b', `${br}k`]];
    case 'mp3': return [['c', 'libmp3lame'], ['b', `${br}k`]];
    case 'opus': return [['c', 'libopus'], ['b', `${Math.min(br, 256)}k`]];
    // Vorbis лучше задавать качеством: фиксированный битрейт не подходит для моно/низкой частоты
    case 'vorbis': return [['c', 'libvorbis'], ['q', String({ 64: 1, 96: 2, 128: 4, 192: 6, 256: 8, 320: 9 }[br] ?? 6)]];
    case 'flac': return [['c', 'flac']];
    case 'alac': return [['c', 'alac']];
    case 'ac3': return [['c', 'ac3'], ['b', `${Math.max(192, Math.min(br * 2, 448))}k`]];
    case 'pcm16': return [['c', 'pcm_s16le']];
    case 'pcm24': return [['c', 'pcm_s24le']];
    default: throw new Error(`Неизвестный аудиокодек ${codec}`);
  }
}

/** Громкость; при усилении — мягкий лимитер, чтобы звук не хрипел от перегрузки. */
function volumeFilter(gain) {
  const g = Math.max(0, Math.round(gain * 100) / 100);
  return g > 1 ? `volume=${g},alimiter=limit=0.97:level=disabled` : `volume=${g}`;
}

/**
 * Собирает аргументы FFmpeg по сведениям о файле и правкам пользователя.
 * edit: { videoCodec, audioCodec, tracks: [{keep, gain}], compress: {height, codec, vkbps, akbps, targetMB} }
 */
function buildArgs(info, from, to, opts, edit, { forceEncode = false } = {}) {
  const toGroup = FORMATS[to]?.group;
  const isAudioOut = toGroup === 'audio';
  const isGif = to === 'gif';
  const fast = opts.fastRemux !== false && !forceEncode;
  const cont = CONTAINER[to];
  if (!cont) throw new Error(`Неподдерживаемый формат: ${to}`);
  const compress = !isAudioOut && !isGif ? edit.compress : null;
  const args = [];
  const notes = [];

  // Видео
  // Поворот из редактора: фильтр transpose (по часовой: 1 = 90°, 2 = −90°); с фильтром копирование невозможно
  const rot = normRotate(edit.rotate);
  const transpose = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2' }[rot] || '';
  if (!isAudioOut) {
    if (!info.video) throw new Error('В файле нет видео');
    args.push('-map', `0:${info.video.index}`);
    if (isGif) {
      args.push('-vf', (transpose ? transpose + ',' : '') + "fps=12,scale='min(iw,480)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", '-loop', '0');
    } else {
      const height = compress?.height || opts.maxHeight || 0;
      const scaled = height && height < info.video.height;
      let vc = compress?.codec || edit.videoCodec || 'auto';
      if (vc === 'copy' && (scaled || compress || rot)) vc = 'auto';
      if (vc === 'copy' && !canCopy('video', to, info.video.codec)) {
        throw new Error(`Видео в кодеке ${info.video.codec.toUpperCase()} нельзя положить в ${FORMATS[to].label} без перекодирования — выберите видеокодек`);
      }
      if (vc === 'auto') vc = fast && !scaled && !rot && autoCopy('video', to, info.video.codec) ? 'copy' : cont.video[0];
      if (vc === 'copy') {
        args.push('-c:v', 'copy');
        notes.push('видео без перекодирования');
      } else {
        const vf = [transpose, scaled && `scale=-2:${height}`].filter(Boolean).join(',');
        if (vf) args.push('-vf', vf);
        if (rot) notes.push(`повёрнуто на ${rot}°`);
        args.push(...videoEncoderArgs(vc, opts, compress?.vkbps));
        notes.push(VIDEO_CODECS[vc].label.split(' — ')[0]);
      }
    }
  }

  // Звук
  if (!isGif) {
    let kept = info.audio.map((a, i) => ({ ...a, i, keep: edit.tracks?.[i]?.keep !== false, gain: edit.tracks?.[i]?.gain ?? 1 })).filter((t) => t.keep);
    if (isAudioOut) {
      if (!info.audio.length) throw new Error('В файле нет звука');
      if (!kept.length) throw new Error('Все звуковые дорожки удалены — оставьте хотя бы одну');
      if (kept.length > 1) notes.push(`в ${FORMATS[to].label} помещается одна дорожка — сохранена первая из оставленных`);
      kept = kept.slice(0, 1);
      args.push('-vn');
    }
    if (!kept.length) args.push('-an');
    kept.forEach((t, k) => {
      args.push('-map', `0:${t.index}`);
      let ac = compress ? (to === 'webm' ? 'opus' : 'aac') : edit.audioCodec || 'auto';
      const gained = Math.abs(t.gain - 1) > 0.001;
      if (ac === 'copy' && gained) ac = 'auto'; // изменить громкость без перекодирования нельзя
      if (ac === 'copy' && !canCopy('audio', to, t.codec)) {
        throw new Error(`Звук в кодеке ${t.codec.toUpperCase()} нельзя положить в ${FORMATS[to].label} без перекодирования — выберите аудиокодек`);
      }
      if (ac === 'auto') ac = fast && !gained && autoCopy('audio', to, t.codec) ? 'copy' : cont.audio[0];
      if (ac === 'copy') {
        args.push(`-c:a:${k}`, 'copy');
      } else {
        for (const [opt, val] of audioEncoderOpts(ac, opts, compress?.akbps)) args.push(`-${opt}:a:${k}`, val);
        if (gained) args.push(`-filter:a:${k}`, volumeFilter(t.gain));
      }
    });
  }

  if (to === 'mp4' || to === 'mov' || to === 'm4a') args.push('-movflags', '+faststart');
  return { args, notes };
}

/**
 * opts: { videoQuality, maxHeight, audioBitrate, fastRemux, signal, edit }
 * onProgress(доля 0..1, текст статуса?)
 */
/**
 * opts: { videoQuality, maxHeight, audioBitrate, fastRemux, signal, edit }
 * Движок: WebCodecs (видеокарта/браузер) для H.265, AV1, VP9 и для сжатия до размера; иначе FFmpeg.
 */
// Что браузер делает сам (без загрузки FFmpeg на 31 МБ):
const WC_TARGETS = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4a', 'wav', 'opus']);
const WC_VCHOICE = { auto: null, copy: null, h264: 'avc', hevc: 'hevc', av1: 'av1', vp9: 'vp9', vp8: 'vp8' };
const WC_ACHOICE = { auto: null, copy: null, aac: 'aac', opus: 'opus', pcm16: 'pcm-s16', pcm24: 'pcm-s24' };

export async function convert(file, from, to, opts = {}, onProgress) {
  const edit = opts.edit || {};
  const vcodec = edit.compress?.codec || edit.videoCodec;
  // Кодеки, которые умеет только браузер (H.265/AV1/VP9) — FFmpeg за них не возьмётся
  const browserOnly = WC_VIDEO.has(vcodec);
  const browserCan = MB_READABLE.has(from) && WC_TARGETS.has(to)
    && (edit.videoCodec ?? 'auto') in WC_VCHOICE && (edit.audioCodec ?? 'auto') in WC_ACHOICE;
  if (browserOnly || browserCan) {
    try {
      return await convertWebCodecs(file, from, to, opts, onProgress);
    } catch (e) {
      if (e?.name === 'AbortError' || opts.signal?.aborted) throw e;
      if (e?.userFacing) throw e; // понятная ошибка про выбор пользователя — FFmpeg её не исправит
      if (browserOnly && vcodec !== 'avc') throw e;
      console.warn('Встроенными средствами браузера не вышло, переходим на FFmpeg:', e);
      onProgress?.(undefined, 'Браузер не справился сам — подключаем FFmpeg (медленнее)…');
      const compress = edit.compress ? { ...edit.compress, codec: 'h264' } : null;
      return convertFfmpeg(file, from, to, { ...opts, edit: { ...edit, compress } }, onProgress);
    }
  }
  return convertFfmpeg(file, from, to, opts, onProgress);
}

function convertFfmpeg(file, from, to, opts = {}, onProgress) {
  const status = (text, p) => onProgress?.(p, text);
  return exclusive(async () => {
    const ff = await getFFmpeg(status);
    if (opts.signal?.aborted) throw new DOMException('Отменено', 'AbortError');

    // Отмена: останавливаем worker целиком (FFmpeg иначе не прервать), при следующем запуске он перезагрузится
    const onAbort = () => {
      ff.terminate();
      ffPromise = null;
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const log = [];
    const onLog = ({ message }) => {
      log.push(message);
      if (log.length > 40) log.shift();
    };
    const onFfProgress = ({ progress }) => {
      if (progress >= 0 && progress <= 1) status(`Конвертация… ${Math.round(progress * 100)}%`, 0.15 + progress * 0.85);
    };
    ff.on('log', onLog);
    ff.on('progress', onFfProgress);
    const output = `output${Date.now()}.${to}`;

    try {
      return await withInput(ff, file, from, async (input) => {
        status('Анализ файла…', 0.15);
        const info = await probeInput(ff, input);
        const edit = opts.edit || {};
        let plan = buildArgs(info, from, to, opts, edit);
        status('Конвертация…', 0.15);
        log.length = 0;
        let code = await ff.exec(['-hide_banner', '-i', input, ...plan.args, output]);
        // Копирование без перекодирования иногда не проходит (нестандартные потоки) — перекодируем
        if (code !== 0 && plan.args.includes('copy') && edit.videoCodec !== 'copy' && edit.audioCodec !== 'copy') {
          await ff.deleteFile(output).catch(() => {});
          plan = buildArgs(info, from, to, opts, edit, { forceEncode: true });
          log.length = 0;
          code = await ff.exec(['-hide_banner', '-i', input, ...plan.args, output]);
        }
        if (code !== 0) throw new Error(explain(log));
        const data = await ff.readFile(output);
        await ff.deleteFile(output).catch(() => {});
        if (!data?.length) throw new Error('Получился пустой файл');
        const result = { blob: new Blob([data], { type: FORMATS[to]?.mime || 'application/octet-stream' }), name: `${baseName(file.name)}.${to}` };
        result.note = sizeNote(edit, to, data.length) || plan.notes.join(' · ') || undefined;
        return [result];
      });
    } catch (e) {
      if (opts.signal?.aborted) throw new DOMException('Отменено', 'AbortError');
      // Аварийное падение внутри WebAssembly (обычно нехватка памяти): модуль больше не пригоден — перезапустим при следующем вызове
      if (/RuntimeError|memory access|unreachable|Aborted\(/i.test(`${e?.name} ${e?.message}`)) {
        ff.terminate();
        ffPromise = null;
        throw new Error('FFmpeg аварийно завершился — скорее всего, не хватило памяти. Попробуйте файл поменьше или сожмите видео с уменьшением разрешения.');
      }
      throw e;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      if (ffPromise) {
        ff.off('log', onLog);
        ff.off('progress', onFfProgress);
      }
    }
  });
}

// ---------- Сжатие до заданного размера ----------
const QUALITY = [
  { min: 0.1, label: 'отличное', level: 4 },
  { min: 0.06, label: 'хорошее', level: 3 },
  { min: 0.035, label: 'среднее', level: 2 },
  { min: 0.02, label: 'низкое', level: 1 },
  { min: 0, label: 'плохое', level: 0 },
];


// Во сколько раз кодек эффективнее H.264: при том же битрейте даёт качество как H.264 с битрейтом в eff раз больше
export const COMPRESS_CODECS = [
  { id: 'avc', label: 'H.264', hint: 'открывается везде', eff: 1, containers: ['mp4', 'mov', 'mkv'] },
  { id: 'hevc', label: 'H.265 (HEVC)', hint: 'на ~35% меньше при том же качестве; iPhone, Mac, Windows 10+, современные ТВ', eff: 1.5, containers: ['mp4', 'mov', 'mkv'] },
  { id: 'av1', label: 'AV1', hint: 'на ~45% меньше; новые устройства, YouTube, браузеры', eff: 1.8, containers: ['mp4', 'webm', 'mkv'] },
  { id: 'vp9', label: 'VP9', hint: 'на ~30% меньше; для WebM и браузеров', eff: 1.4, containers: ['webm', 'mkv', 'mp4'] },
];

/**
 * Подбирает варианты сжатия видео до targetMB.
 * s: { codec: 'avc'|'hevc'|'av1'|'vp9', akbps: 'auto'|число, fps: 0|число, mono }
 * Возвращает { ok, message?, budget, variants: [{ height, width, vkbps, akbps, quality, recommended, title, hint }] }
 */
export function planCompression(info, targetMB, keptTracks = 1, s = {}) {
  if (!info?.video || !info.duration) return { ok: false, message: 'Не удалось определить длительность видео', variants: [] };
  const { width: W, height: H, fps: F0 } = info.video;
  const fps = Math.min(s.fps || F0 || 30, F0 || 60, 60);
  const eff = COMPRESS_CODECS.find((c) => c.id === (s.codec || 'avc'))?.eff || 1;
  const sizeMB = info.size / 1048576;
  if (sizeMB && targetMB >= sizeMB) return { ok: false, message: `Файл уже весит ${sizeMB.toFixed(1)} МБ — меньше указанного. Сжимать не нужно.`, variants: [] };

  const totalKbps = (targetMB * 8 * 1024 * 0.95) / info.duration; // 5% запаса на контейнер и погрешность
  const autoA = totalKbps > 1500 ? 128 : totalKbps > 600 ? 96 : 64;
  const akbps = keptTracks ? Math.round((Number(s.akbps) || autoA) * (s.mono ? 0.6 : 1)) : 0;
  const vkbps = Math.floor(totalKbps - akbps * keptTracks);

  if (vkbps < 60) {
    // Минимум: 360p (или исходник меньше) с «низким» качеством + немного на звук
    const h = Math.min(360, H);
    const w = Math.round((W * h) / H);
    const minV = (0.02 * w * h * fps) / 1000 / eff;
    const minMB = Math.ceil(((minV + 48 * keptTracks) * info.duration) / 8 / 1024 / 0.95);
    return { ok: false, message: `${targetMB} МБ слишком мало для ${formatDur(info.duration)} видео — изображение развалится на квадраты. Разумный минимум — около ${minMB} МБ.`, variants: [] };
  }

  const heights = [...new Set([H, 2160, 1440, 1080, 720, 480, 360].filter((h) => h <= H))].sort((x, y) => y - x);
  const all = heights.map((h) => {
    const w = Math.round((W * h) / H / 2) * 2;
    const bpp = ((vkbps * 1000) / (w * h * fps)) * eff;
    return { height: h, width: w, vkbps, akbps, quality: QUALITY.find((x) => bpp >= x.min) };
  });
  const pick = [];
  const add = (v) => v && !pick.includes(v) && pick.push(v);
  // 1) рекомендуемый: самое большое разрешение с качеством «хорошее» и выше (или самое маленькое, если даже оно хуже)
  const rec = all.find((v) => v.quality.level >= 3) || all[all.length - 1];
  add(rec);
  add(all[0]); // исходное разрешение — чётче, но каждый кадр сжат сильнее
  add(all.find((v) => v.height < rec.height)); // ступенью ниже — меньше деталей, зато без артефактов
  add([...all].reverse().find((v) => v.height > rec.height && v !== all[0])); // ступенью выше

  return {
    ok: true,
    budget: { totalKbps: Math.round(totalKbps), vkbps, akbps, fps: Math.round(fps * 100) / 100 },
    variants: pick.sort((x, y) => y.height - x.height).map((v) => ({
      ...v,
      recommended: v === rec,
      title: `${v.height}p`,
      hint: v.height === H ? `исходное разрешение ${v.width}×${v.height}` : `уменьшение до ${v.width}×${v.height}`,
    })),
  };
}

/** Примечание к результату сжатия: попали ли в цель. */
function sizeNote(edit, to, bytes) {
  const target = edit.compress?.targetMB;
  if (!target || to === 'gif' || FORMATS[to]?.group === 'audio') return '';
  const mb = bytes / 1048576;
  return mb <= target * 1.02
    ? `${mb.toFixed(1)} МБ при цели ${target} МБ`
    : `получилось ${mb.toFixed(1)} МБ — больше цели ${target} МБ; выберите вариант с меньшим разрешением`;
}

// ---------- Кодирование через WebCodecs (Mediabunny): H.265, AV1, VP9, быстрый H.264 ----------
const WC_VIDEO = new Set(['hevc', 'av1', 'vp9']);
const getMediabunny = () => import(vendorUrl('mediabunny/mediabunny.min.js'));

/** Какие кодеки браузер может кодировать при данном размере кадра: { avc, hevc, av1, vp9 }. */
export async function webCodecsSupport(width = 1920, height = 1080, kbps = 4000) {
  const out = { avc: false, hevc: false, av1: false, vp9: false };
  if (typeof VideoEncoder === 'undefined') return out;
  const mb = await getMediabunny();
  const w = Math.max(16, Math.round(width / 2) * 2), h = Math.max(16, Math.round(height / 2) * 2);
  await Promise.all(Object.keys(out).map(async (id) => {
    try {
      out[id] = await mb.canEncodeVideo(id, { width: w, height: h, bitrate: kbps * 1000 });
    } catch {
      out[id] = false;
    }
  }));
  return out;
}

/** Мягкий лимитер: до 0,9 звук не трогается, выше плавно подводится к 1 — вместо грубой перегрузки. */
const softLimit = (v) => {
  const a = Math.abs(v);
  return a <= 0.9 ? v : Math.sign(v) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
};

function gainProcessor(mb, gain) {
  return (sample) => {
    const n = sample.allocationSize({ planeIndex: 0, format: 'f32' }) / 4;
    const buf = new Float32Array(n);
    sample.copyTo(buf, { planeIndex: 0, format: 'f32' });
    for (let i = 0; i < n; i++) buf[i] = gain > 1 ? softLimit(buf[i] * gain) : buf[i] * gain;
    return new mb.AudioSample({ data: buf, format: 'f32', numberOfChannels: sample.numberOfChannels, sampleRate: sample.sampleRate, timestamp: sample.timestamp });
  };
}

const DISCARD_REASONS = {
  undecodable_source_codec: 'браузер не умеет читать исходный кодек',
  no_encodable_target_codec: 'браузер или видеокарта не умеют кодировать в выбранный кодек',
  unknown_source_codec: 'неизвестный исходный кодек',
};

/** Ошибка из-за выбора пользователя — показываем как есть, без перехода на FFmpeg. */
const userError = (msg) => Object.assign(new Error(msg), { userFacing: true });

/**
 * Конвертация встроенными средствами браузера (Mediabunny + WebCodecs): перепаковка контейнера,
 * перекодирование видео/звука, громкость, удаление дорожек, сжатие до размера.
 * Логика выбора кодеков — та же, что у buildArgs для FFmpeg.
 */
async function convertWebCodecs(file, from, to, opts, onProgress) {
  const status = (text, p) => onProgress?.(p, text);
  const mb = await getMediabunny();
  const edit = opts.edit || {};
  const isAudioOut = FORMATS[to]?.group === 'audio';
  const c = isAudioOut ? null : edit.compress;
  const cont = CONTAINER[to];
  const fast = opts.fastRemux !== false;
  const q = { high: mb.QUALITY_HIGH, medium: mb.QUALITY_MEDIUM, low: mb.QUALITY_LOW }[opts.videoQuality || 'medium'];
  const height = c?.height || opts.maxHeight || 0;
  const format = to === 'webm' ? new mb.WebMOutputFormat()
    : to === 'mkv' ? new mb.MkvOutputFormat()
    : to === 'mov' ? new mb.MovOutputFormat({ fastStart: 'in-memory' })
    : to === 'wav' ? new mb.WavOutputFormat()
    : to === 'opus' ? new mb.OggOutputFormat()
    : new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const notes = [];
  let encoding = false;
  let codecLabel = '';
  status('Подготовка…', 0.03);

  let conv;
  try {
    const [videos, audios] = await Promise.all([input.getVideoTracks(), input.getAudioTracks()]);
    if (!isAudioOut && !videos.length) throw userError('В файле нет видео');
    let kept = audios.map((t, i) => ({ t, keep: edit.tracks?.[i]?.keep !== false, gain: edit.tracks?.[i]?.gain ?? 1 })).filter((x) => x.keep);
    if (isAudioOut) {
      if (!audios.length) throw userError('В файле нет звука');
      if (!kept.length) throw userError('Все звуковые дорожки удалены — оставьте хотя бы одну');
      if (kept.length > 1) notes.push(`в ${FORMATS[to].label} помещается одна дорожка — сохранена первая из оставленных`);
      kept = kept.slice(0, 1);
    }

    // Видео: один раз решаем, копировать или кодировать
    let videoOpts = { discard: true };
    if (!isAudioOut) {
      const v = videos[0];
      const src = MB_CODEC[v.codec] || v.codec || '';
      const scaled = height && height < v.displayHeight;
      // Поворот: в MP4/MOV записывается в метаданные — без перекодирования; в MKV/WebM — с перекодированием
      const rot = normRotate(edit.rotate);
      const rotMeta = rot && (to === 'mp4' || to === 'mov');
      let vc = c?.codec || edit.videoCodec || 'auto';
      if (vc === 'copy' && (scaled || c || (rot && !rotMeta))) vc = 'auto';
      if (vc === 'copy' && !canCopy('video', to, src)) {
        throw userError(`Видео в кодеке ${src.toUpperCase()} нельзя положить в ${FORMATS[to].label} без перекодирования — выберите видеокодек`);
      }
      if (vc === 'auto') vc = fast && !scaled && !c && (!rot || rotMeta) && autoCopy('video', to, src) ? 'copy' : cont.video[0];
      if (vc === 'copy') {
        videoOpts = rot ? { rotate: rot } : {};
        notes.push(rot ? `видео без перекодирования, повёрнуто на ${rot}°` : 'видео без перекодирования');
      } else {
        const codec = WC_VCHOICE[vc] || vc; // h264 → avc; из панели сжатия приходит уже avc/hevc/…
        codecLabel = COMPRESS_CODECS.find((x) => x.id === codec)?.label || VIDEO_CODECS[vc]?.label.split(' — ')[0] || vc;
        videoOpts = { codec, bitrate: c ? c.vkbps * 1000 : q, forceTranscode: true, keyFrameInterval: c?.gop || 2 };
        if (c?.hw && c.hw !== 'auto') videoOpts.hardwareAcceleration = c.hw;
        if (scaled) videoOpts.height = Math.round(height / 2) * 2;
        if (c?.fps) videoOpts.frameRate = c.fps;
        if (rot) {
          videoOpts.rotate = rot;
          notes.push(`повёрнуто на ${rot}°`);
        }
        encoding = true;
        notes.push(codecLabel);
      }
    }

    // Звук: решение для каждой оставленной дорожки
    const audioOpts = new Map();
    for (const x of kept) {
      const src = MB_CODEC[x.t.codec] || x.t.codec || '';
      const gained = Math.abs(x.gain - 1) > 0.001;
      let ac = c ? (to === 'webm' ? 'opus' : 'aac') : edit.audioCodec || 'auto';
      if (ac === 'copy' && gained) ac = 'auto';
      if (ac === 'copy' && !canCopy('audio', to, src)) {
        throw userError(`Звук в кодеке ${src.toUpperCase()} нельзя положить в ${FORMATS[to].label} без перекодирования — выберите аудиокодек`);
      }
      if (ac === 'auto') ac = fast && !gained && autoCopy('audio', to, src) ? 'copy' : cont.audio[0];
      if (ac === 'copy') {
        audioOpts.set(x.t, {});
        continue;
      }
      const codec = WC_ACHOICE[ac];
      if (!codec) throw new Error(`браузер не кодирует ${ac}`); // MP3, FLAC… — это сделает FFmpeg
      const br = Math.min(c?.akbps || opts.audioBitrate || 192, codec === 'opus' ? 256 : 320);
      const o = { codec, forceTranscode: true };
      if (!codec.startsWith('pcm')) o.bitrate = br * 1000;
      if (c?.mono) o.numberOfChannels = 1;
      if (gained) {
        o.sampleFormat = 'f32';
        o.process = gainProcessor(mb, x.gain);
      }
      audioOpts.set(x.t, o);
      encoding = true;
    }

    conv = await mb.Conversion.init({
      input,
      output,
      video: (track) => (track === videos[0] ? videoOpts : { discard: true }), // одна видеодорожка, как и в FFmpeg-пути
      audio: (track) => audioOpts.get(track) || { discard: true },
    });
  } catch (e) {
    if (e?.userFacing) throw e;
    throw new Error(/unsupported|format/i.test(e?.message || '') ? 'Браузер не умеет читать этот файл напрямую' : e?.message || String(e));
  }
  const lost = conv.discardedTracks.find((d) => d.reason !== 'discarded_by_user');
  if (!conv.isValid || lost) {
    const why = DISCARD_REASONS[lost?.reason] || lost?.reason || 'неподдерживаемый формат';
    throw new Error(lost?.track.type === 'video' && codecLabel
      ? `Не получилось кодировать в ${codecLabel}: ${why}.`
      : `Браузер не справился с дорожкой (${lost?.track.type === 'video' ? 'видео' : 'звук'}): ${why}.`);
  }
  const onAbort = () => conv.cancel();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const verb = encoding ? `Кодирование${codecLabel ? ` ${codecLabel}` : ''}` : 'Перепаковка';
  conv.onProgress = (p) => status(`${verb}… ${Math.round(p * 100)}%`, 0.05 + p * 0.95);
  try {
    await conv.execute();
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException('Отменено', 'AbortError');
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  const data = output.target.buffer;
  if (!data?.byteLength) throw new Error('Получился пустой файл');
  return [{
    blob: new Blob([data], { type: FORMATS[to]?.mime || 'application/octet-stream' }),
    name: `${baseName(file.name)}.${to}`,
    note: sizeNote(edit, to, data.byteLength) || notes.join(' · ') || undefined,
  }];
}

function formatDur(sec) {
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  if (hh) return m ? `${hh} ч ${m} мин` : `${hh} ч`;
  return m ? (s ? `${m} мин ${s} с` : `${m} мин`) : `${s} с`;
}

/** Понятное сообщение по логу FFmpeg. */
function explain(log) {
  const text = log.join('\n');
  if (/does not contain any stream|Output file .* does not contain|matches no streams/i.test(text)) return 'В файле нет подходящей дорожки (например, у видео нет звука)';
  if (/Invalid data found|moov atom not found|could not find codec parameters/i.test(text)) return 'Файл повреждён или это не медиафайл';
  if (/Cannot allocate memory|out of memory|OOM/i.test(text)) return 'Не хватило памяти браузера. Попробуйте файл поменьше или сожмите видео с уменьшением разрешения.';
  if (/codec not currently supported in container|Could not find tag for codec/i.test(text)) return 'Этот кодек нельзя положить в выбранный формат — выберите другой кодек';
  const last = log.filter((l) => /error|invalid|unsupported|not/i.test(l)).pop();
  return last ? `FFmpeg: ${last.trim().slice(0, 160)}` : 'FFmpeg не смог сконвертировать файл';
}
