import { createTruckModel, TRUCK, PALLET } from './models.js';
import { WAREHOUSES } from '../data.js';
import { PLOT, plotToWorld, zoneRect } from './world.js';

const TRUCK_COLORS = ['#d63a2f', '#1f5fa8', '#f0f0f0', '#2c8c4a', '#e3a01b'];

// Posizioni dei pallet: zona interna (righe dalla porta verso il fondo) o pianale (2 file).
function zoneSlots(wh) {
  const slots = [];
  for (const w of [37.4, 40, 42.6]) {
    for (const u of [-4.5, -1.5, 1.5, 4.5]) slots.push(plotToWorld(wh, u, w));
  }
  return slots;
}

function bedSlots(wh, count) {
  const slots = [];
  const [bx, bz] = plotToWorld(wh, PLOT.truck.u, PLOT.truck.w);
  const perRow = Math.ceil(count / 2);
  for (let i = 0; i < count; i++) {
    const row = i < perRow ? 0 : 1;
    const idx = row === 0 ? i : i - perRow;
    const n = row === 0 ? perRow : count - perRow;
    const spacing = Math.min(1.45, (TRUCK.bedLength - 0.6) / Math.max(1, n));
    const x = bx - ((n - 1) * spacing) / 2 + idx * spacing;
    // la prima fila e' quella verso il capannone, raggiungibile dal piazzale
    const z = bz + wh.side * (row === 0 ? 0.62 : -0.62);
    slots.push([x, z]);
  }
  return slots;
}

export class Mission {
  constructor(scene, mats, env, shadowGen) {
    this.scene = scene;
    this.mats = mats;
    this.env = env;
    this.shadowGen = shadowGen;
    this.truck = null;
    this.contract = null;
  }

  async start(contract) {
    this.cleanup();
    this.contract = contract;
    const wh = WAREHOUSES[contract.warehouseId];
    this.wh = wh;
    this.timeLeft = contract.timeLimit ?? Infinity;
    this.drops = 0;
    this.finished = false;
    this.forceDone = false;
    this.leaving = 0;

    const [bx, bz] = plotToWorld(wh, PLOT.truck.u, PLOT.truck.w);
    if (contract.type !== 'free') {
      this.truck = await createTruckModel(this.scene, this.mats, TRUCK_COLORS[contract.seed % TRUCK_COLORS.length]);
      this.truck.position.set(bx, 0, bz);
      this.truck.getChildMeshes().forEach((m) => {
        this.shadowGen?.addShadowCaster(m);
        m.receiveShadows = true;
      });
      const L = TRUCK.bedLength, W = TRUCK.bedWidth;
      this.truckColliders = [
        { minX: bx - L / 2, maxX: bx + L / 2, minZ: bz - W / 2, maxZ: bz + W / 2, y0: 0, y1: TRUCK.bedHeight, tag: 'truck' },
        { minX: bx + L / 2, maxX: bx + L / 2 + 5, minZ: bz - W / 2, maxZ: bz + W / 2, y0: 0, y1: 4, tag: 'truck' },
        { minX: bx + L / 2 - 0.15, maxX: bx + L / 2, minZ: bz - W / 2, maxZ: bz + W / 2, y0: 0, y1: TRUCK.bedHeight + 1.4, tag: 'truck' },
      ];
      this.env.colliders.push(...this.truckColliders);
      this.env.pallets.truckBed = { x: bx, z: bz, hw: L / 2, hd: W / 2, yaw: 0 };
    }

    const loadH = Math.min(1.5, 0.55 + contract.weight / 2600);
    const spawn = (x, z, bottom) => this.env.pallets.spawn({
      x, z, bottom, yaw: 0, weight: contract.weight, loadH, fragile: contract.fragile,
    });
    if (contract.type === 'load') {
      const slots = zoneSlots(wh);
      for (let i = 0; i < contract.pallets; i++) await spawn(slots[i][0], slots[i][1], 0);
    } else if (contract.type === 'unload') {
      for (const [x, z] of bedSlots(wh, contract.pallets)) await spawn(x, z, TRUCK.bedHeight);
    } else {
      // Guida libera: qualche pallet di prova nel piazzale
      for (let i = 0; i < 3; i++) {
        const [x, z] = plotToWorld(wh, -8 + i * 3, 24);
        await spawn(x, z, 0);
      }
    }

    const [sx, sz] = plotToWorld(wh, 9, 22);
    return { x: sx, z: sz, yaw: wh.side > 0 ? 0 : Math.PI };
  }

  progress() {
    const c = this.contract;
    if (!c || c.type === 'free') return { done: 0, total: 0 };
    const pallets = this.env.pallets;
    let done = 0;
    if (c.type === 'load') {
      done = pallets.list.filter((p) => p.state === 'rest' && pallets.onTruck(p) && p.bottom >= TRUCK.bedHeight - 0.01).length;
    } else {
      const z = zoneRect(this.wh);
      done = pallets.list.filter((p) => p.state === 'rest' && p.bottom < 0.05
        && p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ).length;
    }
    return { done, total: c.pallets };
  }

  // Ritorna 'complete', 'failed' o null.
  update(dt, forklift) {
    if (!this.contract || this.finished) {
      this.animateLeaving(dt);
      return null;
    }
    if (this.contract.type === 'free') return null;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finished = true;
      return 'failed';
    }
    const { done, total } = this.progress();
    if ((done >= total || this.forceDone) && !forklift.carried) {
      this.finished = true;
      // Il camion riparte (con o senza carico)
      if (this.contract.type === 'load') {
        for (const p of this.env.pallets.list) if (this.env.pallets.onTruck(p)) p.node.parent = this.truck;
        for (const p of this.env.pallets.list) {
          if (p.node.parent === this.truck) p.node.position.set(p.x - this.truck.position.x, p.bottom, p.z - this.truck.position.z);
        }
      }
      this.env.colliders = this.env.colliders.filter((c) => c.tag !== 'truck');
      this.leaving = 0.01;
      return 'complete';
    }
    return null;
  }

  animateLeaving(dt) {
    if (!this.truck || !this.leaving) return;
    this.leaving += dt;
    const speed = Math.min(8, this.leaving * 2.5);
    this.truck.position.x += speed * dt;
  }

  result() {
    const c = this.contract;
    const timeRatio = Math.max(0, this.timeLeft / c.timeLimit);
    const timeBonus = Math.round(c.reward * 0.3 * timeRatio);
    const penalty = Math.round(c.reward * (c.fragile ? 0.35 : 0.15) * this.drops);
    const coins = Math.max(Math.round(c.reward * 0.1), c.reward + timeBonus - penalty);
    const stars = this.drops === 0 && timeRatio > 0.35 ? 3 : this.drops <= 1 ? 2 : 1;
    return { base: c.reward, timeBonus, penalty, coins, stars, xp: c.xp, drops: this.drops };
  }

  cleanup() {
    this.env.pallets.clear();
    this.env.pallets.truckBed = null;
    this.env.colliders = this.env.colliders.filter((c) => c.tag !== 'truck');
    this.truck?.dispose();
    this.truck = null;
    this.contract = null;
  }
}

export { PALLET };
