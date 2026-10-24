import { MeshBuilder, TransformNode, Mesh, Vector3, LoadAssetContainerAsync } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

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

function wheel(scene, name, radius, width, pos, mats, parent) {
  const node = new TransformNode(name, scene);
  node.parent = parent;
  node.position.copyFrom(pos);
  const tyre = cyl(scene, name + 'Tyre', radius * 2, width, Vector3.Zero(), mats.rubber, node, 24);
  tyre.rotation.z = Math.PI / 2;
  const rim = cyl(scene, name + 'Rim', radius * 1.15, width + 0.02, Vector3.Zero(), mats.steel, node, 16);
  rim.rotation.z = Math.PI / 2;
  return node;
}

// File .glb opzionali in /public/models: se presenti sostituiscono i modelli procedurali.
const glbCache = new Map();
export async function tryLoadGLB(scene, file) {
  if (glbCache.has(file)) return glbCache.get(file);
  let container = null;
  try {
    const res = await fetch(`/models/${file}`, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('html')) {
      container = await LoadAssetContainerAsync(`/models/${file}`, scene);
    }
  } catch {
    container = null;
  }
  glbCache.set(file, container);
  return container;
}

function instantiateGLB(container, parent, name) {
  const inst = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
  inst.rootNodes.forEach((n) => { n.parent = parent; });
  return inst;
}

export async function createForkliftModel(scene, mats, vehicle) {
  const root = new TransformNode('forklift', scene);
  const paint = mats.paint(vehicle.color);
  const parts = [];

  let steerSpin = null;
  const glb = await tryLoadGLB(scene, 'forklift.glb');
  if (glb) {
    instantiateGLB(glb, root, 'forkliftBody');
  } else {
    // Telaio e contrappeso
    parts.push(box(scene, 'chassis', 1.15, 0.5, 1.8, new Vector3(0, 0.45, -1.15), paint, root));
    const cw = box(scene, 'counterweight', 1.18, 0.75, 0.55, new Vector3(0, 0.75, -1.9), paint, root);
    parts.push(cw);
    parts.push(box(scene, 'cwTop', 1.1, 0.12, 0.5, new Vector3(0, 1.17, -1.88), mats.darkSteel, root));
    parts.push(box(scene, 'hood', 1.05, 0.3, 1.0, new Vector3(0, 0.85, -1.15), paint, root));
    parts.push(box(scene, 'step', 1.2, 0.08, 0.5, new Vector3(0, 0.25, 0.05), mats.darkSteel, root));
    parts.push(box(scene, 'dash', 0.42, 0.16, 0.22, new Vector3(-0.24, 0.9, 0.0), mats.darkSteel, root));
    // Sedile
    parts.push(box(scene, 'seat', 0.5, 0.12, 0.5, new Vector3(0, 1.08, -0.75), mats.seat, root));
    const back = box(scene, 'seatBack', 0.5, 0.55, 0.1, new Vector3(0, 1.38, -1.0), mats.seat, root);
    back.rotation.x = -0.15;
    parts.push(back);
    // Volante
    // Volante scuro con pomello e piantone con display
    const steerNode = new TransformNode('steerNode', scene);
    steerNode.parent = root;
    steerNode.position.set(-0.24, 1.42, -0.26);
    steerNode.rotation.x = -0.75;
    // Parte rotante del volante (gira con lo sterzo)
    steerSpin = new TransformNode('steerSpin', scene);
    steerSpin.parent = steerNode;
    const rim = MeshBuilder.CreateTorus('steerRim', { diameter: 0.4, thickness: 0.04, tessellation: 32 }, scene);
    rim.parent = steerSpin;
    rim.material = mats.rubber;
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
      const spoke = box(scene, 'spoke', 0.18, 0.02, 0.03, new Vector3(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09), mats.rubber, steerSpin);
      spoke.rotation.y = -a;
    }
    cyl(scene, 'steerHub', 0.08, 0.04, Vector3.Zero(), mats.darkSteel, steerSpin, 16);
    cyl(scene, 'steerKnob', 0.045, 0.07, new Vector3(0.14, 0.04, -0.14), mats.seat, steerSpin, 12);
    const col = cyl(scene, 'steerCol', 0.07, 0.55, new Vector3(-0.24, 1.2, -0.09), mats.darkSteel, root);
    col.rotation.x = 0.8;
    parts.push(col);
    const display = box(scene, 'display', 0.14, 0.08, 0.01, new Vector3(-0.24, 1.38, -0.02), mats.display, root);
    display.rotation.x = -0.6;
    parts.push(display);
    // Tettuccio di protezione
    for (const [x, z, h] of [[-0.52, 0.15, 2.0], [0.52, 0.15, 2.0], [-0.52, -1.55, 1.25], [0.52, -1.55, 1.25]]) {
      parts.push(box(scene, 'post', 0.085, h, 0.085, new Vector3(x, z > 0 ? 1.15 + h / 2 - 0.15 : 1.2 + h / 2, z), mats.darkSteel, root));
    }
    parts.push(box(scene, 'guardRoof', 1.12, 0.06, 1.85, new Vector3(0, 2.32, -0.7), mats.darkSteel, root));
    for (let i = 0; i < 5; i++) {
      parts.push(box(scene, 'guardBar', 1.1, 0.04, 0.05, new Vector3(0, 2.36, -1.5 + i * 0.4), mats.darkSteel, root));
    }
    // Fari e lampeggiante
    parts.push(box(scene, 'lampL', 0.1, 0.08, 0.05, new Vector3(-0.6, 2.2, 0.17), mats.light, root));
    parts.push(box(scene, 'lampR', 0.1, 0.08, 0.05, new Vector3(0.6, 2.2, 0.17), mats.light, root));
    parts.push(cyl(scene, 'beacon', 0.12, 0.1, new Vector3(0.4, 2.42, -1.4), mats.lineYellow, root, 12));
    parts.push(box(scene, 'tailL', 0.1, 0.08, 0.03, new Vector3(-0.5, 0.95, -2.18), mats.redLight, root));
    parts.push(box(scene, 'tailR', 0.1, 0.08, 0.03, new Vector3(0.5, 0.95, -2.18), mats.redLight, root));
  }

  // Ruote: anteriori motrici fisse, posteriori sterzanti
  const frontWheels = [
    wheel(scene, 'wFL', 0.33, 0.24, new Vector3(-0.5, 0.33, 0), mats, root),
    wheel(scene, 'wFR', 0.33, 0.24, new Vector3(0.5, 0.33, 0), mats, root),
  ];
  const rearWheels = [
    wheel(scene, 'wRL', 0.25, 0.18, new Vector3(-0.45, 0.25, -1.55), mats, root),
    wheel(scene, 'wRR', 0.25, 0.18, new Vector3(0.45, 0.25, -1.55), mats, root),
  ];

  // Montante (inclinabile) con sfilo interno e carrello porta-forche
  const mastPivot = new TransformNode('mastPivot', scene);
  mastPivot.parent = root;
  mastPivot.position.set(0, 0.15, 0.48);
  for (const side of [-1, 1]) {
    // Profilo a I del montante esterno
    box(scene, 'mastWeb', 0.03, 2.2, 0.12, new Vector3(side * 0.34, 1.1, 0), mats.darkSteel, mastPivot);
    box(scene, 'mastFlangeF', 0.1, 2.2, 0.02, new Vector3(side * 0.34, 1.1, 0.06), mats.darkSteel, mastPivot);
    box(scene, 'mastFlangeB', 0.1, 2.2, 0.02, new Vector3(side * 0.34, 1.1, -0.06), mats.darkSteel, mastPivot);
    // Cilindri di sollevamento laterali dietro al montante
    cyl(scene, 'liftCyl', 0.08, 1.7, new Vector3(side * 0.42, 0.95, -0.12), mats.steel, mastPivot, 12);
    cyl(scene, 'liftRod', 0.04, 0.6, new Vector3(side * 0.42, 2.0, -0.12), mats.chrome, mastPivot, 10);
  }
  box(scene, 'mastTop', 0.78, 0.1, 0.1, new Vector3(0, 2.15, 0), mats.darkSteel, mastPivot);
  box(scene, 'mastCross', 0.78, 0.06, 0.06, new Vector3(0, 0.22, -0.02), mats.darkSteel, mastPivot);
  const inner = new TransformNode('innerMast', scene);
  inner.parent = mastPivot;
  box(scene, 'innerL', 0.07, 2.2, 0.1, new Vector3(-0.24, 1.15, 0.06), mats.steel, inner);
  box(scene, 'innerR', 0.07, 2.2, 0.1, new Vector3(0.24, 1.15, 0.06), mats.steel, inner);
  box(scene, 'innerTop', 0.55, 0.08, 0.08, new Vector3(0, 2.22, 0.06), mats.steel, inner);

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
  const makeFork = (name) => {
    const f = new TransformNode(name, scene);
    f.parent = carriage;
    // Forca a "L": gambo verticale + lama orizzontale (la lama parte dal carrello in avanti)
    box(scene, name + 'Shank', FORK.width, 0.55, 0.05, new Vector3(0, 0.27, 0.16), mats.steel, f);
    box(scene, name + 'Blade', FORK.width, FORK.thickness, FORK.length - 0.12,
      new Vector3(0, FORK.thickness / 2, 0.14 + (FORK.length - 0.12) / 2), mats.steel, f);
    box(scene, name + 'Tip', FORK.width, FORK.thickness, 0.12,
      new Vector3(0, FORK.thickness / 2, 0.14 + FORK.length - 0.06), mats.lineYellow, f);
    return f;
  };
  const forkL = makeFork('forkL');
  const forkR = makeFork('forkR');

  const all = root.getChildMeshes();
  return { root, mastPivot, inner, carriage, chains, steerSpin, forkL, forkR, frontWheels, rearWheels, meshes: all };
}

export async function createTruckModel(scene, mats, color = '#d63a2f') {
  const root = new TransformNode('truck', scene);
  const glb = await tryLoadGLB(scene, 'truck.glb');
  if (glb) {
    instantiateGLB(glb, root, 'truckBody');
    return root;
  }
  const { bedLength: L, bedWidth: W, bedHeight: H } = TRUCK;
  const cabPaint = mats.paint(color);
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
  // Trattore
  const cx = L / 2 + 1.9;
  box(scene, 'tractorFrame', 4.2, 0.35, 1.3, new Vector3(cx - 0.2, 0.85, 0), mats.darkSteel, root);
  box(scene, 'cab', 2.0, 2.3, W, new Vector3(cx + 0.9, 2.15, 0), cabPaint, root);
  box(scene, 'cabRoof', 1.6, 0.7, W - 0.1, new Vector3(cx + 0.7, 3.65, 0), cabPaint, root);
  box(scene, 'windshield', 0.05, 1.0, W - 0.3, new Vector3(cx + 1.91, 2.6, 0), mats.glass, root);
  box(scene, 'grille', 0.06, 0.9, W - 0.5, new Vector3(cx + 1.92, 1.45, 0), mats.darkSteel, root);
  box(scene, 'bumper', 0.25, 0.3, W, new Vector3(cx + 1.95, 0.75, 0), mats.darkSteel, root);
  box(scene, 'headL', 0.05, 0.18, 0.4, new Vector3(cx + 1.96, 1.1, 0.9), mats.light, root);
  box(scene, 'headR', 0.05, 0.18, 0.4, new Vector3(cx + 1.96, 1.1, -0.9), mats.light, root);
  box(scene, 'tank', 1.0, 0.5, 0.5, new Vector3(cx + 0.2, 0.85, 1.05), mats.steel, root);
  for (const x of [cx + 1.2, cx - 1.2, cx - 2.2]) {
    for (const z of [-1.0, 1.0]) {
      const w = wheel(scene, 'cw', 0.5, 0.35, new Vector3(x, 0.5, z), mats, root);
      w.rotation.y = Math.PI / 2;
    }
  }
  return root;
}

// Pallet EPAL a 4 vie: una base in legno condivisa + un carico scalabile.
let palletTemplate = null;
export async function createPalletModel(scene, mats, { loadHeight = 1, fragile = false } = {}) {
  const glb = await tryLoadGLB(scene, 'pallet.glb');
  const root = new TransformNode('pallet', scene);
  if (glb) {
    instantiateGLB(glb, root, 'pallet');
    return root;
  }
  if (!palletTemplate) {
    const s = PALLET.size;
    const parts = [];
    for (let i = 0; i < 5; i++) {
      parts.push(box(scene, 'slat', s, 0.022, 0.145, new Vector3(0, PALLET.height - 0.011, -s / 2 + 0.0725 + i * (s - 0.145) / 4), mats.wood));
    }
    for (const x of [-s / 2 + 0.07, 0, s / 2 - 0.07]) {
      for (const z of [-s / 2 + 0.07, 0, s / 2 - 0.07]) {
        parts.push(box(scene, 'block', 0.14, 0.1, 0.14, new Vector3(x, 0.072, z), mats.wood));
      }
      parts.push(box(scene, 'runner', 0.14, 0.022, s, new Vector3(x, 0.011, 0), mats.wood));
    }
    palletTemplate = Mesh.MergeMeshes(parts, true, true);
    palletTemplate.name = 'palletTemplate';
    palletTemplate.setEnabled(false);
  }
  const base = palletTemplate.clone('palletBase', root);
  base.setEnabled(true);
  base.position.set(0, 0, 0);
  const boxes = box(scene, 'load', 1.1, loadHeight, 1.1, new Vector3(0, PALLET.height + loadHeight / 2, 0),
    fragile ? mats.fragileBox : mats.cardboard, root);
  boxes.scaling.set(1, 1, 1);
  const wrap = box(scene, 'wrap', 1.13, loadHeight + 0.03, 1.13, new Vector3(0, PALLET.height + loadHeight / 2, 0), mats.wrap, root);
  wrap.isPickable = false;
  return root;
}
