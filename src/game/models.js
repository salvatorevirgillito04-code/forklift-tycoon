import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF';
import { createHeadlights, snapZ } from './headlights.js';
import { addBlobShadow } from './blobshadow.js';

// Dimensioni condivise con la simulazione (metri).
export const FORK = {
  baseZ: 0.62, // faccia anteriore del carrello porta-forche, rispetto all'asse anteriore
  length: 1.15,
  thickness: 0.05,
  width: 0.12,
};
export const PALLET = { size: 1.2, height: 0.144, pocketLow: 0.022, pocketHigh: 0.122 };
export const TRUCK = { bedLength: 12, bedWidth: 2.5, bedHeight: 1.2 };

function box(scene, name, w, h, d, pos, mat, parent) {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.copyFrom(pos);
  m.material = mat;
  if (parent) m.parent = parent;
  return m;
}

function cyl(scene, name, diameter, height, pos, mat, parent, tess = 20) {
  const m = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: tess }, scene);
  m.position.copyFrom(pos);
  m.material = mat;
  if (parent) m.parent = parent;
  return m;
}

// Ruota: gomma con tasselli, cerchio con bulloni e mozzo, unita in un'unica mesh.
// node.spin e' il nodo che ruota col movimento.
// Unisce dei pezzi in UNA mesh per materiale, figlia di 'parent' (vertici riportati nelle sue coordinate).
// Una mesh per materiale = una sola chiamata di disegno; l'unione "multi-materiale" di Babylon
// invece tiene un sotto-pezzo per ogni pezzo originale e non fa risparmiare nulla.
export function mergeByMaterial(pieces, parent, name) {
  const groups = new Map();
  for (const m of pieces) {
    if (m.isDisposed() || !m.material) continue;
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(m);
  }
  parent.computeWorldMatrix(true);
  const inv = parent.getWorldMatrix().clone().invert();
  const out = [];
  for (const [mat, list] of groups) {
    list.forEach((m) => m.computeWorldMatrix(true));
    const merged = list.length > 1 ? Mesh.MergeMeshes(list, true, true) : list[0];
    if (!merged) continue;
    if (list.length > 1) {
      merged.bakeTransformIntoVertices(inv);
      merged.parent = parent;
      merged.material = mat;
    }
    merged.name = `${name}_${mat.name}`;
    out.push(merged);
  }
  return out;
}

function wheel(scene, name, radius, width, pos, mats, parent, rimMat = mats.steel) {
  const node = new TransformNode(name, scene);
  node.parent = parent;
  node.position.copyFrom(pos);
  const spin = new TransformNode(name + 'Spin', scene);
  spin.parent = node;
  node.spin = spin;
  const pieces = [];
  const tyre = cyl(scene, name + 'Tyre', radius * 1.88, width, Vector3.Zero(), mats.rubber, spin, 24);
  tyre.rotation.z = Math.PI / 2;
  pieces.push(tyre);
  // Tasselli del battistrada, alternati a spina di pesce
  const lugs = 14;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const lug = box(scene, name + 'Lug', width * 0.46, 0.035, radius * 0.22,
        new Vector3(side * width * 0.24, Math.cos(a + side * 0.08) * radius * 0.95, Math.sin(a + side * 0.08) * radius * 0.95), mats.rubber, spin);
      lug.rotation.x = -(a + side * 0.08);
      pieces.push(lug);
    }
  }
  // Cerchio, mozzo e bulloni su entrambi i lati
  const rim = cyl(scene, name + 'Rim', radius * 1.15, width + 0.02, Vector3.Zero(), rimMat, spin, 20);
  rim.rotation.z = Math.PI / 2;
  pieces.push(rim);
  for (const side of [-1, 1]) {
    // Mozzo e bulloni con il materiale del cerchio: 2 materiali per ruota = 2 sole chiamate di disegno
    const hub = cyl(scene, name + 'Hub', radius * 0.42, 0.03, new Vector3(side * (width / 2 + 0.02), 0, 0), rimMat, spin, 14);
    hub.rotation.z = Math.PI / 2;
    pieces.push(hub);
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2;
      const bolt = cyl(scene, name + 'Bolt', 0.035, 0.03,
        new Vector3(side * (width / 2 + 0.025), Math.cos(a) * radius * 0.3, Math.sin(a) * radius * 0.3), rimMat, spin, 6);
      bolt.rotation.z = Math.PI / 2;
      pieces.push(bolt);
    }
  }
  mergeByMaterial(pieces, spin, name + 'Wheel');
  return node;
}

// Misure del muletto in base alla taglia (scale): il corpo cresce in proporzione,
// forche e carrello restano delle misure dei pallet.
export function vehicleGeometry(vehicle) {
  const s = vehicle.scale || 1;
  const dz = 0.6 * (s - 1); // il montante si sposta in avanti col muso del corpo
  return {
    s,
    dz,
    wheelbase: 1.55 * s,
    body: { hw: 0.6 * s, z0: -2.25 * s, z1: 0.6 * s, height: 2.45 * s },
    mastZ: 0.48 + dz,
    forkBase: FORK.baseZ + dz,
    tipArm: FORK.baseZ + FORK.length - 0.48,
    mastHeight: 2.41 * s,
    freeLift: 1.6 * s,
    innerLen: 2.2 * s,
    // Alzata alta: montante triplo (sezione intermedia), cosi' le sezioni restano sempre sovrapposte
    triplex: (vehicle.lift || 0) - 1.6 * s > 0.75 * 2.2 * s,
    eye: (vehicle.eye || [0.05, 2.0, -0.75]).map((v) => v * s),
  };
}

// Modelli .glb in /public/models (caricati una volta sola)
const glbCache = new Map();
export async function tryLoadGLB(scene, file) {
  if (!glbCache.has(file)) glbCache.set(file, LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/${file}`, scene).catch(() => null));
  return glbCache.get(file);
}

export function instantiateGLB(container, parent, name) {
  const inst = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
  inst.rootNodes.forEach((n) => { n.parent = parent; });
  return inst;
}

// Oggetti del quartiere (Tripo 3D): caricati prima del mondo, cosi' le copie si uniscono ai fissi per materiale
const DECOR = ['lamp', 'dumpster', 'barrel', 'barrier', 'cone'];
export async function loadDecor(scene) {
  const out = {};
  await Promise.all(DECOR.map(async (k) => { out[k] = await tryLoadGLB(scene, `${k}.glb`); }));
  return out;
}

// Una copia del modello con la trasformazione gia' applicata ai vertici (senza genitori): pronta da unire
export function placeGLB(container, name, x, y, z, rotY = 0, scale = 1) {
  const inst = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
  const root = new TransformNode(name, container.scene);
  root.position.set(x, y, z);
  root.rotation.y = rotY;
  root.scaling.setAll(scale);
  inst.rootNodes.forEach((n) => { n.parent = root; });
  root.computeWorldMatrix(true);
  const meshes = [];
  for (const m of root.getChildMeshes()) {
    if (!m.getTotalVertices()) continue;
    m.makeGeometryUnique(); // le copie condividono i vertici: senza, ogni posizionamento sposterebbe anche le altre
    m.computeWorldMatrix(true);
    m.setParent(null);
    m.bakeCurrentTransformIntoVertices();
    m.refreshBoundingInfo();
    m.isPickable = false;
    meshes.push(m);
  }
  root.dispose();
  return meshes;
}

export async function createForkliftModel(scene, mats, vehicle) {
  const root = new TransformNode('forklift', scene);
  const st = vehicle.style || {};
  const geo = vehicleGeometry(vehicle);
  const rimMat = st.rim ? mats.paint(st.rim) : mats.steel;
  // Corpo, ruote e cabina in un gruppo che si ingrandisce con la taglia del mezzo
  const body = new TransformNode('forkliftBody', scene);
  body.parent = root;
  body.scaling.setAll(geo.s);
  let steerSpin = null;
  let roof = [];
  // Carrozzeria realistica (Tripo 3D, gia' in coordinate del muletto di taglia 1): montante, forche e ruote restano le nostre
  const glb = await tryLoadGLB(scene, vehicle.model);
  if (glb) {
    const inst = instantiateGLB(glb, body, 'forkliftBody');
    // Tetto della cabina (sopra gli occhi del guidatore): in prima persona diventa trasparente
    roof = inst.rootNodes[0].getChildMeshes(false).filter((m) => m.name.endsWith('roof'));
    // materiale proprio (quello del modello e' condiviso con gli operai ed e' forzato opaco)
    roof.forEach((m) => { m.material = m.material.clone(`${m.material.name}_roof`); });
    // Volante del modello: nodo separato che gira attorno al suo asse (centro e asse scritti nel file)
    const wheelMesh = inst.rootNodes[0].getChildMeshes(false).find((m) => m.name.endsWith('steer'));
    const ex = wheelMesh?.metadata?.gltf?.extras;
    if (ex?.center) {
      // Centro e asse dal file (spazio glTF, specchiato da Babylon) portati nello spazio del corpo:
      // cosi' il volante gira nello stesso verso dello sterzo
      root.computeWorldMatrix(true);
      const toBody = body.computeWorldMatrix(true).clone().invert();
      inst.rootNodes[0].computeWorldMatrix(true);
      const fileM = wheelMesh.parent.computeWorldMatrix(true);
      const pivot = new TransformNode('steerPivot', scene);
      pivot.parent = body;
      pivot.position = Vector3.TransformCoordinates(Vector3.TransformCoordinates(new Vector3(...ex.center), fileM), toBody);
      // l'asse y del perno coincide con l'asse del volante
      const axis = Vector3.TransformNormal(Vector3.TransformNormal(new Vector3(...ex.axis), fileM), toBody).normalize();
      const side = Vector3.Cross(Vector3.Up(), axis);
      const ang = Math.acos(Math.min(1, Vector3.Dot(Vector3.Up(), axis)));
      let q = side.lengthSquared() < 1e-6 ? Quaternion.Identity() : Quaternion.RotationAxis(side.normalize(), ang);
      // verso della rotazione: deve portare l'alto proprio sull'asse
      if (Vector3.Dot(Vector3.Up().applyRotationQuaternion(q), axis) < 0.99) q = Quaternion.RotationAxis(side, -ang);
      pivot.rotationQuaternion = q;
      steerSpin = new TransformNode('steerSpin', scene);
      steerSpin.parent = pivot;
      for (const n of [pivot, steerSpin, wheelMesh]) n.computeWorldMatrix(true);
      wheelMesh.setParent(steerSpin);
    }
    // Raccordo scuro tra il muso della carrozzeria e il montante
    box(scene, 'mastMount', 0.72, 0.3, 0.42, new Vector3(0, 0.4, 0.2), mats.darkSteel, body);
  }

  // Ruote: anteriori motrici fisse, posteriori sterzanti
  const frontWheels = [
    wheel(scene, 'wFL', 0.33, 0.24, new Vector3(-0.5, 0.33, 0), mats, body, rimMat),
    wheel(scene, 'wFR', 0.33, 0.24, new Vector3(0.5, 0.33, 0), mats, body, rimMat),
  ];
  if (st.dualFront) {
    // Ruote anteriori gemellate
    frontWheels.push(wheel(scene, 'wFL2', 0.33, 0.22, new Vector3(-0.74, 0.33, 0), mats, body, rimMat));
    frontWheels.push(wheel(scene, 'wFR2', 0.33, 0.22, new Vector3(0.74, 0.33, 0), mats, body, rimMat));
  }
  const rearWheels = [
    wheel(scene, 'wRL', 0.25, 0.18, new Vector3(-0.45, 0.25, -1.55), mats, body, rimMat),
    wheel(scene, 'wRR', 0.25, 0.18, new Vector3(0.45, 0.25, -1.55), mats, body, rimMat),
  ];

  // Montante (inclinabile) con sfilo interno e carrello porta-forche
  const mastPivot = new TransformNode('mastPivot', scene);
  mastPivot.parent = root;
  mastPivot.position.set(0, 0.15, geo.mastZ);
  // Montante esterno e sfilo: crescono con la taglia; carrello e forche no
  const outer = new TransformNode('outerMast', scene);
  outer.parent = mastPivot;
  outer.scaling.setAll(geo.s);
  for (const side of [-1, 1]) {
    // Profilo a I del montante esterno
    box(scene, 'mastWeb', 0.03, 2.2, 0.12, new Vector3(side * 0.34, 1.1, 0), mats.darkSteel, outer);
    box(scene, 'mastFlangeF', 0.1, 2.2, 0.02, new Vector3(side * 0.34, 1.1, 0.06), mats.darkSteel, outer);
    box(scene, 'mastFlangeB', 0.1, 2.2, 0.02, new Vector3(side * 0.34, 1.1, -0.06), mats.darkSteel, outer);
    // Cilindri di sollevamento laterali dietro al montante
    cyl(scene, 'liftCyl', 0.08, 1.7, new Vector3(side * 0.42, 0.95, -0.12), mats.steel, outer, 12);
    cyl(scene, 'liftRod', 0.04, 0.6, new Vector3(side * 0.42, 2.0, -0.12), mats.chrome, outer, 10);
  }
  box(scene, 'mastTop', 0.78, 0.1, 0.1, new Vector3(0, 2.15, 0), mats.darkSteel, outer);
  box(scene, 'mastCross', 0.78, 0.06, 0.06, new Vector3(0, 0.22, -0.02), mats.darkSteel, outer);
  // Sezione intermedia del montante triplo: sale a meta' della corsa dello sfilo interno
  let middle = null;
  if (geo.triplex) {
    middle = new TransformNode('middleMast', scene);
    middle.parent = mastPivot;
    const midBody = new TransformNode('middleMastBody', scene);
    midBody.parent = middle;
    midBody.scaling.setAll(geo.s);
    for (const side of [-1, 1]) box(scene, 'middleRail', 0.05, 2.2, 0.09, new Vector3(side * 0.29, 1.12, 0.0), mats.darkSteel, midBody);
    box(scene, 'middleTop', 0.63, 0.07, 0.07, new Vector3(0, 2.18, 0.0), mats.darkSteel, midBody);
    box(scene, 'middleLow', 0.63, 0.05, 0.05, new Vector3(0, 0.1, 0.0), mats.darkSteel, midBody);
  }
  const inner = new TransformNode('innerMast', scene);
  inner.parent = mastPivot;
  const innerBody = new TransformNode('innerMastBody', scene);
  innerBody.parent = inner;
  innerBody.scaling.setAll(geo.s);
  box(scene, 'innerL', 0.07, 2.2, 0.1, new Vector3(-0.24, 1.15, 0.06), mats.steel, innerBody);
  box(scene, 'innerR', 0.07, 2.2, 0.1, new Vector3(0.24, 1.15, 0.06), mats.steel, innerBody);
  box(scene, 'innerTop', 0.55, 0.08, 0.08, new Vector3(0, 2.22, 0.06), mats.steel, innerBody);

  const chains = [-1, 1].map((side) => {
    const c = MeshBuilder.CreateBox('chain', { width: 0.035, height: 1, depth: 0.02 }, scene);
    c.parent = mastPivot;
    c.position.set(side * 0.17, 1, 0.1);
    c.material = mats.chain;
    return c;
  });
  const carriage = new TransformNode('carriage', scene);
  carriage.parent = mastPivot;
  // Piastra porta-forche: due traverse (non un blocco pieno)
  box(scene, 'forkBarTop', 1.0, 0.09, 0.05, new Vector3(0, 0.5, 0.12), mats.darkSteel, carriage);
  box(scene, 'forkBarLow', 1.0, 0.07, 0.05, new Vector3(0, 0.1, 0.12), mats.darkSteel, carriage);
  for (const x of [-0.46, 0.46]) box(scene, 'carriageSide', 0.05, 0.47, 0.05, new Vector3(x, 0.3, 0.12), mats.darkSteel, carriage);
  // Griglia di protezione del carico, come sui muletti veri
  box(scene, 'backrestFrameTop', 1.0, 0.04, 0.04, new Vector3(0, 1.3, 0.12), mats.darkSteel, carriage);
  for (const x of [-0.48, 0.48]) box(scene, 'backrestFrameSide', 0.04, 0.78, 0.04, new Vector3(x, 0.92, 0.12), mats.darkSteel, carriage);
  for (const y of [0.8, 1.05]) box(scene, 'backrestRail', 0.96, 0.02, 0.02, new Vector3(0, y, 0.12), mats.darkSteel, carriage);
  for (let i = -4; i <= 4; i++) box(scene, 'backrestBar', 0.018, 0.76, 0.018, new Vector3(i * 0.105, 0.92, 0.12), mats.darkSteel, carriage);
  const forkMat = st.fork ? mats.paint(st.fork) : mats.steel;
  const makeFork = (name) => {
    const f = new TransformNode(name, scene);
    f.parent = carriage;
    // Forca a "L": gambo verticale + lama orizzontale (la lama parte dal carrello in avanti)
    box(scene, name + 'Shank', FORK.width, 0.55, 0.05, new Vector3(0, 0.27, 0.16), forkMat, f);
    box(scene, name + 'Blade', FORK.width, FORK.thickness, FORK.length - 0.12,
      new Vector3(0, FORK.thickness / 2, 0.14 + (FORK.length - 0.12) / 2), forkMat, f);
    box(scene, name + 'Tip', FORK.width, FORK.thickness, 0.12,
      new Vector3(0, FORK.thickness / 2, 0.14 + FORK.length - 0.06), mats.lineYellow, f);
    return f;
  };
  const forkL = makeFork('forkL');
  const forkR = makeFork('forkR');

  // Un solo oggetto per ogni gruppo che si muove insieme (meno chiamate di disegno, anche nelle ombre)
  for (const node of [outer, middle?.getChildren()[0], inner.getChildren()[0], carriage, forkL, forkR, steerSpin]) {
    if (!node) continue;
    const parts = node.getChildMeshes(true);
    if (parts.length > 1) mergeByMaterial(parts, node, node.name);
  }

  // Fari da lavoro sugli angoli davanti del tettuccio (come sui muletti veri), luci rosse sul contrappeso.
  // Posizioni prese dal modello: bordo del tetto e superficie posteriore della carrozzeria.
  const s = geo.s;
  const bodyMeshes = body.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
  root.computeWorldMatrix(true);
  let rx = 0.5 * s, ry = geo.body.height, rz = geo.mastZ - 0.35;
  if (roof.length) {
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const m of roof) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      x1 = Math.max(x1, b.maximumWorld.x, -b.minimumWorld.x);
      y1 = Math.max(y1, b.maximumWorld.y);
      z1 = Math.max(z1, b.maximumWorld.z);
    }
    rx = x1 - 0.1; ry = y1; rz = z1 - 0.08;
  }
  // scatola del faro appoggiata sul tetto (si vede anche di giorno), lente sulla sua faccia davanti
  const housings = [-1, 1].map((k) => box(scene, 'workLamp', 0.17, 0.13, 0.12, new Vector3(k * rx, ry + 0.065, rz), mats.darkSteel, root));
  mergeByMaterial(housings, root, 'workLamps');
  const ly = ry + 0.065, lz = rz + 0.06;
  const tz = (x, y) => snapZ(root, bodyMeshes, x, y, geo.body.z0 - 1, geo.body.z0 + 1.5) ?? geo.body.z0;
  const ty = 0.9 * s, tx = 0.42 * s;
  const lights = createHeadlights(scene, 'forkliftLights', {
    lamps: [[rx, ly, lz], [-rx, ly, lz]],
    tails: [[tx, ty, tz(tx, ty)], [-tx, ty, tz(-tx, ty)]],
    lens: [0.13, 0.09], tailLens: [0.12, 0.06], glow: 0.13,
    beam: { z0: geo.mastZ - 0.2, z1: geo.mastZ + 12, w0: 1.6 * s, w1: 7.5 },
  }, root);
  const B = geo.body;
  addBlobShadow(scene, root, B.hw * 3.3, (B.z1 - B.z0) * 1.45, 0, (B.z0 + B.z1) / 2);
  const all = root.getChildMeshes().filter((m) => !m.metadata?.headlights);
  return { root, lights, mastPivot, middle, inner, carriage, chains, steerSpin, forkL, forkR, frontWheels, rearWheels, roof, meshes: all };
}

// Colore della cabina -> una delle tre motrici Tripo (rossa, blu, bianca)
function tractorTint(color) {
  const n = parseInt(color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (Math.min(r, g, b) > 200) return 'white';
  return b > r ? 'blue' : 'red';
}

export async function createTruckModel(scene, mats, color = '#d63a2f') {
  const root = new TransformNode('truck', scene);
  const { bedLength: L, bedWidth: W, bedHeight: H } = TRUCK;
  // Motrice realistica (Tripo 3D) del colore piu' vicino; il rimorchio piatto resta nostro (preciso per i carichi)
  const tractor = await tryLoadGLB(scene, `truck-${tractorTint(color)}.glb`);
  // Pianale (rimorchio)
  box(scene, 'bed', L, 0.22, W, new Vector3(0, H - 0.11, 0), mats.wood, root);
  box(scene, 'bedEdgeL', L, 0.12, 0.08, new Vector3(0, H - 0.06, W / 2), mats.darkSteel, root);
  box(scene, 'bedEdgeR', L, 0.12, 0.08, new Vector3(0, H - 0.06, -W / 2), mats.darkSteel, root);
  box(scene, 'frameL', L, 0.3, 0.15, new Vector3(0, H - 0.37, 0.7), mats.darkSteel, root);
  box(scene, 'frameR', L, 0.3, 0.15, new Vector3(0, H - 0.37, -0.7), mats.darkSteel, root);
  box(scene, 'headboard', 0.12, 1.4, W, new Vector3(L / 2 - 0.06, H + 0.7, 0), mats.darkSteel, root);
  for (const x of [-L / 2 + 1.0, -L / 2 + 2.3, -L / 2 + 3.6]) {
    for (const z of [-0.95, 0.95]) {
      const w = wheel(scene, 'tw', 0.5, 0.35, new Vector3(x, 0.5, z), mats, root);
      w.rotation.y = Math.PI / 2;
    }
  }
  box(scene, 'mudguard', 3.8, 0.08, W, new Vector3(-L / 2 + 2.3, 1.04, 0), mats.rubber, root);
  box(scene, 'legL', 0.15, 0.7, 0.15, new Vector3(1.5, 0.35, 0.8), mats.steel, root);
  box(scene, 'legR', 0.15, 0.7, 0.15, new Vector3(1.5, 0.35, -0.8), mats.steel, root);
  // traversa paracolpi in fondo al rimorchio: porta le luci rosse
  box(scene, 'rearBar', 0.1, 0.22, W - 0.1, new Vector3(-L / 2 - 0.01, 0.82, 0), mats.darkSteel, root);
  // Il modello ha il paraurti in z = 0 e guarda verso +z: ruotato verso +x, davanti al pianale
  const cab = new TransformNode('tractor', scene);
  cab.parent = root;
  cab.rotation.y = Math.PI / 2;
  cab.position.x = L / 2 + 3.95;
  instantiateGLB(tractor, cab, 'tractor');
  mergeByMaterial(root.getChildMeshes().filter((m) => !m.name.startsWith('tractor')), root, 'truck');
  // fanali sul paraurti della motrice (posizione cercata sul modello) e luci rosse sulla traversa in fondo al
  // rimorchio; i fanali guardano +z: nodo girato verso il muso (+x)
  const lights = new TransformNode('truckLights', scene);
  lights.parent = root;
  lights.rotation.y = Math.PI / 2;
  const front = L / 2 + 3.95; // paraurti della motrice
  const cabMeshes = cab.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
  const fz = (x, y) => snapZ(lights, cabMeshes, x, y, front + 1, front - 1.5) ?? front;
  const lx = 0.82, ly = 1.12;
  createHeadlights(scene, 'truckLamps', {
    lamps: [[lx, ly, fz(lx, ly)], [-lx, ly, fz(-lx, ly)]],
    tails: [[1.0, 0.82, -L / 2 - 0.06], [-1.0, 0.82, -L / 2 - 0.06]],
    lens: [0.3, 0.12], tailLens: [0.26, 0.1], glow: 0.18,
    beam: { z0: front - 0.3, z1: front + 18, w0: 2.4, w1: 9 },
  }, lights);
  addBlobShadow(scene, root, L + 6.5, W + 1.6, 1.975, 0);
  return root;
}

// Pallet EPAL a 4 vie: una base in legno condivisa + un carico scalabile.
let palletTemplate = null;
let loadTemplates = null;
export async function createPalletModel(scene, mats, { loadHeight = 1, fragile = false } = {}) {
  const root = new TransformNode('pallet', scene);
  if (!palletTemplate) {
    // Pallet realistico (Tripo 3D) se presente: diventa il modello sorgente delle istanze
    const glb = await tryLoadGLB(scene, 'pallet.glb');
    const src = glb?.meshes.find((m) => m.getTotalVertices() > 0);
    if (src && !palletTemplate) {
      const inst = glb.instantiateModelsToScene((n) => `palletGlb_${n}`, false);
      const mesh = inst.rootNodes[0].getChildMeshes().find((m) => m.getTotalVertices() > 0);
      mesh.setParent(null); // tiene la trasformazione (conversione glTF) ...
      mesh.bakeCurrentTransformIntoVertices(); // ... e la scrive nei vertici
      inst.rootNodes.forEach((n) => n.dispose());
      mesh.name = 'palletTemplate';
      palletTemplate = mesh;
    }
  }
  if (!loadTemplates) {
    // Modelli "sorgente" delle istanze: tenuti sotto terra, li disegnano solo le istanze
    loadTemplates = [mats.cardboard, mats.fragileBox].map((mat) => box(scene, 'loadTemplate', 1.1, 1, 1.1, new Vector3(0, 0, 0), mat));
    for (const t of [palletTemplate, ...loadTemplates]) {
      t.position.y = -500;
      t.isPickable = false;
      t.receiveShadows = true;
      t.metadata = { rearview: true };
    }
  }
  // Istanze: tutti i pallet (e tutti i carichi) del gioco in un'unica chiamata di disegno
  const base = palletTemplate.createInstance('palletBase');
  base.parent = root;
  base.position.set(0, 0, 0);
  const load = loadTemplates[fragile ? 1 : 0].createInstance('load');
  load.parent = root;
  load.scaling.y = loadHeight;
  load.position.set(0, PALLET.height + loadHeight / 2, 0);
  return root;
}
