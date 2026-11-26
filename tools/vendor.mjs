// Скачивает сторонние JS-библиотеки в папку vendor/ (без npm, только встроенный fetch Node.js 18+).
// Запуск:  node tools/vendor.mjs
// Чтобы обновить библиотеку — поменяйте версию ниже и запустите снова.

import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'site', 'vendor');
// Качаем во временную папку и подменяем vendor/ только после успешной загрузки всего —
// иначе обрыв сети посреди загрузки оставил бы сайт без библиотек
const STAGING = `${VENDOR}.download`;
const NPM = 'https://cdn.jsdelivr.net/npm/';

const V = {
  pdfjs: '4.10.38',
  three: '0.170.0',
  mammoth: '1.9.0',
  dompurify: '3.2.4',
  marked: '15.0.7',
  turndown: '7.2.0',
  pdfmake: '0.2.18',
  htmlToPdfmake: '2.5.23',
  xlsx: '0.20.3',
  utif: '3.1.0',
  pako: '2.1.0',
  heic2any: '0.0.4',
  occt: '0.0.23', // OpenCascade (WASM) — чтение STEP / IGES / BREP
  pdfLib: '1.17.1', // объединение PDF
  djvujs: '0.5.4', // чтение DjVu (GPL-2.0); в пакете только исходники — подключаем их как ES-модули
  docxPreview: '0.4.1', // точный предпросмотр и вёрстка DOCX (Apache-2.0)
  jszip: '3.10.1', // нужна docx-preview
  fontkit: '1.1.1', // встраивание шрифтов в PDF (@pdf-lib/fontkit)
  fontsource: '5.3.0', // свободные шрифты с метриками шрифтов Microsoft (OFL)
  mediabunny: '1.65.1', // чтение/запись MP4, WebM, MKV для кодирования через WebCodecs (H.265, AV1, VP9 на видеокарте)
  ffmpeg: '0.12.15', // ffmpeg.wasm — обёртка (MIT)
  ffmpegCore: '0.12.10', // ядро FFmpeg в WebAssembly, однопоточное (GPL-2.0-or-later)
};

// [url, путь внутри vendor/]
const FILES = [
  [`${NPM}pdfjs-dist@${V.pdfjs}/legacy/build/pdf.min.mjs`, 'pdfjs/pdf.min.mjs'],
  [`${NPM}pdfjs-dist@${V.pdfjs}/legacy/build/pdf.worker.min.mjs`, 'pdfjs/pdf.worker.min.mjs'],
  [`${NPM}pdfjs-dist@${V.pdfjs}/LICENSE`, 'pdfjs/LICENSE'],
  [`${NPM}mammoth@${V.mammoth}/mammoth.browser.min.js`, 'mammoth/mammoth.browser.min.js'],
  [`${NPM}mammoth@${V.mammoth}/LICENSE`, 'mammoth/LICENSE'],
  [`${NPM}dompurify@${V.dompurify}/dist/purify.es.mjs`, 'dompurify/purify.es.mjs'],
  [`${NPM}dompurify@${V.dompurify}/LICENSE`, 'dompurify/LICENSE'],
  [`${NPM}marked@${V.marked}/lib/marked.esm.js`, 'marked/marked.esm.js'],
  [`${NPM}marked@${V.marked}/LICENSE.md`, 'marked/LICENSE.md'],
  [`${NPM}turndown@${V.turndown}/lib/turndown.browser.es.js`, 'turndown/turndown.browser.es.js'],
  [`${NPM}turndown@${V.turndown}/LICENSE`, 'turndown/LICENSE'],
  [`${NPM}pdfmake@${V.pdfmake}/build/pdfmake.min.js`, 'pdfmake/pdfmake.min.js'],
  [`${NPM}pdfmake@${V.pdfmake}/build/vfs_fonts.js`, 'pdfmake/vfs_fonts.js'],
  [`${NPM}pdfmake@${V.pdfmake}/LICENSE`, 'pdfmake/LICENSE'],
  [`${NPM}html-to-pdfmake@${V.htmlToPdfmake}/browser.js`, 'html-to-pdfmake/browser.js'],
  [`${NPM}html-to-pdfmake@${V.htmlToPdfmake}/LICENSE`, 'html-to-pdfmake/LICENSE'],
  [`https://cdn.sheetjs.com/xlsx-${V.xlsx}/package/dist/xlsx.full.min.js`, 'xlsx/xlsx.full.min.js'],
  [`https://cdn.sheetjs.com/xlsx-${V.xlsx}/package/LICENSE`, 'xlsx/LICENSE'],
  [`${NPM}utif@${V.utif}/UTIF.js`, 'utif/UTIF.js'],
  [`${NPM}pako@${V.pako}/dist/pako.min.js`, 'pako/pako.min.js'],
  [`${NPM}pako@${V.pako}/LICENSE`, 'pako/LICENSE'],
  [`${NPM}heic2any@${V.heic2any}/dist/heic2any.min.js`, 'heic2any/heic2any.min.js'],
  [`${NPM}three@${V.three}/build/three.module.min.js`, 'three/three.module.min.js'],
  [`${NPM}three@${V.three}/LICENSE`, 'three/LICENSE'],
  [`${NPM}occt-import-js@${V.occt}/dist/occt-import-js.js`, 'occt/occt-import-js.js'],
  [`${NPM}occt-import-js@${V.occt}/dist/occt-import-js.wasm`, 'occt/occt-import-js.wasm'],
  [`${NPM}occt-import-js@${V.occt}/dist/license.occt-import-js.txt`, 'occt/LICENSE.occt-import-js.txt'],
  [`${NPM}occt-import-js@${V.occt}/dist/license.occt.txt`, 'occt/LICENSE.occt.txt'],
  ...['classes.js', 'const.js', 'empty.mjs', 'errors.js', 'index.js', 'types.js', 'utils.js', 'worker.js'].map((f) => [
    `${NPM}@ffmpeg/ffmpeg@${V.ffmpeg}/dist/esm/${f}`, `ffmpeg/ffmpeg/${f}`,
  ]),
  [`${NPM}pdf-lib@${V.pdfLib}/dist/pdf-lib.min.js`, 'pdf-lib/pdf-lib.min.js'],
  [`${NPM}mediabunny@${V.mediabunny}/dist/bundles/mediabunny.min.mjs`, 'mediabunny/mediabunny.min.mjs'],
  [`${NPM}mediabunny@${V.mediabunny}/LICENSE`, 'mediabunny/LICENSE'],
  [`${NPM}pdf-lib@${V.pdfLib}/LICENSE.md`, 'pdf-lib/LICENSE.md'],
  [`${NPM}docx-preview@${V.docxPreview}/dist/docx-preview.min.js`, 'docx-preview/docx-preview.min.js'],
  [`${NPM}docx-preview@${V.docxPreview}/LICENSE`, 'docx-preview/LICENSE'],
  [`${NPM}jszip@${V.jszip}/dist/jszip.min.js`, 'jszip/jszip.min.js'],
  [`${NPM}jszip@${V.jszip}/LICENSE.markdown`, 'jszip/LICENSE.markdown'],
  [`${NPM}@pdf-lib/fontkit@${V.fontkit}/dist/fontkit.umd.min.js`, 'fontkit/fontkit.umd.min.js'],
  [`${NPM}@ffmpeg/core@${V.ffmpegCore}/dist/esm/ffmpeg-core.js`, 'ffmpeg/core/ffmpeg-core.js'],
  [`${NPM}@ffmpeg/core@${V.ffmpegCore}/dist/esm/ffmpeg-core.wasm`, 'ffmpeg/core/ffmpeg-core.wasm'],
];

// Дополнения three.js: качаем вместе со всеми их относительными импортами,
// а импорт 'three' переписываем на относительный путь (браузеру не нужен import map).
const THREE_ADDONS = [
  'controls/OrbitControls.js',
  'loaders/STLLoader.js',
  'loaders/OBJLoader.js',
  'loaders/PLYLoader.js',
  'loaders/GLTFLoader.js',
  'loaders/FBXLoader.js',
  'loaders/3MFLoader.js',
  'loaders/ColladaLoader.js',
  'exporters/STLExporter.js',
  'exporters/OBJExporter.js',
  'exporters/PLYExporter.js',
  'exporters/GLTFExporter.js',
  'exporters/USDZExporter.js',
  'utils/BufferGeometryUtils.js',
  'libs/fflate.module.js',
];

const manifest = [];

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3 || /^4dd /.test(e.message)) throw new Error(`${e.message} (${url})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt)); // сеть моргнула — пробуем ещё раз
    }
  }
}

// Некоторые хостинги (Cloudflare Pages) не принимают файлы больше 25 МБ.
// Такие файлы режем на части + <имя>.parts.json; сайт склеивает их при загрузке.
const MAX_FILE = 20 * 1024 * 1024;
const PART = 16 * 1024 * 1024;

async function save(rel, buf, url) {
  // .mjs → .js: многие серверы (например, nginx по умолчанию) отдают .mjs как text/plain,
  // и браузер отказывается запускать такой модуль. Содержимое то же, меняется только имя.
  rel = rel.replace(/.mjs$/, '.js');
  const dest = join(STAGING, rel);
  await mkdir(dirname(dest), { recursive: true });
  if (buf.length > MAX_FILE) {
    const parts = [];
    for (let i = 0, off = 0; off < buf.length; i++, off += PART) {
      const name = `${rel.split('/').pop()}.part${i}`;
      await writeFile(join(dirname(dest), name), buf.subarray(off, off + PART));
      parts.push(name);
    }
    await writeFile(`${dest}.parts.json`, JSON.stringify({ size: buf.length, parts }));
  } else {
    await writeFile(dest, buf);
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  manifest.push(`${rel}  ${buf.length}  sha256:${sha}  ${url}`);
}

async function listDir(pkg, version, dir) {
  const { files } = JSON.parse((await get(`https://data.jsdelivr.com/v1/packages/npm/${pkg}@${version}?structure=flat`)).toString('utf8'));
  return files.map((f) => f.name).filter((n) => n.startsWith(`/${dir}/`));
}

// DjVu.js: в npm лежат только исходники (ES-модули без расширений в импортах и с зависимостью pngjs).
// Дописываем «.js» к относительным импортам и заменяем pngjs заглушкой — она нужна лишь для
// createPngObjectUrl(), которым сайт не пользуется (страницы берутся через getImageData()).
// Шрифты для точной вёрстки DOCX: метрически совместимые замены шрифтов Microsoft.
// Carlito = Calibri, Caladea = Cambria, Arimo = Arial, Tinos = Times New Roman, Cousine = Courier New.
// Fontsource режет шрифты по алфавитам; берём латиницу и кириллицу и записываем диапазоны символов в fonts.json.
const FONTS = ['carlito', 'caladea', 'arimo', 'tinos', 'cousine'];
const FONT_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];
const FONT_STYLES = [['400', 'normal', '400.css'], ['700', 'normal', '700.css'], ['400', 'italic', '400-italic.css'], ['700', 'italic', '700-italic.css']];
/**
 * WOFF (версии 1) → TTF: распаковка таблиц zlib и сборка обычного шрифта TrueType.
 * Нужно для PDF: fontkit (через pdf-lib) зависает на подмножествах шрифтов WOFF2, а с TTF работает надёжно.
 */
function woffToTtf(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('не WOFF');
  const flavor = woff.readUInt32BE(4);
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const tag = woff.toString('ascii', e, e + 4);
    const offset = woff.readUInt32BE(e + 4), compLength = woff.readUInt32BE(e + 8), origLength = woff.readUInt32BE(e + 12), checksum = woff.readUInt32BE(e + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1)); // таблицы в sfnt — по алфавиту тегов
  const pow2 = 2 ** Math.floor(Math.log2(n));
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow2 * 16, 6);
  head.writeUInt16BE(Math.log2(pow2), 8);
  head.writeUInt16BE(n * 16 - pow2 * 16, 10);
  let offset = head.length;
  const parts = [head];
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    head.write(t.tag, r, 'ascii');
    head.writeUInt32BE(t.checksum, r + 4);
    head.writeUInt32BE(offset, r + 8);
    head.writeUInt32BE(t.data.length, r + 12);
    const padded = Buffer.alloc(Math.ceil(t.data.length / 4) * 4);
    t.data.copy(padded);
    parts.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(parts);
}

async function vendorFonts() {
  const manifest = {};
  for (const f of FONTS) {
    const base = `${NPM}@fontsource/${f}@${V.fontsource}/`;
    manifest[f] = {};
    for (const [weight, style, css] of FONT_STYLES) {
      const text = (await get(base + css)).toString('utf8');
      const faces = [];
      // Каждый блок @font-face: файл вида <шрифт>-<алфавит>-<вес>-<стиль>.woff2 и его unicode-range
      for (const block of text.split('@font-face').slice(1)) {
        const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
        if (!file || !range) continue;
        const subset = file.slice(f.length + 1).replace(/-\d+-(normal|italic)\.woff2$/, '');
        if (!FONT_SUBSETS.includes(subset)) continue;
        await save(`fonts/${f}/${file}`, await get(base + 'files/' + file), base + 'files/' + file);
        // Тот же шрифт в TTF — для встраивания в PDF
        const woffUrl = base + 'files/' + file.replace(/\.woff2$/, '.woff');
        const ttf = file.replace(/\.woff2$/, '.ttf');
        await save(`fonts/${f}/${ttf}`, woffToTtf(await get(woffUrl)), woffUrl);
        faces.push({ subset, file: `${f}/${file}`, ttf: `${f}/${ttf}`, range: range.trim() });
      }
      manifest[f][`${weight}-${style}`] = faces;
    }
    await save(`fonts/${f}/LICENSE`, await get(base + 'LICENSE'), base + 'LICENSE');
  }
  await save('fonts/fonts.json', Buffer.from(JSON.stringify(manifest)), 'tools/vendor.mjs');
}

async function vendorDjvu() {
  const base = `${NPM}djvujs-dist@${V.djvujs}`;
  for (const name of await listDir('djvujs-dist', V.djvujs, 'library/src')) {
    if (!name.endsWith('.js')) continue;
    const url = base + name;
    let src = (await get(url)).toString('utf8');
    src = src
      .replace(/(from\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g, (m, a, p, b) => (p.endsWith('.js') ? m : `${a}${p}.js${b}`))
      .replace(/import\s+png\s+from\s+['"]pngjs\/browser['"];?/, "const png = { PNG: { sync: { write() { throw new Error('PNG-кодировщик pngjs не подключён'); } } } };");
    await save(`djvujs/${name.slice('/library/src/'.length)}`, Buffer.from(src, 'utf8'), url);
  }
  await save('djvujs/LICENSE', await get(`${base}/GNU_GPL_v2`), `${base}/GNU_GPL_v2`);
}

async function vendorThreeAddons() {
  const base = `${NPM}three@${V.three}/examples/jsm/`;
  const queue = [...THREE_ADDONS];
  const seen = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const url = base + rel;
    let src = (await get(url)).toString('utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(posix.normalize(posix.join(posix.dirname(rel), m[1])));
    }
    const depth = rel.split('/').length; // addons/<dir>/<file> → ../../three.module.min.js
    const threePath = '../'.repeat(depth) + 'three.module.min.js';
    src = src.replace(/from\s*['"]three['"]/g, `from '${threePath}'`);
    await save(`three/addons/${rel}`, Buffer.from(src, 'utf8'), url);
  }
}

async function main() {
  await rm(STAGING, { recursive: true, force: true });
  for (const [url, rel] of FILES) {
    await save(rel, await get(url), url);
    process.stdout.write('.');
  }
  // Шрифты и CMap для pdf.js (нужны для корректного рендера и извлечения текста части PDF)
  for (const dir of ['standard_fonts', 'cmaps']) {
    for (const name of await listDir('pdfjs-dist', V.pdfjs, dir)) {
      const url = `${NPM}pdfjs-dist@${V.pdfjs}${name}`;
      await save(`pdfjs${name}`, await get(url), url);
    }
    process.stdout.write('.');
  }
  await vendorThreeAddons();
  await vendorDjvu();
  await vendorFonts();
  manifest.sort();
  await writeFile(
    join(STAGING, 'MANIFEST.txt'),
    `# Сгенерировано tools/vendor.mjs — не редактируйте вручную\n# ${JSON.stringify(V)}\n\n${manifest.join('\n')}\n`,
  );
  await rm(VENDOR, { recursive: true, force: true });
  await rename(STAGING, VENDOR);
  console.log(`\nГотово: ${manifest.length} файлов в vendor/`);
}

main().catch((e) => {
  console.error('\nОшибка:', e.message);
  process.exit(1);
});
