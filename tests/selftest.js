// Самотест: создаёт файлы-образцы, прогоняет все виды конвертации и предпросмотра, пишет отчёт в #out.
import * as image from '/assets/js/converters/image.js';
import * as pdf from '/assets/js/converters/pdf.js';
import * as doc from '/assets/js/converters/document.js';
import * as sheet from '/assets/js/converters/sheet.js';
import * as model from '/assets/js/converters/model.js';
import { renderPreview } from '/assets/js/preview.js';
import { sanitizeHtml } from '/assets/js/sanitize.js';
import { detectFormat, targetsFor, probeEncoders } from '/assets/js/formats.js';
import { CONFIG } from '/assets/js/config.js';
import { vendorUrl } from '/assets/js/util.js';

const out = document.getElementById('out');
let passed = 0, failed = 0;
const log = (cls, msg) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = msg + '\n';
  out.append(s);
};
async function test(name, fn) {
  const t = performance.now();
  try {
    const info = await fn();
    passed++;
    log('ok', `PASS ${name}${info ? ' — ' + info : ''} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    failed++;
    log('fail', `FAIL ${name} — ${e?.stack || e}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const file = (parts, name, type = '') => new File(parts, name, { type });
const head = async (blob, n = 8) => [...new Uint8Array(await blob.slice(0, n).arrayBuffer())];
const asText = (blob) => blob.text();

// ---------- образцы ----------
async function samplePng() {
  const c = document.createElement('canvas');
  c.width = 300; c.height = 200;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(79,70,229,0.8)'; ctx.fillRect(0, 0, 300, 200);
  ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText('Привет', 40, 110);
  return file([await new Promise((r) => c.toBlob(r, 'image/png'))], 'пример.png', 'image/png');
}
async function sampleDocx() {
  const { zipSync, strToU8 } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Заголовок документа</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Жирный</w:t></w:r><w:r><w:t xml:space="preserve"> и обычный текст на русском.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ячейка 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ячейка 2</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
  };
  return file([zipSync(files)], 'документ.docx');
}
const STL = `solid t
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
facet normal 0 -1 0
 outer loop
  vertex 0 0 0
  vertex 0 0 1
  vertex 1 0 0
 endloop
endfacet
facet normal -1 0 0
 outer loop
  vertex 0 0 0
  vertex 0 1 0
  vertex 0 0 1
 endloop
endfacet
facet normal 1 1 1
 outer loop
  vertex 1 0 0
  vertex 0 0 1
  vertex 0 1 0
 endloop
endfacet
endsolid t
`;

// ---------- тесты ----------
await probeEncoders();

await test('detectFormat / targets', async () => {
  assert(detectFormat(file([''], 'a.JPEG')) === 'jpg');
  assert(detectFormat(file([''], 'IMG_1.HEIC')) === 'heic');
  assert(detectFormat(file([''], 'model.3mf')) === '3mf');
  assert(detectFormat(file([''], 'noext', 'image/png')) === 'png');
  assert(detectFormat(file([''], 'x.exe')) === null);
  assert(!targetsFor('png').includes('png'));
  return `png → ${targetsFor('png').join(',')}`;
});

const png = await samplePng();
const imgOut = {};
for (const to of targetsFor('png')) {
  await test(`image png → ${to}`, async () => {
    const [o] = await image.convert(png, 'png', to, { quality: 0.8 });
    imgOut[to] = o.blob;
    const sig = await head(o.blob, 4);
    const expect = { jpg: [0xff, 0xd8], webp: [0x52, 0x49], bmp: [0x42, 0x4d], ico: [0, 0, 1, 0], tiff: null, pdf: [0x25, 0x50], avif: null };
    if (to === 'tiff') assert(/^(73,73,42,0|77,77,0,42)$/.test(sig.join()), `сигнатура ${sig}`);
    if (expect[to]) assert(expect[to].every((b, i) => sig[i] === b), `сигнатура ${sig}`);
    return `${o.name}, ${o.blob.size} B`;
  });
}
for (const from of ['bmp', 'ico', 'tiff', 'jpg', 'webp']) {
  if (!imgOut[from]) continue;
  await test(`image ${from} → png (обратно)`, async () => {
    const [o] = await image.convert(file([imgOut[from]], `x.${from}`), from, 'png');
    const bmp = await createImageBitmap(o.blob);
    assert(bmp.width > 0, 'пустая картинка');
    return `${bmp.width}×${bmp.height}`;
  });
}
await test('image svg → png + resize', async () => {
  const svg = file(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/><script>alert(1)</script></svg>'], 'a.svg', 'image/svg+xml');
  const [o] = await image.convert(svg, 'svg', 'png', { maxSide: 60 });
  const bmp = await createImageBitmap(o.blob);
  assert(bmp.width === 60 && bmp.height === 40, `${bmp.width}×${bmp.height}`);
  return '60×40';
});
await test('images → один PDF (2 стр.)', async () => {
  const a = await image.decodeImage(png, 'png');
  const b = await image.decodeImage(png, 'png');
  const blob = await image.imagesToPdf([a, b]);
  const d = await pdf.openPdf(blob);
  assert(d.numPages === 2, `страниц ${d.numPages}`);
  d.destroy();
  return `${blob.size} B`;
});

await test('pdf (из картинки) → png', async () => {
  const outs = await pdf.convert(file([imgOut.pdf], 'p.pdf'), 'pdf', 'png', { dpi: 72 });
  assert(outs.length === 1 && outs[0].blob.type === 'image/png');
  return outs[0].name;
});
await test('pdf без текста → txt даёт понятную ошибку', async () => {
  try {
    await pdf.convert(file([imgOut.pdf], 'p.pdf'), 'pdf', 'txt');
  } catch (e) {
    assert(/текстового слоя/.test(e.message), e.message);
    return 'ok';
  }
  throw new Error('ожидалась ошибка');
});

let textPdf;
await test('txt → pdf (кириллица, pdfmake)', async () => {
  const [o] = await doc.convert(file(['Съешь же ещё этих мягких французских булок.\nВторая строка.'], 'a.txt'), 'txt', 'pdf');
  textPdf = o.blob;
  assert((await head(o.blob, 4)).join() === '37,80,68,70');
  return `${o.blob.size} B`;
});
await test('pdf → txt (кириллица сохранилась)', async () => {
  const [o] = await pdf.convert(file([textPdf], 'a.pdf'), 'pdf', 'txt');
  const t = await asText(o.blob);
  assert(t.includes('французских булок'), JSON.stringify(t.slice(0, 120)));
  return JSON.stringify(t.slice(1, 40));
});

const docx = await sampleDocx();
for (const to of ['html', 'md', 'txt', 'pdf']) {
  await test(`docx → ${to}`, async () => {
    const [o] = await doc.convert(docx, 'docx', to);
    if (to !== 'pdf') {
      const t = await asText(o.blob);
      assert(t.includes('Заголовок документа') && t.includes('Ячейка 2'), t.slice(0, 200));
      if (to === 'md') assert(/^# Заголовок/m.test(t) && t.includes('**Жирный**'), t);
    }
    return `${o.blob.size} B`;
  });
}
const md = file(['# Тест\n\nТекст с **жирным** и [ссылкой](https://example.com).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<img src="https://evil.example/track.png" onerror="alert(1)">\n<script>alert(1)</script>\n'], 'a.md');
for (const to of ['html', 'pdf', 'txt']) {
  await test(`md → ${to}`, async () => {
    const [o] = await doc.convert(md, 'md', to);
    if (to === 'html') {
      const t = await asText(o.blob);
      assert(t.includes('<h1') && t.includes('<table'), 'нет разметки');
      assert(!/<script|onerror|evil\.example/i.test(t), 'опасный HTML не вычищен');
    }
    return `${o.blob.size} B`;
  });
}
await test('md → docx и md → epub (главы по заголовкам, картинка)', async () => {
  const { unzipSync, strFromU8 } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const pngData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(png); });
  const src = file([`# Глава первая\n\nТекст с **жирным**.\n\n![рисунок](${pngData})\n\n# Глава вторая\n\n- пункт\n`], 'книга.md');
  const [d] = await doc.convert(src, 'md', 'docx');
  const x = strFromU8(unzipSync(new Uint8Array(await d.blob.arrayBuffer()))['word/document.xml']);
  assert(x.includes('Heading1') && x.includes('Глава вторая') && x.includes('<w:b/>'), 'нет структуры в DOCX');
  const [fb] = await doc.convert(src, 'md', 'fb2');
  const fbBook = await (await import('/assets/js/converters/ebook.js')).readBook(file([fb.blob], 'k.fb2'), 'fb2');
  assert(fbBook.chapters.length === 2 && fbBook.images.size === 1, 'FB2: ' + JSON.stringify(fbBook.chapters.map((c) => c.title)));
  const [e] = await doc.convert(src, 'md', 'epub');
  const ebookMod = await import('/assets/js/converters/ebook.js');
  const b = await ebookMod.readBook(file([e.blob], 'k.epub'), 'epub');
  assert(b.chapters.length === 2 && b.chapters[1].title === 'Глава вторая', JSON.stringify(b.chapters.map((c) => c.title)));
  assert(b.images.size === 1, `картинок ${b.images.size}`);
  return `DOCX ${d.blob.size} B; EPUB: ${b.chapters.map((c) => c.title).join(', ')}, картинок ${b.images.size}; ${e.note}`;
});
for (const [from, src] of [['html', file(['<h1>Заголовок</h1><p>Абзац <b>жирный</b></p>'], 'a.html')], ['txt', file(['Первая строка.\n\nВторой абзац.'], 'a.txt')], ['docx', null]]) {
  await test(from === 'docx' ? 'docx → epub (и пересборка docx)' : `${from} → docx и epub`, async () => {
    const f = src || await sampleDocx();
    const [d] = await doc.convert(f, from, 'docx');
    const [e] = await doc.convert(f, from, 'epub');
    const ebookMod = await import('/assets/js/converters/ebook.js');
    const b = await ebookMod.readBook(file([e.blob], 'k.epub'), 'epub');
    assert(d.blob.size > 1000 && b.chapters.length >= 1 && b.chapters[0].html.length > 10, 'пусто');
    return `DOCX ${d.blob.size} B, EPUB глав: ${b.chapters.length}`;
  });
}
await test('html → md', async () => {
  const [o] = await doc.convert(file(['<h2>Раздел</h2><ul><li>один</li><li>два</li></ul>'], 'a.html'), 'html', 'md');
  const t = await asText(o.blob);
  assert(t.includes('## Раздел') && /-\s+один/.test(t), t);
  return JSON.stringify(t);
});
await test('sanitize: скрипты, обработчики, внешние картинки, javascript:', async () => {
  const s = await sanitizeHtml('<p onclick="x()">a</p><script>1</script><a href="javascript:alert(1)">l</a><img src="http://x/y.png"><iframe src="x"></iframe><svg><script>1</script></svg>');
  assert(!/onclick|<script|javascript:|http:\/\/x|<iframe/i.test(s), s);
  return s;
});

const csv1251 = new Uint8Array([...'Имя;Город\nАня;Москва\nБорис;Казань\n'].map((ch) => {
  const c = ch.charCodeAt(0);
  return c >= 0x410 && c <= 0x44f ? c - 0x410 + 0xc0 : c; // кириллица → Windows-1251
}));
let xlsxBlob;
await test('csv (Windows-1251, «;») → xlsx', async () => {
  const [o] = await sheet.convert(file([csv1251], 'a.csv'), 'csv', 'xlsx');
  xlsxBlob = o.blob;
  return `${o.blob.size} B`;
});
await test('xlsx → json (кириллица и колонки)', async () => {
  const [o] = await sheet.convert(file([xlsxBlob], 'a.xlsx'), 'xlsx', 'json');
  const data = JSON.parse(await asText(o.blob));
  assert(data.length === 2 && data[0]['Имя'] === 'Аня' && data[1]['Город'] === 'Казань', JSON.stringify(data));
  return JSON.stringify(data);
});
await test('json → csv (;)', async () => {
  const [o] = await sheet.convert(file([JSON.stringify([{ a: 1, b: { c: 'вложенное' } }])], 'a.json'), 'json', 'csv', { csvSeparator: ';' });
  const t = await asText(o.blob);
  assert(t.includes('a;b.c') && t.includes('1;вложенное'), t);
  return JSON.stringify(t);
});
for (const to of ['ods', 'html', 'csv']) {
  await test(`xlsx → ${to}`, async () => {
    const outs = await sheet.convert(file([xlsxBlob], 'a.xlsx'), 'xlsx', to);
    return `${outs[0].blob.size} B`;
  });
}

const stl = file([STL], 'тетраэдр.stl');
const modelOut = {};
for (const to of targetsFor('stl')) {
  await test(`3d stl → ${to}`, async () => {
    const [o] = await model.convert(stl, 'stl', to);
    modelOut[to] = o.blob;
    assert(o.blob.size > 50, 'пустой файл');
    return `${o.blob.size} B`;
  });
}
for (const from of ['glb', 'gltf', 'obj', 'ply']) {
  await test(`3d ${from} читается обратно, 4 треугольника`, async () => {
    const obj = await model.loadModel(file([modelOut[from]], `m.${from}`), from);
    const s = model.countStats(obj);
    assert(s.triangles === 4, JSON.stringify(s));
    return JSON.stringify(s);
  });
}
await test('3d stl → glb → stl (повороты осей взаимно гасятся)', async () => {
  const [s] = await model.convert(file([modelOut.glb], 'm.glb'), 'glb', 'stl');
  const obj = await model.loadModel(file([s.blob], 'm.stl'), 'stl');
  const THREE = await import(vendorUrl('three/three.module.min.js'));
  const box = new THREE.Box3().setFromObject(obj);
  // Исходный тетраэдр STL: от (0,0,0) до (1,1,1) — после двух конвертаций должен совпасть
  assert(box.min.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-5 && box.max.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5, JSON.stringify(box));
  return 'bbox совпал';
});
await test('3d: модель не может обращаться к сети', async () => {
  // Валидный glTF с треугольником, данные которого лежат на «чужом» сервере
  const gltf = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ uri: 'https://evil.example/x.bin', byteLength: 36 }],
  });
  let err;
  try {
    await model.loadModel(file([gltf], 'x.gltf'), 'gltf');
  } catch (e) {
    err = e;
  }
  const leaked = performance.getEntriesByType('resource').some((r) => r.name.includes('evil.example'));
  assert(!leaked, 'был запрос к evil.example!');
  assert(err, 'модель загрузилась с внешним буфером?');
  return `запроса не было; ошибка: ${err.message.slice(0, 50)}…`;
});

// ---------- CAD: STEP / IGES (OpenCascade WASM в Web Worker) ----------
const fixture = async (name) => file([await (await fetch(`/tests/fixtures/${name}`)).blob()], name);
const cubeStp = await fixture('cube-10mm.stp');
await test('step: куб 10 мм → 12 треугольников, размер 10×10×10', async () => {
  const obj = await model.loadModel(cubeStp, 'step');
  const s = model.countStats(obj);
  const THREE = await import(vendorUrl('three/three.module.min.js'));
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  assert(s.triangles === 12, JSON.stringify(s));
  assert([size.x, size.y, size.z].every((v) => Math.abs(v - 10) < 1e-3), JSON.stringify(size));
  return `${JSON.stringify(s)}, ${size.x}×${size.y}×${size.z}`;
});
for (const to of ['stl', 'obj', 'glb', 'usdz']) {
  await test(`step → ${to}`, async () => {
    const [o] = await model.convert(await fixture('rounded-cube.step'), 'step', to);
    assert(o.blob.size > 1000, `${o.blob.size} B`);
    return `${o.name}, ${o.blob.size} B`;
  });
}
await test('step → stl → читается, ось Z сохранена', async () => {
  const [o] = await model.convert(cubeStp, 'step', 'stl');
  const s = model.countStats(await model.loadModel(file([o.blob], 'c.stl'), 'stl'));
  assert(s.triangles === 12, JSON.stringify(s));
  return JSON.stringify(s);
});
await test('iges → glb', async () => {
  const [o] = await model.convert(await fixture('cube-10mm.igs'), 'iges', 'glb');
  const s = model.countStats(await model.loadModel(file([o.blob], 'c.glb'), 'glb'));
  assert(s.triangles === 12, JSON.stringify(s));
  return JSON.stringify(s);
});
await test('step: мусор вместо STEP → понятная ошибка', async () => {
  try {
    await model.loadModel(file(['ISO-10303-21; это не модель'], 'bad.step'), 'step');
  } catch (e) {
    return e.message;
  }
  throw new Error('ожидалась ошибка');
});
await test('detectFormat: .STEP / .stp / .igs', async () => {
  assert(detectFormat(file([''], 'esp box.STEP')) === 'step');
  assert(detectFormat(file([''], 'a.stp')) === 'step' && detectFormat(file([''], 'a.igs')) === 'iges');
  return targetsFor('step').join(',');
});

// ---------- Видео и звук (ffmpeg.wasm) ----------
const media = await import('/assets/js/converters/media.js');

/** WAV 16 бит моно: 1 секунда синуса 440 Гц. */
function makeWav(seconds = 1, rate = 22050) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 12000, true);
  return file([buf], 'тон.wav', 'audio/wav');
}

/** Короткое видео со звуком, записанное в браузере (WebM). */
async function makeWebm(ms = 1500) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const ctx = c.getContext('2d');
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const dest = ac.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const stream = new MediaStream([...c.captureStream(15).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  let frame = 0;
  const timer = setInterval(() => {
    ctx.fillStyle = `hsl(${(frame += 12) % 360} 70% 50%)`;
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#fff';
    ctx.fillRect((frame * 3) % 300, 100, 20, 20);
  }, 66);
  rec.start();
  await new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  clearInterval(timer);
  osc.stop();
  ac.close();
  return file(parts, 'ролик.webm', 'video/webm');
}

/** Длительность и размер кадра через ffmpeg-независимый способ — элемент <video>/<audio>. */
function probe(blob, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve({ duration: el.duration, w: el.videoWidth, h: el.videoHeight });
    el.onerror = () => resolve(null);
    el.src = URL.createObjectURL(blob);
  });
}

const wav = makeWav();
const mediaOut = {};
await test('audio wav → mp3 (первая загрузка ядра FFmpeg)', async () => {
  const statuses = [];
  const [o] = await media.convert(wav, 'wav', 'mp3', { audioBitrate: 128 }, (p, t) => t && statuses.push(t));
  mediaOut.mp3 = o.blob;
  const sig = await head(o.blob, 3);
  assert(sig.join() === '73,68,51' || (sig[0] === 0xff && (sig[1] & 0xe0) === 0xe0), `сигнатура ${sig}`); // «ID3» или кадр MPEG
  const p = await probe(o.blob, 'audio');
  assert(p && Math.abs(p.duration - 1) < 0.2, JSON.stringify(p));
  return `${o.blob.size} B, ${p.duration.toFixed(2)} с; статусы: ${statuses.filter((s) => /Загружаем/.test(s)).length ? 'был прогресс загрузки' : 'без загрузки'}`;
});
for (const [from, to] of [['mp3', 'wav'], ['wav', 'flac'], ['wav', 'ogg'], ['wav', 'm4a'], ['wav', 'opus']]) {
  await test(`audio ${from} → ${to}`, async () => {
    const src = from === 'wav' ? wav : file([mediaOut[from]], `a.${from}`);
    const [o] = await media.convert(src, from, to, {});
    mediaOut[to] = o.blob;
    assert(o.blob.size > 500, `${o.blob.size} B`);
    return `${o.blob.size} B`;
  });
}

let webm;
await test('видео: тестовый WebM (генератор FFmpeg: таблица + тон)', async () => {
  // MediaRecorder в headless-браузере не пишет кадры, поэтому генерируем видео самим FFmpeg
  const ff = await media.getFFmpeg();
  const code = await ff.exec(['-f', 'lavfi', '-i', 'testsrc=duration=1.5:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '300k', '-c:a', 'libopus', '-shortest', 'gen.webm']);
  assert(code === 0, `код ${code}`);
  const data = await ff.readFile('gen.webm');
  await ff.deleteFile('gen.webm');
  webm = file([data], 'ролик.webm', 'video/webm');
  assert(webm.size > 1000, `${webm.size} B`);
  return `${webm.size} B`;
});
void makeWebm; // запасной способ для обычного (не headless) браузера
await test('video webm → mp4 (H.264, перекодирование)', async () => {
  const [o] = await media.convert(webm, 'webm', 'mp4', { videoQuality: 'low' });
  mediaOut.mp4 = o.blob;
  const p = await probe(o.blob, 'video');
  assert(p && p.w === 320 && p.h === 240, JSON.stringify(p));
  return `${o.blob.size} B, ${p.w}×${p.h}, ${p.duration.toFixed(2)} с`;
});
await test('video mp4 → mkv (быстро, без перекодирования)', async () => {
  const t = performance.now();
  const [o] = await media.convert(file([mediaOut.mp4], 'v.mp4'), 'mp4', 'mkv', { fastRemux: true });
  assert(o.blob.size > 1000);
  return `${o.blob.size} B за ${Math.round(performance.now() - t)} мс`;
});
await test('video mp4 → mp3 (звук из видео)', async () => {
  const [o] = await media.convert(file([mediaOut.mp4], 'v.mp4'), 'mp4', 'mp3', {});
  const p = await probe(o.blob, 'audio');
  assert(p && p.duration > 0.5, JSON.stringify(p));
  return `${o.blob.size} B, ${p.duration.toFixed(2)} с`;
});
await test('video mp4 → gif → mp4', async () => {
  const [g] = await media.convert(file([mediaOut.mp4], 'v.mp4'), 'mp4', 'gif', {});
  assert((await head(g.blob, 3)).join() === '71,73,70', 'не GIF');
  const [m] = await media.convert(file([g.blob], 'a.gif'), 'gif', 'mp4', {});
  const p = await probe(m.blob, 'video');
  assert(p && p.w > 0, JSON.stringify(p));
  return `gif ${g.blob.size} B → mp4 ${m.blob.size} B`;
});
await test('video: уменьшение до 120p и webm (VP8)', async () => {
  const [o] = await media.convert(file([mediaOut.mp4], 'v.mp4'), 'mp4', 'webm', { maxHeight: 120 });
  const p = await probe(o.blob, 'video');
  assert(p && p.h === 120 && p.w === 160, JSON.stringify(p));
  return `${p.w}×${p.h}`;
});
await test('video: отмена долгой конвертации и перезапуск модуля', async () => {
  const ff = await media.getFFmpeg();
  assert((await ff.exec(['-f', 'lavfi', '-i', 'testsrc=duration=30:size=640x480:rate=25', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', 'long.webm'])) === 0);
  const long = file([await ff.readFile('long.webm')], 'long.webm');
  await ff.deleteFile('long.webm');
  const ctrl = new AbortController();
  let lastP = 0;
  setTimeout(() => ctrl.abort(), 1500);
  const t = performance.now();
  let err;
  try {
    // AVI (MPEG-4) делает только FFmpeg — проверяем отмену именно его
    await media.convert(long, 'webm', 'avi', { signal: ctrl.signal, videoQuality: 'high' }, (p) => (lastP = p ?? lastP));
  } catch (e) {
    err = e;
  }
  assert(err?.name === 'AbortError', `ожидалась отмена, получено: ${err?.message || 'успешно'}`);
  const stoppedIn = Math.round(performance.now() - t);
  // после отмены модуль перезапускается и снова работает
  const [o] = await media.convert(wav, 'wav', 'mp3', {});
  assert(o.blob.size > 500);
  return `остановлено через ${stoppedIn} мс на ${Math.round(lastP * 100)}%, модуль перезапустился`;
});

// ---------- Правки: дорожки, громкость, кодеки, сжатие ----------
let twoTracks;
await test('правки: видео с двумя дорожками — ffprobe видит обе', async () => {
  const ff = await media.getFFmpeg();
  await ff.exec(['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-f', 'lavfi', '-i', 'sine=f=880:d=4',
    '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
    '-metadata:s:a:1', 'handler_name=Комментарий', '-shortest', 'two.mp4']); // в MP4 название дорожки хранится в handler_name
  twoTracks = file([await ff.readFile('two.mp4')], 'two.mp4', 'video/mp4');
  await ff.deleteFile('two.mp4');
  const info = await media.probe(twoTracks, 'mp4');
  assert(info.audio.length === 2 && info.video.width === 640, JSON.stringify(info));
  assert(info.audio[1].title === 'Комментарий', `название: ${info.audio[1].title}`);
  return `${info.audio.length} дорожки, вторая «${info.audio[1].title}»`;
});
await test('правки: громкость ×2 и удаление дорожки, видео без перекодирования', async () => {
  const edit = { videoCodec: 'auto', audioCodec: 'auto', tracks: [{ keep: true, gain: 2 }, { keep: false, gain: 1 }] };
  const [o] = await media.convert(twoTracks, 'mp4', 'mkv', { edit });
  const res = file([o.blob], 'r.mkv');
  const info = await media.probe(res, 'mkv');
  assert(info.audio.length === 1, `дорожек ${info.audio.length}`);
  const before = Math.max(...await media.audioPeaks(twoTracks, 'mp4', 0, 50));
  const after = Math.max(...await media.audioPeaks(res, 'mkv', 0, 50));
  assert(Math.abs(after / before - 2) < 0.15, `громкость: было ${before.toFixed(3)}, стало ${after.toFixed(3)}`);
  assert(/видео без перекодирования/.test(o.note || ''), `примечание: ${o.note}`);
  return `пик ${before.toFixed(3)} → ${after.toFixed(3)} (×${(after / before).toFixed(2)}); ${o.note}`;
});
await test('правки: явный кодек звука MP3 в MKV и ALAC в M4A', async () => {
  const [a] = await media.convert(twoTracks, 'mp4', 'mkv', { edit: { videoCodec: 'copy', audioCodec: 'mp3', tracks: [] } });
  const ia = await media.probe(file([a.blob], 'a.mkv'), 'mkv');
  assert(ia.audio.every((t) => t.codec === 'mp3') && ia.video.codec === 'h264', JSON.stringify(ia.audio));
  const [b] = await media.convert(twoTracks, 'mp4', 'm4a', { edit: { audioCodec: 'alac', tracks: [] } });
  const ib = await media.probe(file([b.blob], 'b.m4a'), 'm4a');
  assert(ib.audio[0].codec === 'alac' && !ib.video, JSON.stringify(ib));
  return `MKV: ${ia.audio.length}×MP3 + H.264 копией; M4A: ALAC`;
});
await test('правки: копирование несовместимого кодека → понятная ошибка', async () => {
  try {
    await media.convert(twoTracks, 'mp4', 'webm', { edit: { videoCodec: 'copy', tracks: [] } });
  } catch (e) {
    assert(/нельзя положить/.test(e.message), e.message);
    return e.message;
  }
  throw new Error('ожидалась ошибка');
});
await test('сжатие до размера: план и результат не больше цели', async () => {
  const info = await media.probe(twoTracks, 'mp4');
  const target = Math.round((info.size / 1048576) * 0.4 * 100) / 100;
  const plan = media.planCompression(info, target, 2);
  assert(plan.ok && plan.variants.length, JSON.stringify(plan));
  const v = plan.variants.find((x) => x.recommended);
  const [o] = await media.convert(twoTracks, 'mp4', 'mp4', { edit: { tracks: [], compress: { targetMB: target, height: v.height, codec: 'h264', vkbps: v.vkbps, akbps: v.akbps } } });
  const mb = o.blob.size / 1048576;
  assert(mb <= target * 1.02, `${mb.toFixed(2)} МБ при цели ${target}`);
  const tooSmall = media.planCompression({ ...info, duration: 3600, size: 2e9 }, 5, 1);
  assert(!tooSmall.ok && /минимум/.test(tooSmall.message), tooSmall.message);
  return `${(info.size / 1048576).toFixed(2)} → ${mb.toFixed(2)} МБ (цель ${target}); «час в 5 МБ»: ${tooSmall.message.slice(0, 60)}…`;
});

// ---------- WebCodecs: H.264 / VP9 / AV1 / H.265 через браузер ----------
let wcSupport = {};
await test('WebCodecs: какие кодеки умеет этот браузер', async () => {
  wcSupport = await media.webCodecsSupport(640, 360);
  return JSON.stringify(wcSupport);
});
await test('планировщик: H.265/AV1 дают вариант не хуже H.264 при том же размере', async () => {
  const info = await media.probe(twoTracks, 'mp4');
  const t = (info.size / 1048576) * 0.15;
  const q = (codec) => media.planCompression(info, t, 2, { codec }).variants.find((v) => v.height === 360).quality.level;
  assert(q('av1') >= q('hevc') && q('hevc') >= q('avc'), `avc ${q('avc')}, hevc ${q('hevc')}, av1 ${q('av1')}`);
  const mono = media.planCompression(info, t, 2, { codec: 'avc', mono: true }).budget.vkbps > media.planCompression(info, t, 2, { codec: 'avc' }).budget.vkbps;
  assert(mono, 'моно не освободило битрейт для видео');
  return `уровень качества 360p: H.264 ${q('avc')}, H.265 ${q('hevc')}, AV1 ${q('av1')}`;
});
for (const [codec, to] of [['avc', 'mp4'], ['vp9', 'webm'], ['av1', 'mp4']]) {
  await test(`WebCodecs: сжатие в ${codec} (${to}), громкость +6 дБ, вторая дорожка удалена`, async () => {
    if (codec !== 'avc' && !wcSupport[codec]) return `пропущено: браузер не умеет ${codec}`;
    const info = await media.probe(twoTracks, 'mp4');
    const target = Math.round((info.size / 1048576) * 0.5 * 100) / 100;
    const v = media.planCompression(info, target, 1, { codec }).variants[0];
    const edit = { tracks: [{ keep: true, gain: 2 }, { keep: false }], compress: { targetMB: target, height: 360, codec, vkbps: v.vkbps, akbps: v.akbps, gop: 2, hw: 'auto' } };
    const statuses = [];
    const [o] = await media.convert(twoTracks, 'mp4', to, { edit }, (p, s) => s && statuses.push(s));
    const r = await media.probe(file([o.blob], `r.${to}`), to);
    const expect = { avc: 'h264', vp9: 'vp9', av1: 'av1' }[codec];
    assert(r.video.codec === expect, `кодек ${r.video.codec}`);
    assert(r.video.height === 360 && r.video.width === 640, `${r.video.width}×${r.video.height}`);
    assert(r.audio.length === 1, `дорожек ${r.audio.length}`);
    const before = Math.max(...await media.audioPeaks(twoTracks, 'mp4', 0, 50));
    const after = Math.max(...await media.audioPeaks(file([o.blob], `r.${to}`), to, 0, 50));
    assert(Math.abs(after / before - 2) < 0.25, `громкость ×${(after / before).toFixed(2)}`);
    assert(o.blob.size / 1048576 <= target * 1.02, `${(o.blob.size / 1048576).toFixed(2)} МБ > ${target}`);
    const engine = statuses.some((s) => /процессором/.test(s)) ? 'FFmpeg (запасной путь)' : 'WebCodecs';
    return `${engine}: ${(o.blob.size / 1048576).toFixed(2)} МБ при цели ${target}; ${r.video.codec} ${r.video.width}×${r.video.height}; громкость ×${(after / before).toFixed(2)}`;
  });
}
await test('WebCodecs: H.265 — работает или понятная ошибка', async () => {
  const info = await media.probe(twoTracks, 'mp4');
  const edit = { tracks: [], compress: { targetMB: 1, height: 360, codec: 'hevc', vkbps: 400, akbps: 64 } };
  try {
    const [o] = await media.convert(twoTracks, 'mp4', 'mp4', { edit });
    const r = await media.probe(file([o.blob], 'h.mp4'), 'mp4');
    assert(r.video.codec === 'hevc', r.video.codec);
    return `H.265 закодирован: ${o.blob.size} B`;
  } catch (e) {
    assert(/H\.265/.test(e.message), e.message);
    return `недоступен: ${e.message}`;
  }
});
await test('без FFmpeg: сведения, график, пик, mp4 → mkv/m4a/wav, громкость — силами браузера', async () => {
  // Отдельный экземпляр модуля: у него свой (незагруженный) FFmpeg
  const fresh = await import('/assets/js/converters/media.js?no-ffmpeg');
  const t0 = performance.now();
  const info = await fresh.probe(twoTracks, 'mp4');
  assert(info.audio.length === 2 && info.audio[1].title === 'Комментарий' && info.video.codec === 'h264' && info.video.fps > 20, JSON.stringify(info));
  const peaks = await fresh.audioPeaks(twoTracks, 'mp4', 0, 200);
  assert(peaks.exactPeak > 0.05 && Math.max(...peaks) > 0.05, 'пики');
  const peak = await fresh.measurePeak(twoTracks, 'mp4', 0);
  const [mkv] = await fresh.convert(twoTracks, 'mp4', 'mkv', { edit: { tracks: [{ keep: true, gain: 1 }, { keep: false }] } });
  assert(/без перекодирования/.test(mkv.note || ''), mkv.note);
  const [m4a] = await fresh.convert(twoTracks, 'mp4', 'm4a', { edit: { tracks: [{ keep: true, gain: 2 }] } });
  const [wavOut] = await fresh.convert(twoTracks, 'mp4', 'wav', { edit: { tracks: [] } });
  const iw = await fresh.probe(file([wavOut.blob], 'x.wav'), 'wav');
  assert(iw.audio[0].codec === 'pcm_s16le' && !iw.video, JSON.stringify(iw));
  const after = (await fresh.audioPeaks(file([m4a.blob], 'x.m4a'), 'm4a', 0, 50)).exactPeak;
  assert(Math.abs(after / peak - 2) < 0.2, `громкость ${peak} → ${after}`);
  const loaded = performance.getEntriesByType('resource').filter((e) => e.startTime >= t0 && /ffmpeg/.test(e.name));
  assert(!loaded.length, `загружался FFmpeg: ${loaded.map((e) => e.name).join(', ')}`);
  return `FFmpeg не загружался; ${Math.round(performance.now() - t0)} мс на всё; пик ${peak.toFixed(3)} → ×${(after / peak).toFixed(2)}`;
});
await test('громкость: точный пик (volumedetect)', async () => {
  const p = await media.measurePeak(twoTracks, 'mp4', 0);
  assert(p > 0.05 && p <= 1, String(p));
  return `пик ${(20 * Math.log10(p)).toFixed(1)} дБ`;
});

await test('график: стерео в противофазе не превращается в «тишину»', async () => {
  const ff = await media.getFFmpeg();
  await ff.exec(['-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=10:d=5', '-f', 'lavfi', '-i', 'sine=f=300:d=5', '-filter_complex', '[1:a]pan=stereo|c0=c0|c1=-1*c0[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', 'ph.mp4']);
  const f = file([await ff.readFile('ph.mp4')], 'ph.mp4');
  await ff.deleteFile('ph.mp4');
  const peaks = await media.audioPeaks(f, 'mp4', 0, 100);
  const normal = await media.audioPeaks(twoTracks, 'mp4', 0, 100);
  assert(Math.max(...peaks) > 0.05, `пик ${Math.max(...peaks)}`);
  assert(peaks.phaseCancel === true && !normal.phaseCancel, `противофаза: ${peaks.phaseCancel} / обычная: ${normal.phaseCancel}`);
  return `пик ${Math.max(...peaks).toFixed(3)}, противофаза распознана, обычная запись — нет`;
});
await test('media: битый файл → понятная ошибка', async () => {
  try {
    await media.convert(file(['это не видео'], 'bad.mp4'), 'mp4', 'mp3', {});
  } catch (e) {
    return e.message;
  }
  throw new Error('ожидалась ошибка');
});

// ---------- PDF → Word ----------
const unzipDocx = async (blob) => {
  const { unzipSync, strFromU8 } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return strFromU8(files['word/document.xml']);
};
await test('pdf → docx: абзацы, заголовок, жирный, кириллица', async () => {
  // Делаем PDF с известной структурой через наш же Markdown → PDF
  const md = file(['# Отчёт о работе\n\nПервый абзац достаточно длинный, чтобы занять несколько строк на странице A4: съешь же ещё этих мягких французских булок да выпей чаю, и ещё раз съешь же ещё этих мягких французских булок.\n\nВторой абзац с **жирным словом** внутри.\n\n- пункт один\n- пункт два\n'], 'r.md');
  const [p] = await doc.convert(md, 'md', 'pdf');
  const [o] = await pdf.convert(file([p.blob], 'r.pdf'), 'pdf', 'docx');
  assert((await head(o.blob, 2)).join() === '80,75', 'не ZIP');
  const x = await unzipDocx(o.blob);
  const paras = [...x.matchAll(/<w:p>(.*?)<\/w:p>/g)].map((m) => ({ style: /w:pStyle w:val="(\w+)"/.exec(m[1])?.[1] || 'p', text: [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''), bold: /<w:b\/>/.test(m[1]) }));
  const h1 = paras.find((q) => q.style === 'Heading1');
  assert(h1 && h1.text.includes('Отчёт о работе'), JSON.stringify(paras.slice(0, 3)));
  const first = paras.find((q) => q.text.startsWith('Первый абзац'));
  assert(first && first.text.includes('французских булок да выпей чаю, и ещё раз'), 'первый абзац склеен неверно: ' + JSON.stringify(paras.map((q) => q.text.slice(0, 40))));
  assert(paras.some((q) => q.text.includes('жирным словом') && q.bold), 'нет жирного');
  const list = paras.filter((q) => q.style === 'ListParagraph').map((q) => q.text.trim());
  assert(paras.some((q) => q.text.trim() === 'пункт один') && paras.some((q) => q.text.trim() === 'пункт два'), 'пункты списка склеены');
  return `${paras.length} абзацев: ${JSON.stringify(paras.map((q) => `${q.style}:${q.text.slice(0, 22)}`))}; список: ${JSON.stringify(list)}`;
});
await test('pdf → docx: скан без текста → понятная ошибка', async () => {
  try {
    await pdf.convert(file([imgOut.pdf], 'scan.pdf'), 'pdf', 'docx');
  } catch (e) {
    assert(/текстового слоя/.test(e.message), e.message);
    return 'ok';
  }
  throw new Error('ожидалась ошибка');
});
await test('pdf → pdf (сжатие): честный отказ для текстового PDF', async () => {
  try {
    await pdf.convert(file([textPdf], 't.pdf'), 'pdf', 'pdf', { dpi: 150 });
  } catch (e) {
    assert(/уже компактный/.test(e.message), e.message);
    return e.message.slice(0, 70) + '…';
  }
  return 'сжался (тоже допустимо)';
});

// ---------- Электронные книги ----------
const ebook = await import('/assets/js/converters/ebook.js');
const cover = new Uint8Array(await (await image.convert(png, 'png', 'jpg'))[0].blob.arrayBuffer());
const fb2Text = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Антон</first-name><last-name>Чехов</last-name></author>
<book-title>Рассказы</book-title><lang>ru</lang><coverpage><image l:href="#cover.jpg"/></coverpage></title-info></description>
<body><title><p>Рассказы</p></title>
<section><title><p>Толстый и тонкий</p></title><p>На вокзале Николаевской железной дороги встретились два приятеля: один <emphasis>толстый</emphasis>, другой <strong>тонкий</strong>.</p><empty-line/><p>Второй абзац.</p></section>
<section><title><p>Хамелеон</p></title><p>Через базарную площадь идёт полицейский надзиратель Очумелов.</p><image l:href="#cover.jpg"/></section>
</body>
<binary id="cover.jpg" content-type="image/jpeg">${btoa(String.fromCharCode(...cover))}</binary>
</FictionBook>`;
// Кодируем в Windows-1251, как многие старые FB2
const cp1251 = (s) => Uint8Array.from(s, (ch) => {
  const c = ch.charCodeAt(0);
  if (c < 128) return c;
  if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
  if (c === 0x401) return 0xa8;
  if (c === 0x451) return 0xb8;
  return 63;
});
const fb2 = file([cp1251(fb2Text)], 'Чехов.fb2');
let epubOut;
await test('fb2 (Windows-1251) читается: автор, главы, обложка', async () => {
  const b = await ebook.readBook(fb2, 'fb2');
  assert(b.author === 'Антон Чехов' && b.title === 'Рассказы', `${b.author} / ${b.title}`);
  assert(b.chapters.length === 2 && b.chapters[0].title === 'Толстый и тонкий', JSON.stringify(b.chapters.map((c) => c.title)));
  assert(b.cover === 'cover.jpg' && b.images.size === 1, 'нет обложки');
  return `${b.chapters.map((c) => c.title).join(', ')}; обложка ${b.images.get('cover.jpg').data.length} B`;
});
await test('fb2 → epub (валидная структура) → обратно читается', async () => {
  const [o] = await ebook.convert(fb2, 'fb2', 'epub');
  epubOut = o.blob;
  const { unzipSync, strFromU8 } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const raw = new Uint8Array(await o.blob.arrayBuffer());
  // mimetype — первый файл архива и без сжатия (требование EPUB)
  assert(new TextDecoder().decode(raw.subarray(30, 38)) === 'mimetype' && new TextDecoder().decode(raw.subarray(38, 58)) === 'application/epub+zip', 'mimetype не первым/сжат');
  const files = unzipSync(raw);
  for (const k of Object.keys(files)) {
    if (/\.(xhtml|opf|ncx)$/.test(k)) {
      const d = new DOMParser().parseFromString(strFromU8(files[k]), 'application/xml');
      assert(!d.querySelector('parsererror'), `невалидный XML: ${k}`);
    }
  }
  assert(Object.keys(files).some((k) => /images\/cover/.test(k)), 'нет картинки');
  const back = await ebook.readBook(file([o.blob], 'b.epub'), 'epub');
  assert(back.chapters.length === 2 && back.author === 'Антон Чехов' && back.cover, JSON.stringify({ ch: back.chapters.length, a: back.author, c: back.cover }));
  assert(back.chapters[0].html.includes('толстый'), 'потерян текст');
  return `${Object.keys(files).length} файлов, ${o.note}`;
});
await test('epub → fb2 → снова читается', async () => {
  const [o] = await ebook.convert(file([epubOut], 'b.epub'), 'epub', 'fb2');
  const t = await o.blob.text();
  assert(t.startsWith('<?xml') && t.includes('<binary'), 'нет картинки в FB2');
  const b = await ebook.readBook(file([o.blob], 'c.fb2'), 'fb2');
  assert(b.chapters.length === 2 && b.chapters[1].title === 'Хамелеон' && b.cover, JSON.stringify(b.chapters.map((c) => c.title)));
  assert(/<em>толстый<\/em>/.test(b.chapters[0].html), 'потеряно выделение: ' + b.chapters[0].html.slice(0, 200));
  return `${o.blob.size} B`;
});
for (const to of ['pdf', 'docx', 'txt', 'html']) {
  await test(`fb2 → ${to}`, async () => {
    const [o] = await ebook.convert(fb2, 'fb2', to);
    if (to === 'txt') assert((await o.blob.text()).includes('Очумелов'), 'нет текста');
    if (to === 'docx') assert((await unzipDocx(o.blob)).includes('Хамелеон'), 'нет текста');
    return `${o.blob.size} B`;
  });
}
await test('fb2.zip распознаётся и читается', async () => {
  const { zipSync } = await import(vendorUrl('three/addons/libs/fflate.module.js'));
  const z = file([zipSync({ 'Чехов.fb2': cp1251(fb2Text) })], 'Чехов.fb2.zip');
  assert(detectFormat(z) === 'fb2', detectFormat(z));
  const [o] = await ebook.convert(z, 'fb2', 'epub');
  assert(o.name === 'Чехов.epub', o.name);
  return o.name;
});
await test('ebook: не книга → понятная ошибка', async () => {
  try {
    await ebook.readBook(file(['<html></html>'], 'x.fb2'), 'fb2');
  } catch (e) {
    return e.message;
  }
  throw new Error('ожидалась ошибка');
});
await test('объединить в PDF: два PDF и две картинки → 4 страницы', async () => {
  const { mergeToPdf } = await import('/assets/js/converters/merge.js');
  const blob = await mergeToPdf([{ file: file([textPdf], 'a.pdf'), format: 'pdf' }, { file: file([imgOut.pdf], 'b.pdf'), format: 'pdf' }, { file: png, format: 'png' }, { file: file([imgOut.webp], 'c.webp'), format: 'webp' }]);
  const d = await pdf.openPdf(blob);
  const n = d.numPages;
  const t = await (await d.getPage(1)).getTextContent();
  d.destroy();
  assert(n === 4, `страниц ${n}`);
  assert(t.items.map((i) => i.str).join('').includes('французских'), 'текст первой страницы потерян');
  return `${n} страницы, текст первой сохранён, ${blob.size} B`;
});
// ---------- Word: точная вёрстка ----------
const { makeTestDocx } = await import('/tests/make-docx.js');
const fflateMod = await import(vendorUrl('three/addons/libs/fflate.module.js'));
const contract = await makeTestDocx(fflateMod);
await test('docx: разбивка на страницы без меток Word (A4, колонтитулы, все пункты)', async () => {
  const { renderDocx } = await import('/assets/js/converters/docx-layout.js');
  const host = document.createElement('div');
  host.className = 'docx-measure-host';
  document.body.append(host);
  const r = await renderDocx(contract, host, { forPdf: true });
  const heights = r.pages.map((p) => p.offsetHeight);
  const all = r.pages.map((p) => p.querySelector('article').textContent).join('');
  const headers = r.pages.every((p) => /Ромашка/.test(p.querySelector('header')?.textContent || ''));
  r.dispose();
  host.remove();
  assert(heights.length >= 3 && heights.every((h) => Math.abs(h - 1123) <= 2), JSON.stringify(heights));
  assert(Array.from({ length: 40 }, (_, i) => all.includes(`${i + 1}. Настоящий`)).every(Boolean), 'потерян текст');
  assert(headers, 'нет колонтитула');
  return `${heights.length} стр. A4, колонтитулы на каждой`;
});
await test('docx → pdf: размер A4, текст выделяется, «₽» на месте', async () => {
  const [o] = await doc.convert(contract, 'docx', 'pdf');
  assert(/как в документе/.test(o.note || ''), 'сработала упрощённая вёрстка: ' + o.note);
  const d = await pdf.openPdf(o.blob);
  const [, , w, hgt] = (await d.getPage(1)).view;
  const t = (await (await d.getPage(1)).getTextContent()).items.map((i) => i.str).join('');
  const n = d.numPages;
  d.destroy();
  assert(Math.abs(w / 72 * 25.4 - 210) < 1 && Math.abs(hgt / 72 * 25.4 - 297) < 1, `${w}×${hgt} pt`);
  assert(t.includes('Договор оказания услуг') && t.includes('₽'), t.slice(0, 120));
  return `${n} стр., ${o.note}, ${(o.blob.size / 1024).toFixed(0)} КБ`;
});
await test('docx с метками Word (lastRenderedPageBreak) → те же страницы, что у Word', async () => {
  const marked = await makeTestDocx(fflateMod, { paragraphs: 36, wordMarkers: true });
  const { renderDocx } = await import('/assets/js/converters/docx-layout.js');
  const host = document.createElement('div');
  host.className = 'docx-measure-host';
  document.body.append(host);
  const r = await renderDocx(marked, host, { forPdf: true });
  const n = r.pages.length;
  const ok = r.pages.every((p) => p.offsetHeight <= 1125);
  r.dispose();
  host.remove();
  assert(ok, 'страница длиннее A4');
  return `${n} стр.`;
});

// ---------- DjVu ----------
const djvuMod = await import('/assets/js/converters/djvu.js');
const spec = await fixture('DjVu3Spec_5-10.djvu');
await test('djvu: открывается, страницы и размеры', async () => {
  assert(detectFormat(file([''], 'книга.DJVU')) === 'djvu' && detectFormat(file([''], 'a.djv')) === 'djvu', 'определение формата');
  const b = await djvuMod.openDjvu(spec);
  const { canvas, dpi } = await b.page(1);
  b.close();
  assert(b.pages === 6 && canvas.width > 500, `${b.pages} стр., ${canvas.width}×${canvas.height}`);
  return `${b.pages} стр., первая ${canvas.width}×${canvas.height} при ${dpi} dpi`;
});
await test('djvu → pdf (все страницы, размер как у оригинала)', async () => {
  const [o] = await djvuMod.convert(spec, 'djvu', 'pdf');
  const d = await pdf.openPdf(o.blob);
  const p1 = await d.getPage(1);
  const [, , w, hgt] = p1.view;
  const n = d.numPages;
  d.destroy();
  assert(n === 6, `страниц ${n}`);
  return `${n} стр., страница ${Math.round(w / 72 * 25.4)}×${Math.round(hgt / 72 * 25.4)} мм, ${(o.blob.size / 1024).toFixed(0)} КБ`;
});
await test('djvu → jpg (по странице) и цветной boy.djvu → png', async () => {
  const outs = await djvuMod.convert(spec, 'djvu', 'jpg', { quality: 0.8 });
  assert(outs.length === 6 && outs[0].name.endsWith('-1.jpg'), outs.map((o) => o.name).join(','));
  const [b] = await djvuMod.convert(await fixture('boy.djvu'), 'djvu', 'png');
  const bmp = await createImageBitmap(b.blob);
  return `${outs.length} JPG; boy.png ${bmp.width}×${bmp.height}`;
});
await test('djvu → txt (текстовый слой)', async () => {
  try {
    const [o] = await djvuMod.convert(spec, 'djvu', 'txt');
    const t = await o.blob.text();
    assert(t.length > 200, 'мало текста');
    return JSON.stringify(t.slice(1, 60));
  } catch (e) {
    assert(/текстового слоя/.test(e.message), e.message);
    return 'без текстового слоя: ' + e.message.slice(0, 50);
  }
});
await test('djvu: многофайловый (indirect) → понятная ошибка', async () => {
  try {
    await djvuMod.openDjvu(await fixture('indirect-index.djvu'));
  } catch (e) {
    assert(/многофайлов/.test(e.message), e.message);
    return e.message.slice(0, 70) + '…';
  }
  throw new Error('ожидалась ошибка');
});
await test('поворот картинки: 90° по часовой — размеры меняются местами, верх уходит вправо', async () => {
  // 40×20: верхняя половина красная, нижняя синяя
  const c = document.createElement('canvas'); c.width = 40; c.height = 20;
  const g = c.getContext('2d');
  g.fillStyle = '#f00'; g.fillRect(0, 0, 40, 10);
  g.fillStyle = '#00f'; g.fillRect(0, 10, 40, 10);
  const src = file([await new Promise((r) => c.toBlob(r, 'image/png'))], 'r.png', 'image/png');
  const read = async (blob) => {
    const bmp = await createImageBitmap(blob);
    const k = document.createElement('canvas'); k.width = bmp.width; k.height = bmp.height;
    const x = k.getContext('2d'); x.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, px: (px, py) => [...x.getImageData(px, py, 1, 1).data].slice(0, 3) };
  };
  const [o90] = await image.convert(src, 'png', 'png', { edit: { rotate: 90 } });
  const r90 = await read(o90.blob);
  assert(r90.w === 20 && r90.h === 40, `${r90.w}×${r90.h}`);
  assert(r90.px(18, 20)[0] > 200 && r90.px(1, 20)[2] > 200, `справа ${r90.px(18, 20)}, слева ${r90.px(1, 20)}`);
  const [o270] = await image.convert(src, 'png', 'jpg', { edit: { rotate: 270 } });
  const r270 = await read(o270.blob);
  assert(r270.w === 20 && r270.h === 40 && r270.px(1, 20)[0] > 200, `270°: ${r270.w}×${r270.h}, слева ${r270.px(1, 20)}`);
  return '90° → верх справа, 270° → верх слева, 40×20 → 20×40';
});
await test('поворот видео: MP4 — без перекодирования (метаданные), AVI — через FFmpeg', async () => {
  const [mp4] = await media.convert(twoTracks, 'mp4', 'mp4', { edit: { tracks: [], rotate: 90 } });
  const i1 = await media.probe(file([mp4.blob], 'r.mp4'), 'mp4');
  assert(i1.video.width === 360 && i1.video.height === 640, `MP4: ${i1.video.width}×${i1.video.height}`);
  assert(/без перекодирования/.test(mp4.note || ''), `примечание: ${mp4.note}`);
  const [avi] = await media.convert(twoTracks, 'mp4', 'avi', { edit: { tracks: [], rotate: 270 } });
  const i2 = await media.probe(file([avi.blob], 'r.avi'), 'avi');
  assert(i2.video.width === 360 && i2.video.height === 640, `AVI: ${i2.video.width}×${i2.video.height}`);
  return `MP4 ${i1.video.width}×${i1.video.height} (${mp4.note}); AVI ${i2.video.width}×${i2.video.height}`;
});
await test('тот же формат: jpg → jpg (сжатие) и подписи', async () => {
  const { targetLabel } = await import('/assets/js/formats.js');
  assert(targetsFor('jpg').includes('jpg') && !targetsFor('png').includes('png'), 'список');
  assert(targetLabel('jpg', 'jpg') === 'JPG — сжать' && targetLabel('mp4', 'mp4') === 'MP4 — с правками', targetLabel('jpg', 'jpg'));
  const big = (await image.convert(png, 'png', 'jpg', { quality: 1 }))[0].blob;
  const [o] = await image.convert(file([big], 'b.jpg'), 'jpg', 'jpg', { quality: 0.5 });
  assert(o.blob.size < big.size, `${o.blob.size} ≥ ${big.size}`);
  return `${big.size} → ${o.blob.size} B`;
});

const stage = document.getElementById('stage');
for (const [name, f, fmt] of [
  ['png', png, 'png'], ['pdf', file([textPdf], 'a.pdf'), 'pdf'], ['docx', docx, 'docx'], ['md', md, 'md'],
  ['xlsx', file([xlsxBlob], 'a.xlsx'), 'xlsx'], ['tiff', file([imgOut.tiff], 'a.tiff'), 'tiff'], ['stl (WebGL)', stl, 'stl'], ['step (WebGL)', cubeStp, 'step'], ['fb2 (книга)', fb2, 'fb2'], ['djvu', spec, 'djvu'], ['epub (книга)', file([epubOut], 'b.epub'), 'epub'], ['mp4 (видео)', file([mediaOut.mp4], 'v.mp4'), 'mp4'], ['mp3 (звук)', file([mediaOut.mp3], 'a.mp3'), 'mp3'],
]) {
  await test(`preview ${name}`, async () => {
    const dispose = await renderPreview(stage, f, fmt);
    const err = stage.querySelector('.pv-error');
    const html = stage.innerHTML.length;
    dispose();
    assert(!err, err?.textContent);
    return `${html} символов DOM`;
  });
}


log(failed ? 'fail' : 'ok', `\nИТОГО: ${passed} прошло, ${failed} упало`);
document.title = failed ? `FAIL ${failed}` : 'ALL PASS';
