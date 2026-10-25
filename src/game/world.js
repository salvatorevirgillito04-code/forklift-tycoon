import { MeshBuilder, Vector3, TransformNode, Mesh, VertexBuffer } from '@babylonjs/core';
import { WAREHOUSES, WORLD } from '../data.js';

// Geometria di un lotto in coordinate locali (u lungo X, w = distanza dalla strada).
export const PLOT = {
  halfWidth: 22,
  yard: [8, 30],
  building: { u: [-15, 15], w: [30, 56], height: 9 },
  door: { u: [-3.5, 3.5], height: 5.5 },
  truck: { u: -3, w: 16 }, // centro del pianale
  zone: { u: [-6, 6], w: [35.5, 44.5] },
  racks: { u: [-13, 13], w: [52.5, 55.5], height: 6.5 },
};

export const plotToWorld = (wh, u, w) => [wh.cx + u, wh.side * w];

function rangeToBox(wh, u0, u1, w0, w1) {
  const [x0, z0] = plotToWorld(wh, u0, w0);
  const [x1, z1] = plotToWorld(wh, u1, w1);
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
}

export function zoneRect(wh) {
  return rangeToBox(wh, PLOT.zone.u[0], PLOT.zone.u[1], PLOT.zone.w[0], PLOT.zone.w[1]);
}

// UV calcolati dalle coordinate del mondo: la texture si ripete ogni 'tile' metri su ogni faccia,
// qualunque sia la dimensione dell'oggetto (niente texture stirate su muri e pavimenti grandi).
function worldUV(mesh, tile) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const o = mesh.position;
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const x = pos[i] + o.x, y = pos[i + 1] + o.y, z = pos[i + 2] + o.z;
    const ax = Math.abs(nor[i]), ay = Math.abs(nor[i + 1]), az = Math.abs(nor[i + 2]);
    if (ay >= ax && ay >= az) { uv[j] = x / tile; uv[j + 1] = z / tile; }
    else if (ax >= az) { uv[j] = z / tile; uv[j + 1] = y / tile; }
    else { uv[j] = x / tile; uv[j + 1] = y / tile; }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

export class World {
  constructor(scene, mats, shadowGen, saleLabel = 'SALE') {
    this.saleLabel = saleLabel;
    this.scene = scene;
    this.mats = mats;
    this.shadowGen = shadowGen;
    this.colliders = []; // { minX, maxX, minZ, maxZ, y0, y1, tag }
    this.doors = new Map(); // id -> { mesh, collider }
    this.signs = new Map();
    this.statics = [];
    this.build();
  }

  addBox(name, minX, maxX, y0, y1, minZ, maxZ, mat, { collide = true, shadow = true, receive = false, tag = '' } = {}) {
    const m = MeshBuilder.CreateBox(name, { width: maxX - minX, height: y1 - y0, depth: maxZ - minZ }, this.scene);
    m.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
    m.material = mat;
    if (mat.metadata?.tile) worldUV(m, mat.metadata.tile);
    m.receiveShadows = receive;
    m.isPickable = collide && y1 - y0 > 2.5;
    if (m.isPickable) m.metadata = 'wall';
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
    this.ground('grass', W.minX - 60, W.maxX + 60, W.minZ - 60, W.maxZ + 60, -0.15, mats.grass);
    this.ground('yardGround', W.minX, W.maxX, W.minZ, W.maxZ, -0.01, mats.concrete);
    this.ground('road', W.minX, W.maxX, -W.roadHalf, W.roadHalf, 0, mats.asphalt);
    // Segnaletica stradale
    for (let x = W.minX + 2; x < W.maxX - 2; x += 6) {
      this.addBox('dash', x, x + 3, 0.005, 0.015, -0.08, 0.08, mats.lineWhite, { collide: false, shadow: false, receive: true });
    }
    for (const z of [-W.roadHalf + 0.3, W.roadHalf - 0.3]) {
      this.addBox('edge', W.minX, W.maxX, 0.005, 0.015, z - 0.08, z + 0.08, mats.lineWhite, { collide: false, shadow: false, receive: true });
    }
    // Recinzione perimetrale
    const f = 0.15;
    this.fence(W.minX, W.maxX, W.maxZ - f, W.maxZ);
    this.fence(W.minX, W.maxX, W.minZ, W.minZ + f);
    this.fence(W.minX, W.minX + f, W.minZ, W.maxZ);
    this.fence(W.maxX - f, W.maxX, W.minZ, W.maxZ);

    WAREHOUSES.forEach((wh) => this.buildPlot(wh));
    this.buildDecor();
  }

  fence(minX, maxX, minZ, maxZ) {
    const { mats } = this;
    this.addBox('fenceBase', minX, maxX, 0, 0.3, minZ, maxZ, mats.concrete, { shadow: false });
    const mesh = MeshBuilder.CreateBox('fenceMesh', { width: maxX - minX, height: 1.9, depth: Math.max(0.03, maxZ - minZ) }, this.scene);
    mesh.position.set((minX + maxX) / 2, 1.25, (minZ + maxZ) / 2);
    const mat = mats.fence.clone('fenceMat');
    mat.alpha = 0.35;
    mesh.material = mat;
    this.statics.push(mesh);
    this.colliders.push({ minX, maxX, minZ, maxZ, y0: 0, y1: 2.2, tag: 'fence' });
  }

  buildPlot(wh) {
    const { mats } = this;
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
    // Pareti
    box('wallBack', B.u[0], B.u[1], 0, B.height, B.w[1] - t, B.w[1], mats.metalWall);
    box('wallL', B.u[0], B.u[0] + t, 0, B.height, B.w[0], B.w[1], mats.metalWall);
    box('wallR', B.u[1] - t, B.u[1], 0, B.height, B.w[0], B.w[1], mats.metalWall);
    box('wallFrontL', B.u[0], D.u[0], 0, B.height, B.w[0], B.w[0] + t, mats.metalWall);
    box('wallFrontR', D.u[1], B.u[1], 0, B.height, B.w[0], B.w[0] + t, mats.metalWall);
    box('wallFrontTop', D.u[0], D.u[1], D.height, B.height, B.w[0], B.w[0] + t, mats.metalWall);
    box('roof', B.u[0] - 0.4, B.u[1] + 0.4, B.height, B.height + 0.35, B.w[0] - 0.4, B.w[1] + 0.4, mats.roof, { collide: false });
    box('trimTop', B.u[0] - 0.45, B.u[1] + 0.45, B.height - 0.6, B.height, B.w[0] - 0.45, B.w[0] - 0.05, mats.trim, { collide: false });
    box('doorFrameL', D.u[0] - 0.3, D.u[0], 0, D.height + 0.3, B.w[0] - 0.15, B.w[0], mats.lineYellow, { collide: false });
    box('doorFrameR', D.u[1], D.u[1] + 0.3, 0, D.height + 0.3, B.w[0] - 0.15, B.w[0], mats.lineYellow, { collide: false });
    // Portone (chiuso finche' il magazzino non e' tuo)
    const door = box('door' + wh.id, D.u[0], D.u[1], 0, D.height, B.w[0], B.w[0] + 0.12, mats.doorClosed, { tag: 'door' });
    this.doors.set(wh.id, door);
    // Scaffalature sul fondo
    const R = PLOT.racks;
    box('rackBlock', R.u[0], R.u[1], 0, R.height, R.w[0], R.w[1], mats.darkInterior, { shadow: false });
    for (let u = R.u[0]; u <= R.u[1]; u += 2.6) {
      box('rackPost', u, u + 0.12, 0, R.height, R.w[0] - 0.1, R.w[0], mats.rack, { collide: false, shadow: false });
    }
    for (const y of [0.15, 2.1, 4.1, 6.0]) {
      box('rackBeam', R.u[0], R.u[1], y, y + 0.14, R.w[0] - 0.12, R.w[0], mats.rackBeam, { collide: false, shadow: false });
    }
    // Zona di stoccaggio (strisce gialle a terra)
    const Z = PLOT.zone;
    const lw = 0.12;
    const zl = (u0, u1, w0, w1) => box('zoneLine', u0, u1, 0.01, 0.02, w0, w1, mats.lineYellow, { collide: false, shadow: false, receive: true });
    zl(Z.u[0], Z.u[1], Z.w[0], Z.w[0] + lw);
    zl(Z.u[0], Z.u[1], Z.w[1] - lw, Z.w[1]);
    zl(Z.u[0], Z.u[0] + lw, Z.w[0], Z.w[1]);
    zl(Z.u[1] - lw, Z.u[1], Z.w[0], Z.w[1]);
    // Lampade a soffitto
    for (const u of [-8, 0, 8]) {
      box('lamp', u - 0.8, u + 0.8, B.height - 0.5, B.height - 0.4, 40, 41, mats.light, { collide: false, shadow: false });
    }
    // Insegna con numero e cartello vendita
    const signR = rangeToBox(wh, -2.5, 2.5, B.w[0] - 0.5, B.w[0] - 0.42);
    const sign = MeshBuilder.CreatePlane('sign' + wh.id, { width: 5, height: 1.6 }, this.scene);
    sign.position.set((signR.minX + signR.maxX) / 2, D.height + 1.8, (signR.minZ + signR.maxZ) / 2);
    sign.rotation.y = wh.side > 0 ? 0 : Math.PI;
    sign.material = this.mats.sign(`${wh.id + 1}`, '#1d3f66', '#ffffff');
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
    for (let x = WORLD.minX + 10; x < WORLD.maxX; x += 22) {
      for (const z of [-7.6, 7.6]) {
        this.addBox('lampPost', x - 0.1, x + 0.1, 0, 7, z - 0.1, z + 0.1, mats.darkSteel, { shadow: false });
        const dir = z > 0 ? -1 : 1;
        this.addBox('lampArm', x - 0.06, x + 0.06, 6.9, 7.0, Math.min(z, z + dir * 1.6), Math.max(z, z + dir * 1.6), mats.darkSteel, { shadow: false });
        this.addBox('lampHead', x - 0.25, x + 0.25, 6.75, 6.9, z + dir * 1.4 - 0.4, z + dir * 1.4 + 0.4, mats.light, { shadow: false });
      }
    }
    // Container e alberi sul retro dei lotti
    const colors = ['#1f6fb2', '#b53a2c', '#2e8b57', '#d98e04', '#6c4fa1'];
    WAREHOUSES.forEach((wh, i) => {
      const [x, z] = plotToWorld(wh, -18.5, 40);
      const c = colors[i % colors.length];
      const r = { minX: x - 1.25, maxX: x + 1.25, minZ: z - 6, maxZ: z + 6 };
      this.addBox('container', r.minX, r.maxX, 0, 2.6, r.minZ, r.maxZ, mats.container(c));
      if (i % 3 === 0) this.addBox('container2', r.minX, r.maxX, 2.6, 5.2, r.minZ + 0.5, r.maxZ - 0.5, mats.container(colors[(i + 2) % 5]));
      const [tx, tz] = plotToWorld(wh, 18, 60);
      this.tree(tx, tz);
    });
    for (let x = WORLD.minX - 8; x < WORLD.maxX + 10; x += 14) {
      this.tree(x, WORLD.maxZ + 8 + (x % 3));
      this.tree(x + 5, WORLD.minZ - 9 - (x % 4));
    }
  }

  tree(x, z) {
    const trunk = MeshBuilder.CreateCylinder('trunk', { diameterTop: 0.25, diameterBottom: 0.4, height: 3, tessellation: 8 }, this.scene);
    trunk.position.set(x, 1.5, z);
    trunk.material = this.mats.bark;
    const crown = MeshBuilder.CreateSphere('crown', { diameter: 4.2, segments: 6 }, this.scene);
    crown.position.set(x, 4.4, z);
    crown.scaling.y = 1.2;
    crown.material = this.mats.leaves;
    if (this.shadowGen) this.shadowGen.addShadowCaster(crown);
    crown.metadata = { caster: true };
    trunk.isPickable = false;
    crown.isPickable = false;
    this.statics.push(trunk, crown);
    this.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, y0: 0, y1: 3, tag: 'tree' });
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
