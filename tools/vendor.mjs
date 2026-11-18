// Скачивает сторонние JS-библиотеки в папку vendor/ (без npm, только встроенный fetch Node.js 18+).
// Запуск:  node tools/vendor.mjs
// Чтобы обновить библиотеку — поменяйте версию ниже и запустите снова.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'site', 'vendor');
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function save(rel, buf, url) {
  const dest = join(VENDOR, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  const sha = createHash('sha256').update(buf).digest('hex');
  manifest.push(`${rel}  ${buf.length}  sha256:${sha}  ${url}`);
}

async function listDir(pkg, version, dir) {
  const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${pkg}@${version}?structure=flat`);
  if (!res.ok) throw new Error(`listing ${pkg}: ${res.status}`);
  const { files } = await res.json();
  return files.map((f) => f.name).filter((n) => n.startsWith(`/${dir}/`));
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
  await rm(VENDOR, { recursive: true, force: true });
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
  manifest.sort();
  await writeFile(
    join(VENDOR, 'MANIFEST.txt'),
    `# Сгенерировано tools/vendor.mjs — не редактируйте вручную\n# ${JSON.stringify(V)}\n\n${manifest.join('\n')}\n`,
  );
  console.log(`\nГотово: ${manifest.length} файлов в vendor/`);
}

main().catch((e) => {
  console.error('\nОшибка:', e.message);
  process.exit(1);
});
