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
import { verifyCode } from '/assets/js/supporter.js';
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

const stage = document.getElementById('stage');
for (const [name, f, fmt] of [
  ['png', png, 'png'], ['pdf', file([textPdf], 'a.pdf'), 'pdf'], ['docx', docx, 'docx'], ['md', md, 'md'],
  ['xlsx', file([xlsxBlob], 'a.xlsx'), 'xlsx'], ['tiff', file([imgOut.tiff], 'a.tiff'), 'tiff'], ['stl (WebGL)', stl, 'stl'], ['step (WebGL)', cubeStp, 'step'],
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

await test('код «без рекламы»: подпись из Node проверяется в браузере', async () => {
  const fx = await (await fetch('/tests/fixture-code.json')).json();
  CONFIG.supporterPublicKey = fx.publicKey;
  const good = await verifyCode(fx.code);
  assert(good.ok, good.reason);
  const tampered = fx.code.slice(0, -3) + (fx.code.endsWith('A') ? 'BBB' : 'AAA');
  assert(!(await verifyCode(tampered)).ok, 'испорченный код принят');
  const forged = fx.code.replace(/^KV1\.[^.]+/, 'KV1.' + btoa('{"exp":9999999999,"id":"x"}').replace(/=+$/, ''));
  assert(!(await verifyCode(forged)).ok, 'поддельный payload принят');
  const expired = await verifyCode(fx.expiredCode);
  assert(!expired.ok && /истёк/.test(expired.reason), expired.reason);
  return `до ${good.expires.toLocaleDateString('ru')}`;
});

log(failed ? 'fail' : 'ok', `\nИТОГО: ${passed} прошло, ${failed} упало`);
document.title = failed ? `FAIL ${failed}` : 'ALL PASS';
