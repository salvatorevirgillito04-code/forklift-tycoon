import { MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import { Forklift } from './forklift.js';
import { createPalletModel, createTruckModel, mergeByMaterial, PALLET, TRUCK } from './models.js';
import { plotToWorld } from './world.js';
import { rectsOverlap, toWorld, wrapAngle } from './physics.js';
import { WAREHOUSES, vehicleById } from '../data.js';

// Muletti degli operai al lavoro. Solo i 3 piu' vicini al giocatore, per non pesare sul telefono.
// Nel piazzale ogni operaio ha il suo camion: lo carica o lo scarica, il camion riparte e ne arriva un altro.
// Dentro il capannone gli operai riordinano due pile di pallet.
const MAX_BOTS = 3;
const VIEW_DIST = 75;
const LOAD_H = 0.7;
const PALLET_H = PALLET.height + LOAD_H;
const POCKET = 0.045; // forche dentro le tasche del pallet, sopra il fondo
const TRAVEL_Y = 0.15; // altezza forche in viaggio
const CLEAR = 0.12; // forche alzate sopra l'appoggio prima di entrare/uscire
const LIFT_SPEED = 0.45;
const LIFT_ACC = 0.9; // accelerazione delle forche (m/s^2)
const V_FWD = 2.0;
const V_REV = 1.3;
const ACC = 0.9; // accelerazione del muletto (m/s^2)
const DEC = 1.3; // frenata dolce
const STEER_RATE = 1.6; // velocita' massima di rotazione delle ruote sterzanti (rad/s)
const TRUCK_ACC = 1.0;
const BACK_OFF = 3.2;

// Piazzale: camion lungo w con la cabina verso la strada, pallet a terra in fila davanti al camion.
const TRUCK_AREA = {
  truckU: 20.1, // centro del pianale (u)
  bedW: 18.9, // centro del pianale (w)
  bedU: 19.45, // centro dei pallet sul pianale, vicino al bordo dal lato del muletto
  groundU: 12.0, // fila dei pallet a terra
  slotsW: [15.0, 17.6, 20.2, 22.8],
  mid: { u: 15.6, w: 11.6 }, // punto di manovra, muso verso il capannone
  away: -16, // spostamento del camion quando e' fuori (sulla strada)
};
const AREAS = [
  { type: 'truck', n: 1 },
  { type: 'truck', n: -1 },
  { type: 'stacks', u: 14.0, n: 1, wA: 34, wB: 48 },
  { type: 'stacks', u: -14.0, n: -1, wA: 34, wB: 48 },
];

const easeStep = (cur, goal, maxStep) => cur + Math.sign(goal - cur) * Math.min(maxStep, Math.abs(goal - cur));

// Curva di Bezier: tabella distanza -> parametro t, poi posizione e direzione calcolate esatte (niente spigoli).
function bezierPath(p0, p1, p2, p3, n = 96) {
  const P = [p0, p1, p2, p3];
  const pos = (t) => {
    const a = 1 - t;
    const w = [a * a * a, 3 * a * a * t, 3 * a * t * t, t * t * t];
    return [0, 1].map((k) => w[0] * P[0][k] + w[1] * P[1][k] + w[2] * P[2][k] + w[3] * P[3][k]);
  };
  const tbl = [{ t: 0, s: 0 }];
  let prev = pos(0), len = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, q = pos(t);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    tbl.push({ t, s: len });
    prev = q;
  }
  return { P, pos, tbl, len };
}

function pointAt(path, s) {
  const { tbl, P } = path;
  s = Math.max(0, Math.min(path.len, s));
  let i = 1;
  while (i < tbl.length - 1 && tbl[i].s < s) i++;
  const a = tbl[i - 1], b = tbl[i];
  const t = a.t + (b.t - a.t) * (b.s > a.s ? (s - a.s) / (b.s - a.s) : 0);
  const [x, z] = path.pos(t);
  // Derivata della Bezier: direzione del moto (agli estremi di un tratto dritto e' nulla: si usa la corda)
  const u = 1 - t;
  let dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
  let dz = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
  if (Math.hypot(dx, dz) < 1e-6) { dx = P[3][0] - P[0][0]; dz = P[3][1] - P[0][1]; }
  return { x, z, dx, dz, h: Math.atan2(dx, dz) };
}

// Scatola allineata agli assi che contiene dei rettangoli orientati.
function aabbOf(rects) {
  const r = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const s of rects) {
    const ex = Math.abs(Math.cos(s.yaw)) * s.hw + Math.abs(Math.sin(s.yaw)) * s.hd;
    const ez = Math.abs(Math.sin(s.yaw)) * s.hw + Math.abs(Math.cos(s.yaw)) * s.hd;
    r.minX = Math.min(r.minX, s.x - ex);
    r.maxX = Math.max(r.maxX, s.x + ex);
    r.minZ = Math.min(r.minZ, s.z - ez);
    r.maxZ = Math.max(r.maxZ, s.z + ez);
  }
  return r;
}

const aabbRect = (b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2, yaw: 0 });

export class WorkerBots {
  constructor(scene, mats, env) {
    this.scene = scene;
    this.mats = mats;
    this.env = env;
    this.workers = [];
    this.bots = new Map(); // id operaio -> bot
    this.pickTimer = 0;
    this.shadowGen = null;
  }

  setWorkers(workers) {
    this.workers = workers || [];
    this.pickTimer = 0;
  }

  areaOf(worker) {
    const wh = WAREHOUSES[worker.warehouse];
    const idx = this.workers.filter((w) => w.warehouse === worker.warehouse).indexOf(worker);
    return { wh, area: AREAS[idx % AREAS.length] };
  }

  update(dt, player) {
    this.pickTimer -= dt;
    if (this.pickTimer <= 0) {
      this.pickTimer = 0.5;
      this.pick(player);
    }
    for (const bot of this.bots.values()) {
      if (!bot.ready) continue;
      if (this.pickTimer === 0.5) this.lod(bot, player);
      if (bot.truck) this.driveTruck(bot, dt, player);
      this.work(bot, dt, player);
    }
  }

  // Oltre 25 m i pezzi piccoli (ruote, volante, autista, griglia...) non si notano: spenti
  lod(bot, player) {
    const far = Math.hypot(bot.f.x - player.x, bot.f.z - player.z) > 25;
    if (far === bot.far) return;
    bot.far = far;
    bot.small ||= bot.f.model.root.getChildMeshes().filter((m) => m.getBoundingInfo().boundingSphere.radius < 0.45);
    for (const m of bot.small) m.setEnabled(!far);
  }

  // Sceglie gli operai piu' vicini e crea/rimuove i loro muletti.
  pick(player) {
    const near = this.workers
      .map((w) => {
        const { wh, area } = this.areaOf(w);
        const [x, z] = area.type === 'truck' ? plotToWorld(wh, area.n * 16, 18) : plotToWorld(wh, area.u, (area.wA + area.wB) / 2);
        return { w, d: Math.hypot(x - player.x, z - player.z) };
      })
      .filter((e) => e.d < VIEW_DIST)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_BOTS);
    const keep = new Set(near.map((e) => e.w.id));
    for (const [id, bot] of this.bots) {
      const w = this.workers.find((x) => x.id === id);
      if (!keep.has(id) || !w || w.vehicle !== bot.vehicleId || w.warehouse !== bot.warehouse) this.remove(id);
    }
    for (const { w } of near) if (!this.bots.has(w.id)) this.spawn(w);
  }

  // Punto di appoggio dei pallet: centro, direzione da cui il muletto entra, quota, pila e punto di manovra.
  makeSlot(wh, u, w, faceN, base, cap, mid) {
    const [x, z] = plotToWorld(wh, u, w);
    const [dx, dz] = plotToWorld(wh, u + faceN, w);
    const slot = {
      x, z, yaw: Math.atan2(dx - x, dz - z), base, cap, stack: [], mid,
      collider: { minX: x - 0.62, maxX: x + 0.62, minZ: z - 0.62, maxZ: z + 0.62, y0: base, y1: -1, tag: 'botPallet' },
    };
    if (!slot.mid) {
      // Pile: si esce in retromarcia dritti
      const hx = Math.sin(slot.yaw), hz = Math.cos(slot.yaw);
      slot.midOff = BACK_OFF;
      slot.mid = { x: x - hx * BACK_OFF, z: z - hz * BACK_OFF, yaw: slot.yaw, fromCenter: true };
    }
    return slot;
  }

  spawn(worker) {
    const { wh, area } = this.areaOf(worker);
    const f = new Forklift(this.scene, this.mats, vehicleById(worker.vehicle));
    const bot = {
      f, wh, area, vehicleId: worker.vehicle, warehouse: worker.warehouse, ready: false,
      slots: [], carried: null, task: null, path: null, s: 0, wait: 0, steer: 0, v: 0, liftV: 0,
      collider: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: -1, tag: 'bot' },
    };
    let palletCount;
    if (area.type === 'truck') {
      const T = TRUCK_AREA, n = area.n;
      const [mx, mz] = plotToWorld(wh, n * T.mid.u, T.mid.w);
      const [mx2, mz2] = plotToWorld(wh, n * T.mid.u, T.mid.w + 1);
      const mid = { x: mx, z: mz, yaw: Math.atan2(mx2 - mx, mz2 - mz) };
      bot.ground = T.slotsW.map((w) => this.makeSlot(wh, n * T.groundU, w, -n, 0, 1, mid));
      bot.bed = T.slotsW.map((w) => this.makeSlot(wh, n * T.bedU, w, n, TRUCK.bedHeight, 1, mid));
      bot.slots = [...bot.ground, ...bot.bed];
      bot.mode = 'load';
      palletCount = bot.ground.length;
    } else {
      bot.stacks = [this.makeSlot(wh, area.u, area.wA, area.n, 0, 2), this.makeSlot(wh, area.u, area.wB, area.n, 0, 2)];
      bot.slots = bot.stacks;
      bot.from = 0;
      palletCount = 2;
    }
    this.bots.set(worker.id, bot);
    this.env.colliders.push(bot.collider, ...bot.slots.map((s) => s.collider));

    const build = async () => {
      await f.build(this.shadowGen);
      const pallets = [];
      for (let i = 0; i < palletCount; i++) pallets.push(await createPalletModel(this.scene, this.mats, { loadHeight: LOAD_H }));
      const truck = area.type === 'truck' ? await createTruckModel(this.scene, this.mats, '#2f6fb0') : null;
      if (this.bots.get(worker.id) !== bot) {
        f.dispose();
        pallets.forEach((p) => p.dispose());
        truck?.dispose();
        return;
      }
      const shadow = (node) => node.getChildMeshes().forEach((m) => { this.shadowGen?.addShadowCaster(m); m.receiveShadows = true; });
      pallets.forEach(shadow);
      if (truck) {
        shadow(truck);
        this.setupTruck(bot, truck);
        bot.ground.forEach((s, i) => s.stack.push(pallets[i]));
      } else {
        bot.stacks[0].stack.push(...pallets);
      }
      bot.slots.forEach((s) => this.laySlot(s));
      f.tilt = 0.03;
      f.forkY = TRAVEL_Y;
      this.addDriver(f, worker.avatar);
      const start = bot.slots[0].mid;
      f.x = start.x;
      f.z = start.z;
      f.yaw = start.yaw;
      bot.ready = true;
      this.idle(bot);
      this.place(bot);
    };
    build();
  }

  // ---------- Camion ----------
  setupTruck(bot, root) {
    const T = TRUCK_AREA, wh = bot.wh, n = bot.area.n;
    const [x, z] = plotToWorld(wh, n * T.truckU, T.bedW);
    // Cabina verso la strada: l'asse lungo del camion (x locale, cabina sul +x) punta verso -w
    root.rotation.y = wh.side * Math.PI / 2;
    const dir = { x: 0, z: -wh.side }; // verso la strada
    bot.truck = {
      root, home: { x, z }, dir, offset: T.away, state: 'arriving', wait: 1.5,
      bedCol: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: TRUCK.bedHeight, tag: 'truck' },
      cabCol: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 4, tag: 'truck' },
    };
    this.env.colliders.push(bot.truck.bedCol, bot.truck.cabCol);
    this.placeTruck(bot);
  }

  // Posizione del camion: offset 0 = fermo al suo posto, negativo = verso la strada.
  truckBoxes(bot, offset) {
    const tr = bot.truck;
    const cx = tr.home.x - tr.dir.x * offset, cz = tr.home.z - tr.dir.z * offset;
    const L = TRUCK.bedLength, W = TRUCK.bedWidth;
    // lungo l'asse del camion: pianale da -L/2 a +L/2, cabina fino a +L/2 + 4 (verso la strada)
    const along = (a0, a1) => {
      const p0 = { x: cx + tr.dir.x * a0, z: cz + tr.dir.z * a0 };
      const p1 = { x: cx + tr.dir.x * a1, z: cz + tr.dir.z * a1 };
      return {
        minX: Math.min(p0.x, p1.x) - (tr.dir.x ? 0 : W / 2), maxX: Math.max(p0.x, p1.x) + (tr.dir.x ? 0 : W / 2),
        minZ: Math.min(p0.z, p1.z) - (tr.dir.z ? 0 : W / 2), maxZ: Math.max(p0.z, p1.z) + (tr.dir.z ? 0 : W / 2),
      };
    };
    return { cx, cz, bed: along(-L / 2, L / 2), cab: along(L / 2, L / 2 + 4) };
  }

  placeTruck(bot) {
    const tr = bot.truck;
    const b = this.truckBoxes(bot, tr.offset);
    tr.root.position.set(b.cx, 0, b.cz);
    const hidden = tr.offset <= TRUCK_AREA.away + 0.01;
    Object.assign(tr.bedCol, b.bed, { y1: hidden ? -1 : TRUCK.bedHeight });
    Object.assign(tr.cabCol, b.cab, { y1: hidden ? -1 : 4 });
    // Pallet sul pianale: seguono il camion
    const dx = -tr.dir.x * tr.offset, dz = -tr.dir.z * tr.offset;
    for (const s of bot.bed) {
      s.stack.forEach((node) => node.position.set(s.x + dx, s.base, s.z + dz));
      Object.assign(s.collider, { minX: s.x + dx - 0.62, maxX: s.x + dx + 0.62, minZ: s.z + dz - 0.62, maxZ: s.z + dz + 0.62 });
      s.collider.y1 = s.stack.length && !hidden ? s.base + PALLET_H : -1;
    }
    // Entra e esce dalla strada sfumando
    const vis = Math.min(1, Math.max(0, (tr.offset - TRUCK_AREA.away) / 4));
    const meshes = [...tr.root.getChildMeshes(), ...bot.bed.flatMap((s) => s.stack.flatMap((n) => n.getChildMeshes()))];
    for (const m of meshes) m.visibility = vis;
    tr.root.setEnabled(vis > 0);
    bot.bed.forEach((s) => s.stack.forEach((node) => node.setEnabled(vis > 0)));
  }

  // Arriva in retromarcia, aspetta il carico/scarico, riparte verso la strada.
  driveTruck(bot, dt, player) {
    const tr = bot.truck;
    if (tr.state === 'arriving' || tr.state === 'leaving') {
      if (tr.wait > 0) { tr.wait -= dt; return; }
      const goal = tr.state === 'arriving' ? 0 : TRUCK_AREA.away;
      const dist = Math.abs(goal - tr.offset);
      const want = Math.max(0.15, Math.min(3.5, Math.sqrt(2 * TRUCK_ACC * dist)));
      tr.v = easeStep(tr.v || 0, want, TRUCK_ACC * dt);
      const next = easeStep(tr.offset, goal, tr.v * dt);
      const b = this.truckBoxes(bot, next);
      // Non investe il giocatore
      if (player && tr.offset > TRUCK_AREA.away + 1) {
        const mine = [aabbRect(b.bed), aabbRect(b.cab)];
        const his = [player.bodyRect(), ...player.forkRects()];
        if (mine.some((m) => his.some((o) => rectsOverlap(m, o, 0.4)))) {
          tr.v = 0;
          return;
        }
      }
      tr.offset = next;
      this.placeTruck(bot);
      if (Math.abs(tr.offset - goal) < 1e-3) {
        tr.v = 0;
        if (tr.state === 'arriving') tr.state = 'parked';
        else {
          // Fuori: il prossimo camion fa il contratto opposto (quello caricato torna pieno da scaricare)
          bot.mode = bot.mode === 'load' ? 'unload' : 'load';
          tr.state = 'arriving';
          tr.wait = 3;
        }
      }
    }
  }

  // ---------- Operaio ----------
  addDriver(f, a = {}) {
    const { scene, mats } = this;
    const [ex, ey, ez] = f.geo.eye;
    const d = new TransformNode('driver', scene);
    d.parent = f.model.root;
    d.position = new Vector3(ex, ey, ez);
    const part = (mesh, mat, x, y, z) => {
      mesh.parent = d;
      mesh.position.set(x, y, z);
      mesh.material = mat;
      this.shadowGen?.addShadowCaster(mesh);
      return mesh;
    };
    const vest = mats.paint('#f08a24');
    part(MeshBuilder.CreateBox('torso', { width: 0.42, height: 0.52, depth: 0.26 }, scene), vest, 0, -0.42, -0.02);
    for (const s of [-1, 1]) {
      const arm = part(MeshBuilder.CreateBox('arm', { width: 0.1, height: 0.1, depth: 0.42 }, scene), vest, s * 0.25, -0.38, 0.17);
      arm.rotation.x = 0.35;
    }
    part(MeshBuilder.CreateBox('legs', { width: 0.38, height: 0.14, depth: 0.42 }, scene), mats.paint('#2c3e66'), 0, -0.74, 0.16);
    part(MeshBuilder.CreateSphere('head', { diameter: 0.24, segments: 8 }, scene), mats.paint(a.skin || '#e8b892'), 0, -0.04, 0);
    const helmet = part(MeshBuilder.CreateSphere('helmet', { diameter: 0.28, segments: 8, slice: 0.5 }, scene), mats.paint(a.helmet || '#f2c200'), 0, 0.0, 0);
    helmet.scaling.y = 0.85;
    mergeByMaterial(d.getChildMeshes(), d, 'driver').forEach((m) => this.shadowGen?.addShadowCaster(m));
  }

  remove(id) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.f.dispose();
    bot.carried?.dispose();
    for (const s of bot.slots) s.stack.forEach((n) => n.dispose());
    const cols = [bot.collider, ...bot.slots.map((s) => s.collider)];
    if (bot.truck) {
      bot.truck.root.dispose();
      cols.push(bot.truck.bedCol, bot.truck.cabCol);
    }
    for (const c of cols) {
      const i = this.env.colliders.indexOf(c);
      if (i >= 0) this.env.colliders.splice(i, 1);
    }
    this.bots.delete(id);
  }

  clear() {
    for (const id of [...this.bots.keys()]) this.remove(id);
  }

  // Pallet fermi in un punto di appoggio (pila) e loro ingombro.
  laySlot(slot) {
    slot.stack.forEach((node, i) => {
      node.position.set(slot.x, slot.base + i * PALLET_H, slot.z);
      node.rotation.set(0, slot.yaw, 0);
    });
    slot.collider.y1 = slot.stack.length ? slot.base + slot.stack.length * PALLET_H : -1;
  }

  reach(bot) {
    return bot.f.geo.forkBase + PALLET.size / 2 + 0.02;
  }

  // Muletto con le forche dentro il pallet di questo punto
  pickPose(bot, slot) {
    const r = this.reach(bot);
    return { x: slot.x - Math.sin(slot.yaw) * r, z: slot.z - Math.cos(slot.yaw) * r, yaw: slot.yaw };
  }

  midPose(bot, slot) {
    if (!slot.mid.fromCenter) return slot.mid;
    const r = this.reach(bot) + BACK_OFF;
    return { x: slot.x - Math.sin(slot.yaw) * r, z: slot.z - Math.cos(slot.yaw) * r, yaw: slot.yaw };
  }

  // Prossimo lavoro: nel piazzale da terra al camion (carico) o dal camion a terra (scarico); dentro, tra le pile.
  idle(bot) {
    bot.task = { step: 'wait' };
    bot.path = null;
  }

  chooseMove(bot) {
    if (bot.truck) {
      if (bot.truck.state !== 'parked') return null;
      const [src, dst] = bot.mode === 'load' ? [bot.ground, bot.bed] : [bot.bed, bot.ground];
      const from = src.find((s) => s.stack.length);
      const to = [...dst].reverse().find((s) => s.stack.length < s.cap);
      if (!from || !to) {
        // Contratto finito: il camion riparte
        bot.truck.state = 'leaving';
        bot.truck.wait = 1;
        return null;
      }
      return { from, to };
    }
    if (!bot.stacks[bot.from].stack.length) bot.from = 1 - bot.from;
    return { from: bot.stacks[bot.from], to: bot.stacks[1 - bot.from] };
  }

  startLeg(bot, step, slot, height) {
    bot.task = { ...bot.task, step, spot: slot, height };
    bot.path = this.forwardPath(bot, this.pickPose(bot, slot));
    bot.s = 0;
  }

  // In avanti fino a una posa: curva a S che arriva dritta davanti al pallet.
  forwardPath(bot, end) {
    const f = bot.f;
    const hx = Math.sin(f.yaw), hz = Math.cos(f.yaw);
    const ex = Math.sin(end.yaw), ez = Math.cos(end.yaw);
    const d = Math.hypot(end.x - f.x, end.z - f.z);
    const c = Math.min(4.5, Math.max(1.2, d * 0.5));
    return bezierPath([f.x, f.z], [f.x + hx * c, f.z + hz * c], [end.x - ex * c, end.z - ez * c], [end.x, end.z]);
  }

  // In retromarcia fino a una posa (la parte posteriore va avanti per prima).
  reversePath(bot, end) {
    const f = bot.f;
    const hx = Math.sin(f.yaw), hz = Math.cos(f.yaw);
    const ex = Math.sin(end.yaw), ez = Math.cos(end.yaw);
    const d = Math.hypot(end.x - f.x, end.z - f.z);
    const c = Math.min(3.5, Math.max(0.8, d * 0.45));
    return bezierPath([f.x, f.z], [f.x - hx * c, f.z - hz * c], [end.x + ex * c, end.z + ez * c], [end.x, end.z]);
  }

  syncCarried(bot) {
    const { f, carried } = bot;
    if (!carried) return;
    const [x, z] = toWorld(f.frame, 0, this.reach(bot));
    carried.position.set(x, f.forkY - POCKET, z);
    carried.rotation.set(0, f.yaw, 0);
  }

  shapes(bot, x, z, yaw) {
    const f = bot.f;
    const list = [f.bodyRect(x, z, yaw), ...f.forkRects(x, z, yaw)];
    if (bot.carried) {
      const [cx, cz] = toWorld({ x, z, yaw }, 0, this.reach(bot));
      list.push({ x: cx, z: cz, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw });
    }
    return list;
  }

  blocked(bot, x, z, yaw, player) {
    const mine = this.shapes(bot, x, z, yaw);
    mine.push(aabbRect(aabbOf(mine))); // la scatola di collisione non deve finire addosso al giocatore
    const others = [];
    if (player) {
      others.push(player.bodyRect(), ...player.forkRects());
      if (player.carried) others.push(this.env.pallets.rect(player.carried.p));
    }
    for (const p of this.env.pallets.list) others.push(this.env.pallets.rect(p));
    return mine.some((m) => others.some((o) => rectsOverlap(m, o, 0.35)));
  }

  // Segue il percorso come un muletto vero: accelera e frena con gradualita', rallenta prima delle curve,
  // le ruote posteriori girano progressivamente. Ritorna true a fine percorso.
  follow(bot, dt, player, reverse) {
    const f = bot.f;
    const path = bot.path;
    const left = path.len - bot.s;
    if (left < 0.003) {
      bot.v = 0;
      return true;
    }
    const here = pointAt(path, bot.s);
    // Curva piu' stretta nei prossimi metri: velocita' adatta
    let turn = 0;
    for (const d of [0.6, 1.2, 1.8, 2.4]) {
      const q = pointAt(path, bot.s + d);
      turn = Math.max(turn, Math.abs(wrapAngle(q.h - here.h)) / d);
    }
    let target = Math.min((reverse ? V_REV : V_FWD) / (1 + turn * 2.2), Math.sqrt(2 * DEC * left));
    target = Math.max(target, 0.12); // ultimo tratto a passo d'uomo, senza fermarsi prima dell'arrivo
    // Ostacolo entro lo spazio di frenata: frena dolcemente
    const look = Math.min(left, 0.4 + (bot.v * bot.v) / (2 * DEC));
    const probe = pointAt(path, bot.s + look);
    if (this.blocked(bot, probe.x, probe.z, probe.h + (reverse ? Math.PI : 0), player)) target = 0;
    bot.v = target > bot.v ? Math.min(target, bot.v + ACC * dt) : Math.max(target, bot.v - DEC * 2 * dt);
    const ds = Math.min(left, bot.v * dt);
    if (ds <= 0) {
      f.v = 0;
      return false;
    }
    const p = pointAt(path, bot.s + ds);
    const yaw = p.h + (reverse ? Math.PI : 0);
    if (this.blocked(bot, p.x, p.z, yaw, player)) {
      bot.v = 0;
      f.v = 0;
      return false;
    }
    // Sterzo dalla curvatura del percorso poco piu' avanti (ruote posteriori)
    const q = pointAt(path, bot.s + ds + 0.3);
    const k = wrapAngle(q.h - p.h) / 0.3;
    const want = Math.atan(f.geo.wheelbase * k) * (reverse ? -1 : 1);
    bot.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, want - bot.steer));
    const signed = reverse ? -ds : ds;
    f.x = p.x;
    f.z = p.z;
    f.yaw = wrapAngle(yaw);
    f.v = signed / Math.max(dt, 1e-4);
    f.wheelSpin += signed / 0.33;
    bot.s += ds;
    return path.len - bot.s < 0.003;
  }

  work(bot, dt, player) {
    const f = bot.f;
    const task = bot.task;
    // Forche con accelerazione e frenata (come l'idraulica vera)
    const lift = (goal) => {
      const dist = goal - f.forkY;
      if (Math.abs(dist) < 1e-3) {
        f.forkY = goal;
        bot.liftV = 0;
        return true;
      }
      const want = Math.sign(dist) * Math.min(LIFT_SPEED, Math.sqrt(2 * LIFT_ACC * Math.abs(dist)) + 0.02);
      bot.liftV = easeStep(bot.liftV || 0, want, LIFT_ACC * dt);
      f.forkY = Math.abs(bot.liftV * dt) >= Math.abs(dist) ? goal : f.forkY + bot.liftV * dt;
      return false;
    };
    const backTo = (slot, step) => {
      task.step = step;
      bot.path = this.reversePath(bot, this.midPose(bot, slot));
      bot.s = 0;
    };
    let moving = false;
    switch (task.step) {
      case 'wait': {
        lift(TRAVEL_Y);
        const move = this.chooseMove(bot);
        if (move) {
          task.move = move;
          const s = move.from;
          this.startLeg(bot, 'toPick', s, s.base + (s.stack.length - 1) * PALLET_H + POCKET);
        }
        break;
      }
      case 'toPick':
      case 'toDrop': {
        // Forche all'altezza giusta prima di arrivare al pallet
        const ready = lift(task.step === 'toPick' ? task.height : task.height + CLEAR);
        const nearEnd = bot.path.len - bot.s < 1.6;
        if (!nearEnd || ready) {
          moving = true;
          if (this.follow(bot, dt, player, false) && ready) task.step = task.step === 'toPick' ? 'pickUp' : 'putDown';
        }
        break;
      }
      case 'pickUp':
        if (lift(task.height + CLEAR)) {
          bot.carried = task.spot.stack.pop();
          this.laySlot(task.spot);
          backTo(task.spot, 'backOut');
        }
        break;
      case 'backOut':
        moving = true;
        if (this.follow(bot, dt, player, true)) {
          const dst = task.move.to;
          this.startLeg(bot, 'toDrop', dst, dst.base + dst.stack.length * PALLET_H + POCKET);
        }
        break;
      case 'putDown':
        if (lift(task.height)) {
          task.spot.stack.push(bot.carried);
          bot.carried = null;
          this.laySlot(task.spot);
          backTo(task.spot, 'leave');
          bot.wait = 0.4;
        }
        break;
      case 'leave':
        bot.wait -= dt;
        if (bot.wait <= 0) {
          moving = true;
          if (this.follow(bot, dt, player, true)) this.idle(bot);
        }
        break;
      default:
        break;
    }
    if (!moving) {
      f.v = 0;
      bot.v = 0;
    }
    this.place(bot);
  }

  place(bot) {
    const f = bot.f;
    f.sync(Math.max(-1.05, Math.min(1.05, bot.steer)));
    this.syncCarried(bot);
    Object.assign(bot.collider, aabbOf(this.shapes(bot, f.x, f.z, f.yaw)), { y1: 2.4 * f.geo.s });
  }
}
