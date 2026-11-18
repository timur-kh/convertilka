// 3D-модели: загрузка, экспорт и интерактивный просмотр (three.js).
import { vendorUrl, readText, baseName } from '../util.js';

const T = (p) => import(vendorUrl('three/' + p));
let threePromise;
function getThree() {
  threePromise ||= T('three.module.min.js');
  return threePromise;
}

// Для 3D-печати и CAD (STL/3MF/PLY/STEP/IGES) «вверх» — ось Z, для glTF/OBJ/FBX/USDZ — ось Y.
const Z_UP = new Set(['stl', '3mf', 'ply', 'step', 'iges', 'brep']);

// ---------- CAD (STEP/IGES/BREP) через OpenCascade в Web Worker ----------
let cadWorker;
let cadSeq = 0;
const cadPending = new Map();
function readCad(buffer, format) {
  if (!cadWorker) {
    cadWorker = new Worker(new URL('../workers/cad-worker.js', import.meta.url));
    cadWorker.onmessage = ({ data }) => {
      const p = cadPending.get(data.id);
      cadPending.delete(data.id);
      if (data.ok) p?.resolve(data.meshes);
      else p?.reject(new Error(data.error));
    };
    cadWorker.onerror = (e) => {
      for (const p of cadPending.values()) p.reject(new Error(`Ошибка CAD-модуля: ${e.message || 'не удалось загрузить'}`));
      cadPending.clear();
      cadWorker.terminate();
      cadWorker = null;
    };
  }
  const id = ++cadSeq;
  return new Promise((resolve, reject) => {
    cadPending.set(id, { resolve, reject });
    cadWorker.postMessage({ id, format, buffer }, [buffer]);
  });
}

async function loadCad(THREE, file, format) {
  const meshes = await readCad(await file.arrayBuffer(), format);
  const group = new THREE.Group();
  const toColor = (c) => new THREE.Color(c[0], c[1], c[2]);
  for (const m of meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.normal) geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (!m.normal) geo.computeVertexNormals();
    const base = m.color ? toColor(m.color) : new THREE.Color(0xb8c4d6);
    const makeMat = (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
    let material;
    // Разные цвета у граней детали — через группы геометрии
    const colored = m.faces.filter((f) => f.color);
    if (colored.length) {
      const mats = [makeMat(base)];
      const byKey = new Map();
      for (const f of m.faces) {
        let mi = 0;
        if (f.color) {
          const key = f.color.join(',');
          if (!byKey.has(key)) {
            byKey.set(key, mats.length);
            mats.push(makeMat(toColor(f.color)));
          }
          mi = byKey.get(key);
        }
        geo.addGroup(f.first * 3, (f.last - f.first + 1) * 3, mi);
      }
      material = mats;
    } else {
      material = makeMat(base);
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = m.name;
    group.add(mesh);
  }
  return group;
}

function lockedManager(THREE) {
  // Модель не может обращаться к сети: внешние текстуры/буферы заменяются пустыми данными.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : 'data:,'));
  return manager;
}

/** Загружает файл и возвращает Object3D. */
export async function loadModel(file, format) {
  const THREE = await getThree();
  const manager = lockedManager(THREE);
  const material = () =>
    new THREE.MeshStandardMaterial({ color: 0xb8c4d6, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  const meshFromGeometry = (geo) => {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const m = material();
    if (geo.getAttribute('color')) m.vertexColors = true;
    return new THREE.Mesh(geo, m);
  };

  let object;
  switch (format) {
    case 'stl': {
      const { STLLoader } = await T('addons/loaders/STLLoader.js');
      object = meshFromGeometry(new STLLoader(manager).parse(await file.arrayBuffer()));
      break;
    }
    case 'ply': {
      const { PLYLoader } = await T('addons/loaders/PLYLoader.js');
      const geo = new PLYLoader(manager).parse(await file.arrayBuffer());
      // PLYLoader создаёт индекс, только если в файле есть грани; без граней это облако точек (сканы)
      object = geo.index ? meshFromGeometry(geo) : pointCloud(THREE, geo);
      break;
    }
    case 'obj': {
      const { OBJLoader } = await T('addons/loaders/OBJLoader.js');
      object = new OBJLoader(manager).parse(await readText(file));
      object.traverse((o) => {
        if (o.isMesh && (!o.material || o.material.type === 'MeshPhongMaterial')) {
          const color = o.material?.color;
          o.material = material();
          if (color && color.getHex() !== 0xffffff) o.material.color.copy(color);
        }
      });
      break;
    }
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await T('addons/loaders/GLTFLoader.js');
      const data = await file.arrayBuffer();
      let gltf;
      try {
        gltf = await new GLTFLoader(manager).parseAsync(data, '');
      } catch (e) {
        throw new Error(format === 'gltf'
          ? 'Не удалось прочитать glTF. Если он ссылается на внешние .bin/текстуры — используйте GLB или glTF со встроенными данными.'
          : `Не удалось прочитать GLB: ${e.message}`);
      }
      object = gltf.scene || gltf.scenes?.[0];
      if (!object) throw new Error('В файле нет 3D-сцены');
      break;
    }
    case 'fbx': {
      const { FBXLoader } = await T('addons/loaders/FBXLoader.js');
      object = new FBXLoader(manager).parse(await file.arrayBuffer(), '');
      break;
    }
    case '3mf': {
      const { ThreeMFLoader } = await T('addons/loaders/3MFLoader.js');
      object = new ThreeMFLoader(manager).parse(await file.arrayBuffer());
      break;
    }
    case 'step':
    case 'iges':
    case 'brep':
      object = await loadCad(THREE, file, format);
      break;
    case 'dae': {
      const { ColladaLoader } = await T('addons/loaders/ColladaLoader.js');
      const result = new ColladaLoader(manager).parse(await readText(file), '');
      if (!result) throw new Error('Не удалось разобрать файл Collada');
      object = result.scene;
      break;
    }
    default:
      throw new Error(`Не умею открывать ${format}`);
  }
  const stats = countStats(object);
  if (!stats.vertices) throw new Error('В файле не найдено геометрии');
  object.userData.sourceFormat = format;
  return object;
}

/** PLY без граней — облако точек. */
function pointCloud(THREE, geo) {
  const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: 0x8899bb });
  if (geo.getAttribute('color')) m.vertexColors = true;
  return new THREE.Points(geo, m);
}

export function countStats(object) {
  let vertices = 0, triangles = 0, meshes = 0;
  object.traverse((o) => {
    const g = o.geometry;
    if (!g?.getAttribute?.('position')) return;
    const n = g.getAttribute('position').count;
    vertices += n;
    if (o.isMesh) {
      meshes++;
      triangles += (g.index ? g.index.count : n) / 3;
    }
  });
  return { vertices, triangles: Math.round(triangles), meshes };
}

/** Оборачивает модель так, чтобы ось «вверх» соответствовала целевому формату. */
async function orient(object, from, to) {
  const THREE = await getThree();
  const root = new THREE.Group();
  root.name = 'root';
  root.add(object);
  const fromZ = Z_UP.has(from), toZ = Z_UP.has(to);
  if (fromZ && !toZ) root.rotation.x = -Math.PI / 2;
  if (!fromZ && toZ) root.rotation.x = Math.PI / 2;
  root.updateMatrixWorld(true);
  return root;
}

/** USDZ (AR Quick Look) поддерживает только MeshStandardMaterial. */
async function toStandardMaterials(object) {
  const THREE = await getThree();
  object.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      if (!m || m.isMeshStandardMaterial) return m;
      const s = new THREE.MeshStandardMaterial({ color: m.color || 0xcccccc, map: m.map || null, side: m.side, transparent: m.transparent, opacity: m.opacity ?? 1 });
      s.name = m.name;
      return s;
    };
    // USDZExporter не поддерживает несколько материалов на объект — оставляем основной
    o.material = conv(Array.isArray(o.material) ? o.material[0] : o.material);
  });
}

export async function convert(file, from, to) {
  const object = await loadModel(file, from);
  const root = await orient(object, from, to);
  const name = `${baseName(file.name)}.${to}`;
  let blob;
  switch (to) {
    case 'stl': {
      const { STLExporter } = await T('addons/exporters/STLExporter.js');
      blob = new Blob([new STLExporter().parse(root, { binary: true })], { type: 'model/stl' });
      break;
    }
    case 'obj': {
      const { OBJExporter } = await T('addons/exporters/OBJExporter.js');
      blob = new Blob([new OBJExporter().parse(root)], { type: 'model/obj' });
      break;
    }
    case 'ply': {
      const { PLYExporter } = await T('addons/exporters/PLYExporter.js');
      const data = await new Promise((resolve) => new PLYExporter().parse(root, resolve, { binary: true }));
      blob = new Blob([data], { type: 'application/octet-stream' });
      break;
    }
    case 'glb':
    case 'gltf': {
      const { GLTFExporter } = await T('addons/exporters/GLTFExporter.js');
      const res = await new GLTFExporter().parseAsync(root, { binary: to === 'glb', embedImages: true, onlyVisible: true });
      blob = to === 'glb'
        ? new Blob([res], { type: 'model/gltf-binary' })
        : new Blob([JSON.stringify(res)], { type: 'model/gltf+json' });
      break;
    }
    case 'usdz': {
      const { USDZExporter } = await T('addons/exporters/USDZExporter.js');
      await toStandardMaterials(root);
      blob = new Blob([await new USDZExporter().parseAsync(root)], { type: 'model/vnd.usdz+zip' });
      break;
    }
    default:
      throw new Error(`Неподдерживаемый формат: ${to}`);
  }
  disposeObject(object);
  return [{ blob, name }];
}

export function disposeObject(object) {
  object.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose?.();
    }
  });
}

// Единицы измерения форматов. assumed=true — в самом формате единиц нет, указана общепринятая.
const UNITS = {
  step: { unit: 'мм' }, iges: { unit: 'мм' }, brep: { unit: 'мм' },
  stl: { unit: 'мм', assumed: true }, '3mf': { unit: 'мм' }, ply: { unit: 'мм', assumed: true },
  obj: { unit: 'ед.', assumed: true }, fbx: { unit: 'ед.', assumed: true },
  glb: { unit: 'м' }, gltf: { unit: 'м' }, dae: { unit: 'м' },
};

/** Объём замкнутой сетки (сумма знаковых объёмов тетраэдров), в кубических единицах модели. */
function meshVolume(THREE, root) {
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.getAttribute('position')) return;
    const pos = o.geometry.getAttribute('position');
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    let local = 0;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      local += a.dot(b.cross(c)) / 6; // b портится — дальше не используется
    }
    vol += Math.abs(local);
  });
  return vol;
}

/**
 * Интерактивный просмотр модели в контейнере.
 * Возвращает { stats, dims: {width, depth, height, volume, unit, assumed}, setWireframe, setBounds, resetView, dispose }.
 */
export async function createViewer(container, file, format) {
  const THREE = await getThree();
  const { OrbitControls } = await T('addons/controls/OrbitControls.js');
  const object = await loadModel(file, format);
  const stats = countStats(object);

  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  holder.add(object);
  if (Z_UP.has(format)) holder.rotation.x = -Math.PI / 2;
  scene.add(holder);
  holder.updateMatrixWorld(true);

  // Центрируем модель на «полу»
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  holder.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  holder.updateMatrixWorld(true);
  const radius = Math.max(size.length() / 2, 1e-6);

  // Габариты в «Y вверх»: ширина — X, глубина — Z, высота — Y
  const dims = { width: size.x, depth: size.z, height: size.y, volume: meshVolume(THREE, holder), ...(UNITS[format] || { unit: 'ед.', assumed: true }) };
  const bounds = new THREE.Box3Helper(new THREE.Box3().setFromObject(holder), 0xf59e0b);
  bounds.visible = false;
  scene.add(bounds);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1, 2, 1.5).multiplyScalar(radius * 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-1.5, 0.5, -1).multiplyScalar(radius * 3);
  scene.add(fill);

  const grid = new THREE.GridHelper(radius * 4, 20, 0x8899aa, 0x8899aa);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, 1, radius / 100, radius * 100);
  camera.position.set(radius * 1.6, radius * 1.2, radius * 2.0);
  const target = new THREE.Vector3(0, size.y / 2, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => (controls.autoRotate = false));
  controls.update();

  const resize = () => {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let running = true;
  renderer.setAnimationLoop(() => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    stats,
    dims,
    setBounds(on) {
      bounds.visible = on;
    },
    setWireframe(on) {
      object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) m.wireframe = on;
      });
    },
    resetView() {
      camera.position.set(radius * 1.6, radius * 1.2, radius * 2.0);
      controls.target.copy(target);
      controls.update();
    },
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      disposeObject(object);
      grid.geometry.dispose();
      grid.material.dispose();
      bounds.geometry.dispose();
      bounds.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
