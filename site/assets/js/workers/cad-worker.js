// Web Worker: чтение CAD-файлов (STEP / IGES / BREP) ядром OpenCascade (WebAssembly).
// Работает в отдельном потоке, чтобы большая деталь не подвешивала страницу.
// На входе: { id, format, buffer }, на выходе: { id, ok, meshes | error }.
/* global occtimportjs */
importScripts('../../../vendor/occt/occt-import-js.js');

const VENDOR = new URL('../../../vendor/occt/', self.location.href).href;
let occtPromise;

// Точность триангуляции: отклонение 0.1% от размера детали — гладко, но без лишних мегабайт
const PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

self.onmessage = async (e) => {
  const { id, format, buffer } = e.data;
  try {
    occtPromise ||= occtimportjs({ locateFile: (name) => VENDOR + name });
    const occt = await occtPromise;
    const data = new Uint8Array(buffer);
    const res =
      format === 'step' ? occt.ReadStepFile(data, PARAMS)
      : format === 'iges' ? occt.ReadIgesFile(data, PARAMS)
      : occt.ReadBrepFile(data, PARAMS);
    if (!res?.success) throw new Error('Файл повреждён или это не CAD-модель');

    const transfer = [];
    const meshes = res.meshes.map((m) => {
      const position = new Float32Array(m.attributes.position.array);
      const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      const index = new Uint32Array(m.index.array);
      transfer.push(position.buffer, index.buffer);
      if (normal) transfer.push(normal.buffer);
      return { name: m.name || '', color: m.color || null, faces: m.brep_faces || [], position, normal, index };
    });
    self.postMessage({ id, ok: true, meshes }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
