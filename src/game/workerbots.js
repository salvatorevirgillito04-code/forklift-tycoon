import { MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import { Forklift } from './forklift.js';
import { createPalletModel, PALLET } from './models.js';
import { plotToWorld } from './world.js';
import { rectsOverlap, toWorld, wrapAngle } from './physics.js';
import { WAREHOUSES, vehicleById } from '../data.js';

// Muletti degli operai al lavoro: spostano pallet tra due pile della loro zona, con manovre vere.
// Solo i 3 piu' vicini al giocatore, per non pesare sul telefono.
const MAX_BOTS = 3;
const VIEW_DIST = 75;
const LOAD_H = 0.7;
const PALLET_H = PALLET.height + LOAD_H;
const POCKET = 0.045; // forche dentro le tasche del pallet, sopra il fondo
const TRAVEL_Y = 0.15; // altezza forche in viaggio
const LIFT_SPEED = 0.45;
const V_FWD = 2.0;
const V_REV = 1.3;
const BACK_OFF = 3.2; // retromarcia dopo aver preso/appoggiato un pallet

// Zone di lavoro nel lotto (u lungo la strada, w verso il capannone). n = verso in cui guardano le pile.
const AREAS = [
  { u: 19.6, n: 1, wA: 12.5, wB: 25.5 }, // piazzale, lato destro
  { u: -19.6, n: -1, wA: 12.5, wB: 25.5 }, // piazzale, lato sinistro (oltre il camion)
  { u: 14.0, n: 1, wA: 34, wB: 48 }, // dentro il capannone, a destra
  { u: -14.0, n: -1, wA: 34, wB: 48 }, // dentro il capannone, a sinistra
];

const easeStep = (cur, goal, maxStep) => cur + Math.sign(goal - cur) * Math.min(maxStep, Math.abs(goal - cur));

// Curva di Bezier campionata: punti con distanza percorsa, usata per seguire il percorso a velocita' variabile.
function bezierPath(p0, p1, p2, p3, n = 48) {
  const pts = [];
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = 1 - t;
    const x = a * a * a * p0[0] + 3 * a * a * t * p1[0] + 3 * a * t * t * p2[0] + t * t * t * p3[0];
    const z = a * a * a * p0[1] + 3 * a * a * t * p1[1] + 3 * a * t * t * p2[1] + t * t * t * p3[1];
    if (i) len += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
    pts.push({ x, z, s: len });
  }
  return { pts, len };
}

function pointAt(path, s) {
  const { pts } = path;
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < s) i++;
  const a = pts[i - 1], b = pts[i];
  const k = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, dx: b.x - a.x, dz: b.z - a.z };
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
    for (const bot of this.bots.values()) if (bot.ready) this.work(bot, dt, player);
  }

  // Sceglie gli operai piu' vicini e crea/rimuove i loro muletti.
  pick(player) {
    const near = this.workers
      .map((w) => {
        const { wh, area } = this.areaOf(w);
        const [x, z] = plotToWorld(wh, area.u, (area.wA + area.wB) / 2);
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

  spawn(worker) {
    const { wh, area } = this.areaOf(worker);
    const f = new Forklift(this.scene, this.mats, vehicleById(worker.vehicle));
    const reach = f.geo.forkBase + PALLET.size / 2 + 0.02; // dal muso al centro del pallet infilato
    // Le due pile in coordinate del mondo, con la direzione da cui il muletto le prende
    const spot = (w) => {
      const [x, z] = plotToWorld(wh, area.u, w);
      const [dx, dz] = plotToWorld(wh, area.u + area.n, w);
      const yaw = Math.atan2(dx - x, dz - z);
      const hx = Math.sin(yaw), hz = Math.cos(yaw);
      return {
        x, z, yaw, stack: [],
        pick: { x: x - hx * reach, z: z - hz * reach }, // posizione del muletto con le forche dentro il pallet
        out: { x: x - hx * (reach + BACK_OFF), z: z - hz * (reach + BACK_OFF) }, // dopo la retromarcia
        collider: { minX: x - 0.62, maxX: x + 0.62, minZ: z - 0.62, maxZ: z + 0.62, y0: 0, y1: -1, tag: 'botPallet' },
      };
    };
    const bot = {
      f, wh, vehicleId: worker.vehicle, warehouse: worker.warehouse, ready: false,
      spots: [spot(area.wA), spot(area.wB)], from: 0, carried: null,
      task: null, path: null, s: 0, wait: 0,
      collider: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: -1, tag: 'bot' },
    };
    this.bots.set(worker.id, bot);
    this.env.colliders.push(bot.collider, ...bot.spots.map((s) => s.collider));
    const build = async () => {
      await f.build(this.shadowGen);
      const pallets = [];
      for (let i = 0; i < 2; i++) pallets.push(await createPalletModel(this.scene, this.mats, { loadHeight: LOAD_H }));
      if (this.bots.get(worker.id) !== bot) {
        f.dispose();
        pallets.forEach((p) => p.dispose());
        return;
      }
      for (const node of pallets) {
        node.getChildMeshes().forEach((m) => { this.shadowGen?.addShadowCaster(m); m.receiveShadows = true; });
        bot.spots[0].stack.push(node);
      }
      bot.spots.forEach((s) => this.layStack(s));
      f.tilt = 0.03;
      f.forkY = TRAVEL_Y;
      this.addDriver(f, worker.avatar);
      // Parte gia' fuori dalla prima pila, pronto a prendere il pallet
      const start = bot.spots[0];
      f.x = start.out.x;
      f.z = start.out.z;
      f.yaw = start.yaw;
      bot.ready = true;
      this.nextTask(bot);
      this.place(bot, 0);
    };
    build();
  }

  // Operaio seduto al posto di guida, con i colori del suo avatar.
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
  }

  remove(id) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.f.dispose();
    bot.carried?.dispose();
    for (const s of bot.spots) s.stack.forEach((n) => n.dispose());
    for (const c of [bot.collider, ...bot.spots.map((s) => s.collider)]) {
      const i = this.env.colliders.indexOf(c);
      if (i >= 0) this.env.colliders.splice(i, 1);
    }
    this.bots.delete(id);
  }

  clear() {
    for (const id of [...this.bots.keys()]) this.remove(id);
  }

  // Pile ferme: posizione dei pallet e ingombro per le collisioni.
  layStack(spot) {
    spot.stack.forEach((node, i) => {
      node.position.set(spot.x, i * PALLET_H, spot.z);
      node.rotation.set(0, spot.yaw, 0);
    });
    spot.collider.y1 = spot.stack.length ? spot.stack.length * PALLET_H : -1;
  }

  // ---------- Lavoro ----------
  // Prende il pallet in cima alla pila piu' piena e lo porta sull'altra; quando una pila e' vuota si inverte.
  nextTask(bot) {
    if (!bot.spots[bot.from].stack.length) bot.from = 1 - bot.from;
    const src = bot.spots[bot.from];
    bot.task = { step: 'toPick', spot: src, height: (src.stack.length - 1) * PALLET_H + POCKET };
    bot.path = this.forwardPath(bot, src);
    bot.s = 0;
  }

  // Percorso in avanti fino alla pila: curva a S dal punto in cui si trova, arrivando dritto davanti ai pallet.
  forwardPath(bot, spot) {
    const f = bot.f;
    const hx = Math.sin(f.yaw), hz = Math.cos(f.yaw);
    const ex = Math.sin(spot.yaw), ez = Math.cos(spot.yaw);
    const end = [spot.pick.x, spot.pick.z];
    const d = Math.hypot(end[0] - f.x, end[1] - f.z);
    const c = Math.min(4.5, Math.max(1, d * 0.45));
    return bezierPath([f.x, f.z], [f.x + hx * c, f.z + hz * c], [end[0] - ex * c, end[1] - ez * c], end);
  }

  // Retromarcia dritta per uscire dalla pila.
  reversePath(bot, spot) {
    return bezierPath([bot.f.x, bot.f.z], [bot.f.x, bot.f.z], [spot.out.x, spot.out.z], [spot.out.x, spot.out.z], 8);
  }

  // Pallet portato sulle forche: segue muletto e altezza delle forche.
  syncCarried(bot) {
    const { f, carried } = bot;
    if (!carried) return;
    const [x, z] = toWorld(f.frame, 0, f.geo.forkBase + PALLET.size / 2 + 0.02);
    carried.position.set(x, f.forkY - POCKET, z);
    carried.rotation.set(0, f.yaw, 0);
  }

  // Forme del muletto (e del pallet portato) in una certa posizione, per non investire il giocatore.
  shapes(bot, x, z, yaw) {
    const f = bot.f;
    const list = [f.bodyRect(x, z, yaw), ...f.forkRects(x, z, yaw)];
    if (bot.carried) {
      const [cx, cz] = toWorld({ x, z, yaw }, 0, f.geo.forkBase + PALLET.size / 2 + 0.02);
      list.push({ x: cx, z: cz, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw });
    }
    return list;
  }

  blocked(bot, x, z, yaw, player) {
    const mine = this.shapes(bot, x, z, yaw);
    // Anche la scatola di collisione non deve finire addosso al giocatore, o lui resterebbe incastrato
    const b = aabbOf(mine);
    mine.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2, yaw: 0 });
    const others = [];
    if (player) {
      others.push(player.bodyRect(), ...player.forkRects());
      if (player.carried) others.push(this.env.pallets.rect(player.carried.p));
    }
    for (const p of this.env.pallets.list) others.push(this.env.pallets.rect(p));
    return mine.some((m) => others.some((o) => rectsOverlap(m, o, 0.35)));
  }

  // Segue il percorso: piu' lento in curva e in fondo, sterzo delle ruote posteriori dalla curvatura.
  follow(bot, dt, player, reverse) {
    const f = bot.f;
    const path = bot.path;
    const left = path.len - bot.s;
    const ahead = pointAt(path, Math.min(path.len, bot.s + 1.2));
    const here = pointAt(path, bot.s);
    const turn = Math.abs(wrapAngle(Math.atan2(ahead.dx, ahead.dz) - Math.atan2(here.dx, here.dz)));
    const vmax = (reverse ? V_REV : V_FWD) / (1 + turn * 2.5);
    const target = Math.min(vmax, Math.sqrt(2 * 1.2 * Math.max(0, left)) + 0.15);
    const ds = Math.min(left, target * dt);
    const p = pointAt(path, bot.s + ds);
    const yaw = Math.atan2(p.dx, p.dz) + (reverse ? Math.PI : 0);
    if (ds > 0 && this.blocked(bot, p.x, p.z, yaw, player)) {
      f.v = 0;
      return false;
    }
    const dYaw = wrapAngle(yaw - f.yaw);
    const signed = reverse ? -ds : ds;
    bot.steer = ds > 1e-4 ? Math.atan((f.geo.wheelbase * dYaw) / signed) : (bot.steer || 0) * 0.9;
    f.x = p.x;
    f.z = p.z;
    f.yaw = wrapAngle(yaw);
    f.v = signed / Math.max(dt, 1e-4);
    f.wheelSpin += signed / 0.33;
    bot.s += ds;
    return bot.s >= path.len - 1e-3;
  }

  work(bot, dt, player) {
    const f = bot.f;
    const task = bot.task;
    const lift = (goal) => {
      f.forkY = easeStep(f.forkY, goal, LIFT_SPEED * dt);
      return Math.abs(f.forkY - goal) < 1e-3;
    };
    switch (task.step) {
      case 'toPick': {
        // Alza o abbassa le forche mentre si avvicina, entra nel pallet solo all'altezza giusta
        const ready = lift(task.height);
        const nearEnd = bot.path.len - bot.s < 1.6;
        if ((!nearEnd || ready) && this.follow(bot, dt, player, false) && ready) task.step = 'pickUp';
        break;
      }
      case 'pickUp':
        if (lift(task.height + 0.12)) {
          bot.carried = task.spot.stack.pop();
          this.layStack(task.spot);
          task.step = 'backOut';
          bot.path = this.reversePath(bot, task.spot);
          bot.s = 0;
        }
        break;
      case 'backOut':
        if (this.follow(bot, dt, player, true)) {
          const dst = bot.spots[1 - bot.from];
          task.step = 'toDrop';
          task.spot = dst;
          task.height = dst.stack.length * PALLET_H + POCKET;
          bot.path = this.forwardPath(bot, dst);
          bot.s = 0;
        }
        break;
      case 'toDrop': {
        const ready = lift(task.height + 0.12);
        const nearEnd = bot.path.len - bot.s < 1.6;
        if ((!nearEnd || ready) && this.follow(bot, dt, player, false) && ready) task.step = 'putDown';
        break;
      }
      case 'putDown':
        if (lift(task.height)) {
          task.spot.stack.push(bot.carried);
          bot.carried = null;
          this.layStack(task.spot);
          task.step = 'leave';
          bot.path = this.reversePath(bot, task.spot);
          bot.s = 0;
          bot.wait = 0.4;
        }
        break;
      case 'leave':
        bot.wait -= dt;
        if (bot.wait <= 0 && this.follow(bot, dt, player, true)) task.step = 'lower';
        break;
      case 'lower':
        if (lift(TRAVEL_Y)) this.nextTask(bot);
        break;
      default:
        break;
    }
    if (task.step !== 'toPick' && task.step !== 'toDrop' && task.step !== 'backOut' && task.step !== 'leave') {
      f.v = 0;
      bot.steer = (bot.steer || 0) * 0.9;
    }
    this.place(bot, bot.steer || 0);
  }

  place(bot, steer) {
    const f = bot.f;
    f.sync(Math.max(-1.05, Math.min(1.05, steer)));
    this.syncCarried(bot);
    // Ingombro per le collisioni del giocatore (scatola che contiene muletto, forche e pallet)
    Object.assign(bot.collider, aabbOf(this.shapes(bot, f.x, f.z, f.yaw)), { y1: 2.4 * f.geo.s });
  }
}
