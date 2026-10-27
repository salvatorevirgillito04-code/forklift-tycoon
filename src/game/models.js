import { MeshBuilder, TransformNode, Mesh, Vector3, Quaternion, Curve3, LoadAssetContainerAsync } from '@babylonjs/core';
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

// File .glb opzionali in /public/models: se presenti sostituiscono i modelli procedurali.
const glbCache = new Map();
export async function tryLoadGLB(scene, file) {
  if (glbCache.has(file)) return glbCache.get(file);
  let container = null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}models/${file}`, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('html')) {
      container = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/${file}`, scene);
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

// Oggetti del quartiere (Tripo 3D): caricati prima del mondo, cosi' le copie si uniscono ai fissi per materiale
export const DECOR = ['lamp', 'dumpster', 'barrel', 'barrier', 'cone'];
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
  const paint = mats.paint(vehicle.color);
  const trim = st.trim ? mats.paint(st.trim) : mats.darkSteel;
  const rimMat = st.rim ? mats.paint(st.rim) : mats.steel;
  // Corpo, ruote e cabina in un gruppo che si ingrandisce con la taglia del mezzo
  const body = new TransformNode('forkliftBody', scene);
  body.parent = root;
  body.scaling.setAll(geo.s);
  const parts = [];

  let steerSpin = null;
  let roof = [];
  // Carrozzeria realistica (Tripo 3D, gia' in coordinate del muletto di taglia 1): montante, forche e ruote restano le nostre
  const glb = await tryLoadGLB(scene, vehicle.model || 'forklift.glb');
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
  } else {
    // Telaio e contrappeso
    parts.push(box(scene, 'chassis', 1.15, 0.5, 1.8, new Vector3(0, 0.45, -1.15), paint, body));
    // Contrappeso: parte anteriore squadrata e retro curvo (visto dall'alto)
    parts.push(box(scene, 'counterweight', 1.18, 0.75, 0.35, new Vector3(0, 0.75, -1.8), paint, body));
    const cwBack = cyl(scene, 'cwBack', 1.18, 0.75, new Vector3(0, 0.75, -1.97), paint, body, 28);
    cwBack.scaling.z = 0.42;
    parts.push(cwBack);
    if (st.roundRear) {
      // Contrappeso arrotondato (mezzi pesanti)
      const r = cyl(scene, 'cwRound', 0.7, 1.18, new Vector3(0, 0.95, -2.02), paint, body, 20);
      r.rotation.z = Math.PI / 2;
    }
    const cwTop = cyl(scene, 'cwTop', 1.12, 0.12, new Vector3(0, 1.17, -1.9), trim, body, 28);
    cwTop.scaling.z = 0.5;
    parts.push(cwTop);
    // Cofano bombato: capsula schiacciata lungo la macchina
    const hood = MeshBuilder.CreateCapsule('hood', { radius: 0.5, height: 2.4, tessellation: 16, subdivisions: 2 }, scene);
    hood.parent = body;
    hood.position.set(0, 0.86, -1.15);
    hood.rotation.x = Math.PI / 2; // asse della capsula lungo la macchina
    hood.scaling.set(1.05, 0.46, 0.36); // larghezza, lunghezza (~1,1 m), altezza
    hood.material = trim;
    parts.push(hood);
    parts.push(box(scene, 'step', 1.2, 0.08, 0.5, new Vector3(0, 0.25, 0.05), mats.darkSteel, body));
    parts.push(box(scene, 'dash', 0.42, 0.16, 0.22, new Vector3(-0.24, 0.9, 0.0), trim, body));
    // Sedile
    parts.push(box(scene, 'seat', 0.5, 0.12, 0.5, new Vector3(0, 1.08, -0.75), mats.seat, body));
    const back = box(scene, 'seatBack', 0.5, 0.55, 0.1, new Vector3(0, 1.38, -1.0), mats.seat, body);
    back.rotation.x = -0.15;
    parts.push(back);
    // Volante scuro con pomello e piantone con display
    const steerNode = new TransformNode('steerNode', scene);
    steerNode.parent = body;
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
    const col = cyl(scene, 'steerCol', 0.07, 0.55, new Vector3(-0.24, 1.2, -0.09), mats.darkSteel, body);
    col.rotation.x = 0.8;
    parts.push(col);
    const display = box(scene, 'display', 0.14, 0.08, 0.01, new Vector3(-0.24, 1.38, -0.02), mats.display, body);
    display.rotation.x = -0.6;
    parts.push(display);
    // Tettuccio di protezione
    const curved = st.cab !== 'closed';
    for (const x of [-0.52, 0.52]) {
      // Montanti posteriori dritti
      parts.push(box(scene, 'post', 0.085, 1.25, 0.085, new Vector3(x, 1.2 + 0.625, -1.55), mats.darkSteel, body));
      if (curved) {
        // Montanti anteriori: dritti in basso, poi piegati ad arco verso il tetto
        const path = [new Vector3(x, 1.0, 0.15), new Vector3(x, 1.85, 0.15)]
          .concat(Curve3.CreateQuadraticBezier(new Vector3(x, 1.85, 0.15), new Vector3(x, 2.34, 0.15), new Vector3(x, 2.34, -0.35), 10).getPoints().slice(1));
        const tube = MeshBuilder.CreateTube('postCurve', { path, radius: 0.045, tessellation: 8, cap: Mesh.CAP_ALL }, scene);
        tube.parent = body;
        tube.material = mats.darkSteel;
        parts.push(tube);
      } else {
        parts.push(box(scene, 'post', 0.085, 2.0, 0.085, new Vector3(x, 1.15 + 1.0 - 0.15, 0.15), mats.darkSteel, body));
      }
    }
    const roofFront = curved ? -0.35 : 0.22;
    const roofLen = roofFront + 1.62;
    parts.push(box(scene, 'guardRoof', 1.12, 0.06, roofLen, new Vector3(0, 2.32, roofFront - roofLen / 2), mats.darkSteel, body));
    for (let z = -1.5; z <= roofFront - 0.1; z += 0.38) {
      parts.push(box(scene, 'guardBar', 1.1, 0.04, 0.05, new Vector3(0, 2.36, z), mats.darkSteel, body));
    }
    // Fari e lampeggiante
    parts.push(box(scene, 'lampL', 0.1, 0.08, 0.05, new Vector3(-0.6, 1.9, 0.17), mats.light, body));
    parts.push(box(scene, 'lampR', 0.1, 0.08, 0.05, new Vector3(0.6, 1.9, 0.17), mats.light, body));
    parts.push(cyl(scene, 'beacon', 0.12, 0.1, new Vector3(0.4, 2.42, -1.4), mats.lineYellow, body, 12));
    parts.push(box(scene, 'tailL', 0.1, 0.08, 0.03, new Vector3(-0.5, 0.95, -2.18), mats.redLight, body));
    parts.push(box(scene, 'tailR', 0.1, 0.08, 0.03, new Vector3(0.5, 0.95, -2.18), mats.redLight, body));

    // Dettagli tipici di ogni modello
    if (st.lpg) {
      // Bombola GPL orizzontale dietro al sedile
      const tank = cyl(scene, 'lpgTank', 0.34, 0.85, new Vector3(0.05, 1.5, -1.62), mats.steel, body, 20);
      tank.rotation.z = Math.PI / 2;
      for (const x of [-0.3, 0.35]) box(scene, 'lpgStrap', 0.04, 0.38, 0.38, new Vector3(x, 1.5, -1.62), mats.darkSteel, body);
    }
    if (st.exhaust) {
      // Scarico verticale dietro alla cabina
      cyl(scene, 'exhaust', 0.11, 1.5, new Vector3(0.48, 1.95, -1.7), mats.darkSteel, body, 12);
      cyl(scene, 'exhaustCap', 0.14, 0.12, new Vector3(0.48, 2.72, -1.7), mats.rubber, body, 12);
    }
    if (st.workLights) {
      for (const x of [-0.56, 0.56]) cyl(scene, 'workLight', 0.14, 0.05, new Vector3(x, 1.75, 0.2), mats.light, body, 12).rotation.x = Math.PI / 2;
    }
    // --- Dettagli comuni ---
    // Parafanghi: semicilindri sopra le ruote
    const fender = (name, x, z, radius, width) => {
      const node = new TransformNode(name + 'Node', scene);
      node.parent = body;
      node.position.set(x, radius * 0.9, z);
      node.rotation.z = Math.PI / 2; // asse lungo X
      const f = MeshBuilder.CreateCylinder(name, {
        diameter: radius * 2 + 0.12, height: width, arc: 0.5, tessellation: 20, enclose: false, sideOrientation: Mesh.DOUBLESIDE,
      }, scene);
      f.parent = node;
      f.rotation.y = -Math.PI / 2; // meta' superiore
      f.material = paint;
      parts.push(f);
    };
    for (const x of [-0.5, 0.5]) fender('fenderF', x, 0, 0.33, 0.28);
    for (const x of [-0.47, 0.47]) fender('fenderR', x, -1.55, 0.25, 0.22);
    // Gradino d'accesso a sinistra e maniglia sul montante
    parts.push(box(scene, 'sideStep', 0.08, 0.04, 0.38, new Vector3(-0.64, 0.42, -0.25), mats.darkSteel, body));
    parts.push(box(scene, 'stepTread', 0.12, 0.012, 0.36, new Vector3(-0.66, 0.445, -0.25), mats.steel, body));
    const grab = cyl(scene, 'grabHandle', 0.035, 0.7, new Vector3(-0.47, 1.55, 0.12), mats.lineYellow, body, 8);
    parts.push(grab);
    // Prese d'aria sul cofano e griglia posteriore del contrappeso
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        parts.push(box(scene, 'vent', 0.012, 0.035, 0.32, new Vector3(side * 0.53, 0.82 + i * 0.06, -1.2), trim, body));
      }
    }
    for (let i = 0; i < 4; i++) {
      parts.push(box(scene, 'rearGrille', 0.7, 0.035, 0.02, new Vector3(0, 0.62 + i * 0.075, -2.18), trim, body));
    }
    // Gancio di traino e fari di lavoro posteriori
    parts.push(box(scene, 'towPin', 0.14, 0.1, 0.12, new Vector3(0, 0.42, -2.2), mats.darkSteel, body));
    for (const x of [-0.45, 0.45]) parts.push(box(scene, 'rearLamp', 0.09, 0.07, 0.04, new Vector3(x, 2.25, -1.6), mats.light, body));
    // Targhetta con la sigla del modello sui fianchi
    const code = (vehicle.name.split(' ')[1] || vehicle.name).slice(0, 6);
    for (const side of [-1, 1]) {
      const plate = MeshBuilder.CreatePlane('badge', { width: 0.36, height: 0.12 }, scene);
      plate.parent = body;
      plate.position.set(side * 0.605, 0.98, -0.95);
      plate.rotation.y = side * Math.PI / 2;
      plate.material = mats.sign(code, st.trim || '#222222', '#ffffff');
      parts.push(plate);
    }

    if (st.cab === 'closed') {
      // Cabina aperta: niente vetri ne' portiere, resta il tetto pieno sopra i montanti.
      const shell = [box(scene, 'cabRoof', 1.16, 0.1, 1.9, new Vector3(0, 2.4, -0.7), trim, body)];
      for (const m of shell) m.metadata = { cabShell: true };
    }
  }

  // Parti fisse del corpo unite in un'unica mesh (piu' leggera da disegnare)
  if (parts.length > 1) {
    // le parti con cabShell restano separate (si nascondono in prima persona)
    mergeByMaterial(parts.filter((m) => !m.metadata?.cabShell), root, 'forkliftBody');
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
    const parts = node.getChildMeshes(true).filter((m) => !m.metadata?.cabShell);
    if (parts.length > 1) mergeByMaterial(parts, node, node.name);
  }

  const all = root.getChildMeshes();
  const cabShell = all.filter((m) => m.metadata?.cabShell);
  return { root, mastPivot, middle, inner, carriage, chains, steerSpin, forkL, forkR, frontWheels, rearWheels, cabShell, roof, meshes: all };
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
  if (tractor) {
    // Il modello ha il paraurti in z = 0 e guarda verso +z: ruotato verso +x, muso dove finiva la motrice procedurale
    const cab = new TransformNode('tractor', scene);
    cab.parent = root;
    cab.rotation.y = Math.PI / 2;
    cab.position.x = L / 2 + 3.95;
    instantiateGLB(tractor, cab, 'tractor');
    mergeByMaterial(root.getChildMeshes().filter((m) => !m.name.startsWith('tractor')), root, 'truck');
    return root;
  }
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
  mergeByMaterial(root.getChildMeshes(), root, 'truck');
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
  }
  if (!loadTemplates) {
    // Modelli "sorgente" delle istanze: tenuti sotto terra, li disegnano solo le istanze
    loadTemplates = [mats.cardboard, mats.fragileBox].map((mat) => box(scene, 'loadTemplate', 1.1, 1, 1.1, new Vector3(0, 0, 0), mat));
    for (const t of [palletTemplate, ...loadTemplates]) {
      t.position.y = -500;
      t.isPickable = false;
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
