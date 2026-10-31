import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { WAREHOUSES, WORLD, ROAD_LAMPS_X } from '../data.js';
import { placeGLB } from './models.js';

// Geometria di un lotto in coordinate locali (u lungo X, w = distanza dalla strada).
export const PLOT = {
  halfWidth: 22,
  yard: [8, 30],
  building: { u: [-15, 15], w: [30, 56], height: 9 },
  door: { u: [-3.5, 3.5], height: 5.5 },
  truck: { u: -3, w: 16 }, // centro del pianale
  zone: { u: [-6, 6], w: [35.5, 44.5] },
  // Scaffalatura vera sul fondo: 14 campate da un pallet, 3 piani (terra, 1,4 m, 2,8 m: arriva anche il Compact)
  racks: { u: [-12.25, 12.25], bay: 1.75, w: [54.4, 55.5], levels: [0, 1.4, 2.8], beam: 0.1, height: 3.9 },
};

// Rotazione del lampione Tripo che porta il braccio verso -z (centro strada per i lampioni a z > 0)
const LAMP_ROT = Math.PI / 2;

export const plotToWorld = (wh, u, w) => [wh.cx + u, wh.side * w];

function rangeToBox(wh, u0, u1, w0, w1) {
  const [x0, z0] = plotToWorld(wh, u0, w0);
  const [x1, z1] = plotToWorld(wh, u1, w1);
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
}

// Posti sulla scaffalatura: centro di ogni campata per ogni piano, in coordinate del mondo
export function rackSlots(wh) {
  const R = PLOT.racks, out = [];
  const bays = Math.round((R.u[1] - R.u[0]) / R.bay);
  for (const h of R.levels) {
    for (let i = 0; i < bays; i++) {
      const [x, z] = plotToWorld(wh, R.u[0] + (i + 0.5) * R.bay, (R.w[0] + R.w[1]) / 2);
      out.push({ x, z, h });
    }
  }
  return out;
}

export function rackRect(wh) {
  const R = PLOT.racks;
  return rangeToBox(wh, R.u[0], R.u[1], R.w[0] - 0.1, R.w[1]);
}

export function zoneRect(wh) {
  return rangeToBox(wh, PLOT.zone.u[0], PLOT.zone.u[1], PLOT.zone.w[0], PLOT.zone.w[1]);
}

// UV calcolati dalle coordinate del mondo: la texture si ripete ogni 'tile' metri su ogni faccia,
// qualunque sia la dimensione dell'oggetto (niente texture stirate su muri e pavimenti grandi).
function worldUV(mesh, tile, tileY = tile) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const o = mesh.position;
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const x = pos[i] + o.x, y = pos[i + 1] + o.y, z = pos[i + 2] + o.z;
    const ax = Math.abs(nor[i]), ay = Math.abs(nor[i + 1]), az = Math.abs(nor[i + 2]);
    if (ay >= ax && ay >= az) { uv[j] = x / tile; uv[j + 1] = z / tile; }
    else if (ax >= az) { uv[j] = z / tile; uv[j + 1] = y / tileY; }
    else { uv[j] = x / tile; uv[j + 1] = y / tileY; }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

export class World {
  constructor(scene, mats, shadowGen, saleLabel = 'SALE', decor = {}) {
    this.saleLabel = saleLabel;
    this.decor = decor; // modelli Tripo 3D gia' caricati (mancanti = oggetti procedurali)
    this.scene = scene;
    this.mats = mats;
    this.shadowGen = shadowGen;
    this.colliders = []; // { minX, maxX, minZ, maxZ, y0, y1, tag }
    this.doors = new Map(); // id -> { mesh, collider }
    this.signs = new Map();
    this.statics = [];
    this.shelves = []; // piani delle scaffalature { minX, maxX, minZ, maxZ, h }
    this.build();
  }

  addBox(name, minX, maxX, y0, y1, minZ, maxZ, mat, { collide = true, shadow = true, receive = false, tag = '', fade = true } = {}) {
    const m = MeshBuilder.CreateBox(name, { width: maxX - minX, height: y1 - y0, depth: maxZ - minZ }, this.scene);
    m.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
    m.material = mat;
    if (mat.metadata?.tile) worldUV(m, mat.metadata.tile, mat.metadata.tileY);
    m.receiveShadows = receive;
    m.isPickable = fade && collide && y1 - y0 > 2.5; // muri alti: trasparenti se coprono la camera
    if (m.isPickable) {
      m.metadata = 'wall';
      m.wallGroup = this.group;
    }
    if (shadow && this.shadowGen) this.shadowGen.addShadowCaster(m);
    if (shadow && !m.metadata) m.metadata = { caster: true };
    this.statics.push(m);
    let col = null;
    if (collide) {
      col = { minX, maxX, minZ, maxZ, y0, y1, tag };
      this.colliders.push(col);
    }
    return { mesh: m, collider: col };
  }

  ground(name, minX, maxX, minZ, maxZ, y, mat) {
    const g = MeshBuilder.CreateGround(name, { width: maxX - minX, height: maxZ - minZ }, this.scene);
    g.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
    g.material = mat;
    if (mat.metadata?.tile) worldUV(g, mat.metadata.tile);
    g.receiveShadows = true;
    g.isPickable = false;
    this.statics.push(g);
    return g;
  }

  build() {
    const { mats } = this;
    const W = WORLD;
    // L'erba sta ben sotto il piazzale: con 1-2 cm di differenza da lontano "tremava" sopra il cemento
    const R0 = W.minX - W.roadOut, R1 = W.maxX + W.roadOut;
    this.ground('grass', R0 - 20, R1 + 20, W.minZ - 60, W.maxZ + 60, -0.15, mats.grass);
    this.ground('yardGround', W.minX, W.maxX, W.minZ, W.maxZ, -0.01, mats.concrete);
    // La strada esce dalla recinzione: da li' arrivano e se ne vanno camion e macchine
    this.ground('road', R0, R1, -W.roadHalf, W.roadHalf, 0, mats.asphalt);
    // Segnaletica stradale
    for (let x = R0 + 2; x < R1 - 2; x += 6) {
      this.addBox('dash', x, x + 3, 0.005, 0.015, -0.08, 0.08, mats.lineWhite, { collide: false, shadow: false, receive: true });
    }
    for (const z of [-W.roadHalf + 0.3, W.roadHalf - 0.3]) {
      this.addBox('edge', R0, R1, 0.005, 0.015, z - 0.08, z + 0.08, mats.lineWhite, { collide: false, shadow: false, receive: true });
    }
    // Recinzione perimetrale, aperta sulla strada
    const f = 0.15, rh = W.roadHalf;
    this.fence(W.minX, W.maxX, W.maxZ - f, W.maxZ);
    this.fence(W.minX, W.maxX, W.minZ, W.minZ + f);
    for (const x of [W.minX, W.maxX - f]) {
      this.fence(x, x + f, W.minZ, -rh);
      this.fence(x, x + f, rh, W.maxZ);
      // il muletto resta nel quartiere (ostacolo invisibile solo per lui)
      this.colliders.push({ minX: x, maxX: x + f, minZ: -rh, maxZ: rh, y0: 0, y1: 4, tag: 'edge' });
    }

    WAREHOUSES.forEach((wh) => this.buildPlot(wh));
    this.group = undefined;
    this.buildDecor();
  }

  fence(minX, maxX, minZ, maxZ) {
    const { mats } = this;
    this.addBox('fenceBase', minX, maxX, 0, 0.3, minZ, maxZ, mats.concrete, { shadow: false });
    const mesh = MeshBuilder.CreateBox('fenceMesh', { width: maxX - minX, height: 1.9, depth: Math.max(0.03, maxZ - minZ) }, this.scene);
    mesh.position.set((minX + maxX) / 2, 1.25, (minZ + maxZ) / 2);
    // Un solo materiale per tutte le recinzioni: vengono unite in un'unica mesh
    if (!mats.fenceGlass) {
      mats.fenceGlass = mats.fence.clone('fenceMat');
      mats.fenceGlass.alpha = 0.35;
    }
    mesh.material = mats.fenceGlass;
    mesh.isPickable = false;
    this.statics.push(mesh);
    this.colliders.push({ minX, maxX, minZ, maxZ, y0: 0, y1: 2.2, tag: 'fence' });
  }

  buildPlot(wh) {
    const { mats } = this;
    this.group = wh.id; // le pareti di questo magazzino verranno unite in un'unica mesh
    const B = PLOT.building;
    const D = PLOT.door;
    const t = 0.35;
    const box = (name, u0, u1, y0, y1, w0, w1, mat, opts) => {
      const r = rangeToBox(wh, u0, u1, w0, w1);
      return this.addBox(name, r.minX, r.maxX, y0, y1, r.minZ, r.maxZ, mat, opts);
    };
    // Recinzioni laterali tra i lotti
    for (const u of [-PLOT.halfWidth, PLOT.halfWidth]) {
      const r = rangeToBox(wh, u - 0.07, u + 0.07, PLOT.yard[0] + 1, 62);
      this.fence(r.minX, r.maxX, r.minZ, r.maxZ);
    }
    // Pavimento interno
    const fl = rangeToBox(wh, B.u[0], B.u[1], B.w[0], B.w[1]);
    this.ground('floor' + wh.id, fl.minX, fl.maxX, fl.minZ, fl.maxZ, 0.005, mats.floor);
    // Pareti: lamiera chiara con finestre a nastro e fascia del colore dell'azienda
    const wallMat = mats.facade(wh.company.color);
    box('wallBack', B.u[0], B.u[1], 0, B.height, B.w[1] - t, B.w[1], wallMat);
    box('wallL', B.u[0], B.u[0] + t, 0, B.height, B.w[0], B.w[1], wallMat);
    box('wallR', B.u[1] - t, B.u[1], 0, B.height, B.w[0], B.w[1], wallMat);
    box('wallFrontL', B.u[0], D.u[0], 0, B.height, B.w[0], B.w[0] + t, wallMat);
    box('wallFrontR', D.u[1], B.u[1], 0, B.height, B.w[0], B.w[0] + t, wallMat);
    box('wallFrontTop', D.u[0], D.u[1], D.height, B.height, B.w[0], B.w[0] + t, wallMat);
    box('roof', B.u[0] - 0.4, B.u[1] + 0.4, B.height, B.height + 0.35, B.w[0] - 0.4, B.w[1] + 0.4, mats.roof, { collide: false });
    // zoccolo in cemento alla base delle pareti esterne (interrotto dal portone)
    const pz = 0.09, ph = 0.75;
    const plinth = (u0, u1, w0, w1) => box('plinth', u0, u1, 0, ph, w0, w1, mats.plinth, { collide: false, shadow: false, receive: true });
    plinth(B.u[0] - pz, D.u[0] - 0.3, B.w[0] - pz, B.w[0]);
    plinth(D.u[1] + 0.3, B.u[1] + pz, B.w[0] - pz, B.w[0]);
    plinth(B.u[0] - pz, B.u[1] + pz, B.w[1], B.w[1] + pz);
    plinth(B.u[0] - pz, B.u[0], B.w[0], B.w[1]);
    plinth(B.u[1], B.u[1] + pz, B.w[0], B.w[1]);
    // grondaie sui lati lunghi e pluviali agli angoli
    for (const w of [B.w[0] - 0.42, B.w[1] + 0.25]) box('gutter', B.u[0] - 0.4, B.u[1] + 0.4, B.height - 0.12, B.height + 0.08, w, w + 0.17, mats.gutter, { collide: false, shadow: false });
    for (const u of [B.u[0] + 0.35, B.u[1] - 0.47]) {
      for (const w of [B.w[0] - 0.2, B.w[1] + 0.08]) box('downpipe', u, u + 0.12, 0.1, B.height - 0.1, w, w + 0.12, mats.gutter, { collide: false, shadow: false });
    }
    box('doorFrameL', D.u[0] - 0.3, D.u[0], 0, D.height + 0.3, B.w[0] - 0.15, B.w[0], mats.lineYellow, { collide: false });
    box('doorFrameR', D.u[1], D.u[1] + 0.3, 0, D.height + 0.3, B.w[0] - 0.15, B.w[0], mats.lineYellow, { collide: false });
    // Portone (chiuso finche' il magazzino non e' tuo)
    const door = box('door' + wh.id, D.u[0], D.u[1], 0, D.height, B.w[0], B.w[0] + 0.12, mats.doorClosed, { tag: 'door' });
    this.doors.set(wh.id, door);
    // Scaffalature sul fondo
    const R = PLOT.racks;
    const bays = Math.round((R.u[1] - R.u[0]) / R.bay);
    // lampade appese sopra la scaffalatura, sul lato del corridoio (illuminano piani e pallet)
    for (let u = R.u[0] + 1.5; u < R.u[1]; u += 4.1) {
      box('lamp', u - 0.9, u + 0.9, 5.2, 5.3, R.w[0] - 1.25, R.w[0] - 1.05, mats.light, { collide: false, shadow: false });
    }
    // montanti davanti e dietro tra una campata e l'altra (urtano muletto, forche e carico)
    for (let i = 0; i <= bays; i++) {
      const u = R.u[0] + i * R.bay;
      for (const w of [R.w[0], R.w[1] - 0.1]) box('rackPost', u - 0.05, u + 0.05, 0, R.height, w, w + 0.1, mats.rack, { tag: 'rack', shadow: false });
    }
    // correnti dei piani: davanti e dietro. Il carrello porta-forche non li urta (sta sul filo della scaffalatura)
    for (const h of R.levels.filter((y) => y > 0)) {
      for (const w of [R.w[0], R.w[1] - 0.1]) {
        const { collider } = box('rackBeam', R.u[0], R.u[1], h - R.beam, h, w, w + 0.1, mats.rackBeam, { tag: 'rack', shadow: false });
        collider.noCarriage = true;
      }
      for (let i = 0; i < bays; i++) {
        // piano d'appoggio di ogni campata (dove si posa il pallet)
        const [x0, z0] = plotToWorld(wh, R.u[0] + i * R.bay + 0.05, R.w[0]);
        const [x1, z1] = plotToWorld(wh, R.u[0] + (i + 1) * R.bay - 0.05, R.w[1]);
        this.shelves.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), h });
      }
    }
    // Zona di stoccaggio (strisce gialle a terra)
    const Z = PLOT.zone;
    const lw = 0.12;
    const zl = (u0, u1, w0, w1) => box('zoneLine', u0, u1, 0.01, 0.02, w0, w1, mats.lineYellow, { collide: false, shadow: false, receive: true });
    zl(Z.u[0], Z.u[1], Z.w[0], Z.w[0] + lw);
    zl(Z.u[0], Z.u[1], Z.w[1] - lw, Z.w[1]);
    zl(Z.u[0], Z.u[0] + lw, Z.w[0], Z.w[1]);
    zl(Z.u[1] - lw, Z.u[1], Z.w[0], Z.w[1]);
    // Controsoffitto con lucernari (sotto il tetto, visto dall'interno)
    const cl = MeshBuilder.CreatePlane('ceiling' + wh.id, { width: B.u[1] - B.u[0] - 2 * t, height: B.w[1] - B.w[0] - 2 * t, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    const [ccx, ccz] = plotToWorld(wh, 0, (B.w[0] + B.w[1]) / 2);
    cl.position.set(ccx, B.height - 0.02, ccz);
    cl.rotation.x = -Math.PI / 2; // rivolto verso il basso
    cl.material = mats.ceiling;
    cl.isPickable = false;
    this.statics.push(cl);
    // travi d'acciaio sotto il soffitto, una ogni 6 m
    for (let w = B.w[0] + 4; w < B.w[1] - 1; w += 6) {
      box('beam', B.u[0] + t, B.u[1] - t, B.height - 0.75, B.height - 0.05, w - 0.1, w + 0.1, mats.beam, { collide: false, shadow: false });
      box('beamFlange', B.u[0] + t, B.u[1] - t, B.height - 0.8, B.height - 0.72, w - 0.18, w + 0.18, mats.beam, { collide: false, shadow: false });
    }
    // corsie pedonali gialle lungo le pareti laterali
    for (const u of [B.u[0] + 1.6, B.u[1] - 1.6]) {
      const r = rangeToBox(wh, u - 0.06, u + 0.06, B.w[0] + 1, B.w[1] - 2.2);
      this.addBox('walkLine', r.minX, r.maxX, 0.01, 0.02, r.minZ, r.maxZ, mats.lineYellow, { collide: false, shadow: false, receive: true });
    }
    // cartelli di sicurezza (solo simboli) ed estintori sulle pareti laterali, rivolti verso l'interno
    const signs = [['fire', 33], ['forklift', 39], ['aid', 45], ['helmet', 51]];
    for (const [i, side] of [-1, 1].entries()) {
      for (const [kind, w] of signs) {
        const u = side < 0 ? B.u[0] + t + 0.02 : B.u[1] - t - 0.02;
        const [x, z] = plotToWorld(wh, u, w + i * 1.5);
        const p = MeshBuilder.CreatePlane('safetySign', { size: 0.7 }, this.scene);
        p.position.set(x, 2.3, z);
        p.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2; // la faccia del cartello guarda dentro il capannone
        p.material = mats.safety(kind);
        p.isPickable = false;
        this.statics.push(p);
        if (kind === 'fire') {
          const [ex, ez] = plotToWorld(wh, u - side * 0.14, w + i * 1.5);
          const e = MeshBuilder.CreateCylinder('extinguisher', { diameter: 0.18, height: 0.6, tessellation: 10 }, this.scene);
          e.position.set(ex, 0.7, ez);
          e.material = mats.extinguisher;
          e.isPickable = false;
          this.statics.push(e);
        }
      }
    }
    // Lampade a soffitto
    for (const u of [-8, 0, 8]) {
      box('lamp', u - 0.8, u + 0.8, B.height - 0.5, B.height - 0.4, 40, 41, mats.light, { collide: false, shadow: false });
    }
    // Insegna dell'azienda sopra il portone (nome, logo e numero del magazzino) e cartello vendita
    const signR = rangeToBox(wh, -4.4, 4.4, B.w[0] - 0.07, B.w[0] - 0.06);
    const sign = MeshBuilder.CreatePlane('sign' + wh.id, { width: 8.8, height: 2.2 }, this.scene);
    sign.position.set((signR.minX + signR.maxX) / 2, D.height + 1.45, (signR.minZ + signR.maxZ) / 2);
    sign.rotation.y = wh.side > 0 ? 0 : Math.PI;
    sign.material = this.mats.companySign(wh.company.name, wh.company.color, wh.id + 1);
    this.statics.push(sign);

    const [sx, sz] = plotToWorld(wh, 12, 10);
    const saleNode = new TransformNode('sale' + wh.id, this.scene);
    saleNode.position.set(sx, 0, sz);
    const post = MeshBuilder.CreateBox('salePost', { width: 0.12, height: 2.4, depth: 0.12 }, this.scene);
    post.parent = saleNode;
    post.position.y = 1.2;
    post.material = mats.steel;
    const board = MeshBuilder.CreatePlane('saleBoard', { width: 2.6, height: 1.6, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    board.parent = saleNode;
    board.position.y = 2.6;
    board.rotation.y = wh.side > 0 ? 0 : Math.PI; // testo leggibile dalla strada
    board.material = mats.sign(`${this.saleLabel}\n${wh.price.toLocaleString('it-IT')}`, '#c0392b', '#ffffff');
    this.saleBoardMeshes = this.saleBoardMeshes || [];
    this.saleBoardMeshes.push({ board, wh });
    const salePost = { minX: sx - 0.15, maxX: sx + 0.15, minZ: sz - 0.15, maxZ: sz + 0.15, y0: 0, y1: 3.4, tag: 'post' };
    this.colliders.push(salePost);
    // Cartello: anche le forche alzate ci sbattono contro
    const saleBoard = { minX: sx - 1.3, maxX: sx + 1.3, minZ: sz - 0.05, maxZ: sz + 0.05, y0: 1.8, y1: 3.4, tag: 'post' };
    this.colliders.push(saleBoard);
    this.saleBoards = this.saleBoards || new Map();
    this.saleBoards.set(wh.id, [salePost, saleBoard]);
    this.signs.set(wh.id, saleNode);
  }

  buildDecor() {
    const { mats } = this;
    // Lampioni lungo la strada
    for (const x of ROAD_LAMPS_X) {
      for (const z of [-7.6, 7.6]) {
        if (this.decor.lamp) {
          // braccio verso la strada
          this.prop('lamp', x, z, z > 0 ? LAMP_ROT : LAMP_ROT + Math.PI, { r: 0.12, h: 7, shadow: false });
          continue;
        }
        this.addBox('lampPost', x - 0.1, x + 0.1, 0, 7, z - 0.1, z + 0.1, mats.darkSteel, { shadow: false, fade: false });
        const dir = z > 0 ? -1 : 1;
        this.addBox('lampArm', x - 0.06, x + 0.06, 6.9, 7.0, Math.min(z, z + dir * 1.6), Math.max(z, z + dir * 1.6), mats.darkSteel, { shadow: false });
        this.addBox('lampHead', x - 0.25, x + 0.25, 6.75, 6.9, z + dir * 1.4 - 0.4, z + dir * 1.4 + 0.4, mats.light, { shadow: false });
      }
    }
    // Container sul retro dei lotti
    const colors = ['#1f6fb2', '#b53a2c', '#2e8b57', '#d98e04', '#6c4fa1'];
    WAREHOUSES.forEach((wh, i) => {
      const [x, z] = plotToWorld(wh, -18.5, 40);
      const c = colors[i % colors.length];
      const r = { minX: x - 1.25, maxX: x + 1.25, minZ: z - 6, maxZ: z + 6 };
      this.addBox('container', r.minX, r.maxX, 0, 2.6, r.minZ, r.maxZ, mats.container(c), { fade: false });
      if (i % 3 === 0) this.addBox('container2', r.minX, r.maxX, 2.6, 5.2, r.minZ + 0.5, r.maxZ - 0.5, mats.container(colors[(i + 2) % 5]), { fade: false });
      // Oggetti di contorno ai lati del capannone, lontano dai percorsi dei muletti
      const face = wh.side > 0 ? 0 : Math.PI;
      const at = (u, w) => plotToWorld(wh, u, w);
      this.prop('dumpster', ...at(17.6, 46), face + Math.PI / 2, { r: 0.75, h: 1.4 });
      this.prop('barrel', ...at(-17, 49.5), i * 0.7, { r: 0.32, h: 0.9 });
      this.prop('barrel', ...at(-17.7, 50.3), i * 1.3, { r: 0.32, h: 0.9 });
      this.prop('barrel', ...at(-16.9, 51.1), i * 2.1, { r: 0.32, h: 0.9 });
      this.prop('barrier', ...at(20.5, 9), face + Math.PI / 2, { r: 0.6, h: 0.8 });
      this.prop('cone', ...at(19.2, 8.2), i, { r: 0.2, h: 0.75 });
      this.prop('cone', ...at(19.2, 10.2), i + 1, { r: 0.2, h: 0.75 });
    });
  }

  // Oggetto Tripo 3D appoggiato a terra; finisce tra i fissi (uniti per materiale). r/h = ingombro per gli urti.
  prop(kind, x, z, rotY = 0, { r = 0.3, h = 1, shadow = true, collide = true } = {}) {
    const c = this.decor[kind];
    if (!c) return false;
    for (const m of placeGLB(c, kind, x, 0, z, rotY)) {
      if (shadow) {
        m.metadata = { caster: true };
        this.shadowGen?.addShadowCaster(m);
      }
      this.statics.push(m);
    }
    if (collide) this.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, y0: 0, y1: h, tag: kind });
    return true;
  }

  // Testo del cartello vendita nella lingua del gioco
  setSaleLabel(label) {
    if (label === this.saleLabel) return;
    this.saleLabel = label;
    for (const { board, wh } of this.saleBoardMeshes || []) {
      board.material = this.mats.sign(`${label}\n${wh.price.toLocaleString('it-IT')}`, '#c0392b', '#ffffff');
    }
  }

  setOwned(ids) {
    for (const [id, door] of this.doors) {
      const owned = ids.includes(id);
      door.mesh.setEnabled(!owned);
      door.collider.y1 = owned ? -1 : PLOT.door.height; // y1 negativo = collisione disattivata
      this.signs.get(id).setEnabled(!owned);
      for (const c of this.saleBoards?.get(id) || []) c.y1 = owned ? -1 : 3.4;
    }
  }

  // Unisce gli oggetti fissi non interattivi con lo stesso materiale: molte meno chiamate di disegno.
  // Restano separati muri (trasparenza e camera), portoni e insegne.
  freezeStatics() {
    const keep = new Set([...this.doors.values()].map((d) => d.mesh));
    const groups = new Map();
    for (const m of this.statics) {
      if (m.isDisposed() || m.isPickable || keep.has(m) || !m.material || m.parent) continue;
      if (!groups.has(m.material)) groups.set(m.material, []);
      groups.get(m.material).push(m);
    }
    // Pareti alte (che diventano trasparenti davanti alla camera): unite per magazzino e materiale
    const walls = new Map();
    for (const m of this.statics) {
      if (m.isDisposed() || m.metadata !== 'wall' || keep.has(m) || m.wallGroup === undefined) continue;
      const k = `${m.wallGroup}|${m.material.uniqueId}`;
      if (!walls.has(k)) walls.set(k, []);
      walls.get(k).push(m);
    }
    for (const list of walls.values()) {
      if (list.length < 2) continue;
      const mat = list[0].material;
      const out = Mesh.MergeMeshes(list, true, true);
      if (!out) continue;
      out.material = mat;
      out.isPickable = true;
      out.metadata = 'wall';
      this.shadowGen?.addShadowCaster(out);
      this.statics.push(out);
    }
    const merged = [];
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const caster = list.some((m) => m.metadata?.caster);
      const receive = list.some((m) => m.receiveShadows);
      const out = Mesh.MergeMeshes(list, true, true);
      if (!out) continue;
      out.material = mat;
      out.isPickable = false;
      out.receiveShadows = receive;
      if (caster) {
        out.metadata = { caster: true };
        this.shadowGen?.addShadowCaster(out);
      }
      merged.push(out);
    }
    this.statics = this.statics.filter((m) => !m.isDisposed()).concat(merged);
    for (const m of this.statics) m.freezeWorldMatrix();
  }
}
