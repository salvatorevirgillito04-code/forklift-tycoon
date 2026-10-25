import { MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';
import { Forklift } from './forklift.js';
import { FORK } from './models.js';
import { plotToWorld } from './world.js';
import { rectsOverlap, aabbToRect } from './physics.js';
import { WAREHOUSES, vehicleById } from '../data.js';

// Muletti degli operai che lavorano nel piazzale: solo i 3 piu' vicini al giocatore, per non pesare sul telefono.
const MAX_BOTS = 3;
const VIEW_DIST = 75;
const LANES_U = [14, -14, 18.6, -18.6]; // corsie nel piazzale, lontane dal camion e dalla partenza del giocatore
const W_NEAR = 12.5; // capolinea verso la strada
const W_FAR = 25.5; // capolinea verso il capannone
const SPEED = 2.2;
const LIFT_SPEED = 0.5;
const LIFT_TOP = 1.4;

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

  lanePos(worker) {
    const wh = WAREHOUSES[worker.warehouse];
    const idx = this.workers.filter((w) => w.warehouse === worker.warehouse).indexOf(worker);
    const u = LANES_U[idx % LANES_U.length];
    return { wh, u };
  }

  update(dt, player) {
    this.pickTimer -= dt;
    if (this.pickTimer <= 0) {
      this.pickTimer = 0.5;
      this.pick(player);
    }
    for (const bot of this.bots.values()) if (bot.f.model) this.drive(bot, dt, player);
  }

  // Sceglie gli operai piu' vicini e crea/rimuove i loro muletti.
  pick(player) {
    const near = this.workers
      .map((w) => {
        const { wh, u } = this.lanePos(w);
        const [x, z] = plotToWorld(wh, u, (W_NEAR + W_FAR) / 2);
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
    const { wh, u } = this.lanePos(worker);
    const f = new Forklift(this.scene, this.mats, vehicleById(worker.vehicle));
    const bot = {
      f, wh, u, vehicleId: worker.vehicle, warehouse: worker.warehouse,
      w: W_NEAR + Math.random() * (W_FAR - W_NEAR), dir: 1, phase: 'drive', wait: 0,
      collider: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: -1, tag: 'bot' },
    };
    this.bots.set(worker.id, bot);
    this.env.colliders.push(bot.collider);
    f.build(this.shadowGen).then(() => {
      if (this.bots.get(worker.id) !== bot) return f.dispose();
      f.tilt = 0.03;
      this.addDriver(f, worker.avatar);
      this.place(bot);
    });
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
    const i = this.env.colliders.indexOf(bot.collider);
    if (i >= 0) this.env.colliders.splice(i, 1);
    this.bots.delete(id);
  }

  clear() {
    for (const id of [...this.bots.keys()]) this.remove(id);
  }

  // Ingombro del muletto (corpo + forche) a una certa distanza dalla strada.
  boxAt(bot, w) {
    const g = bot.f.geo;
    const tip = g.forkBase + FORK.length;
    const [x0, z0] = plotToWorld(bot.wh, bot.u - g.body.hw - 0.05, w + g.body.z0);
    const [x1, z1] = plotToWorld(bot.wh, bot.u + g.body.hw + 0.05, w + tip);
    return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
  }

  place(bot) {
    const [x, z] = plotToWorld(bot.wh, bot.u, bot.w);
    const f = bot.f;
    f.x = x;
    f.z = z;
    f.yaw = bot.wh.side > 0 ? 0 : Math.PI;
    f.sync(0);
    Object.assign(bot.collider, this.boxAt(bot, bot.w), { y1: 2.4 * f.geo.s });
  }

  // Si ferma se il giocatore o un pallet e' sulla sua strada.
  blocked(bot, nextW, player) {
    const r = aabbToRect(this.boxAt(bot, nextW));
    if (player) {
      if (rectsOverlap(r, player.bodyRect(), 0.3)) return true;
      if (player.forkRects().some((fr) => rectsOverlap(r, fr, 0.3))) return true;
      if (player.carried && rectsOverlap(r, this.env.pallets.rect(player.carried.p), 0.3)) return true;
    }
    return this.env.pallets.list.some((p) => p.bottom < 2 && rectsOverlap(r, this.env.pallets.rect(p), 0.1));
  }

  // Ciclo di lavoro: avanti verso il capannone, alza le forche, indietro, abbassa, e cosi' via.
  drive(bot, dt, player) {
    const f = bot.f;
    if (bot.phase === 'drive') {
      const target = bot.dir > 0 ? W_FAR : W_NEAR;
      const step = Math.min(SPEED * dt, Math.abs(target - bot.w));
      const nextW = bot.w + bot.dir * step;
      if (this.blocked(bot, nextW, player)) {
        f.v = 0;
      } else {
        bot.w = nextW;
        f.wheelSpin += (bot.dir * step) / 0.3;
      }
      if (Math.abs(bot.w - target) < 1e-3) {
        bot.phase = 'lift';
        bot.wait = 0.6;
      }
    } else {
      bot.wait -= dt;
      const goal = bot.dir > 0 ? LIFT_TOP : 0.05;
      f.forkY += Math.sign(goal - f.forkY) * Math.min(LIFT_SPEED * dt, Math.abs(goal - f.forkY));
      if (bot.wait <= 0 && Math.abs(goal - f.forkY) < 1e-3) {
        bot.dir = -bot.dir;
        bot.phase = 'drive';
      }
    }
    this.place(bot);
  }
}
