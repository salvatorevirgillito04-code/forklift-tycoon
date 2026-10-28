import { createTruckModel, TRUCK, PALLET } from './models.js';
import { WAREHOUSES, CONTRACT_TYPES, bumpPct, BUMP_MAX } from '../data.js';
import { PLOT, plotToWorld, zoneRect, rackSlots, rackRect } from './world.js';
import { bezierPath, pointAt, toLocal } from './physics.js';

const TRUCK_COLORS = ['#d63a2f', '#1f5fa8', '#f0f0f0', '#2c8c4a', '#e3a01b'];
// Ingombro del camion lungo il suo asse (cabina verso +x): dal fondo del pianale al muso della motrice
const TRUCK_REAR = -TRUCK.bedLength / 2 - 0.2, TRUCK_FRONT = TRUCK.bedLength / 2 + 5;
const TRUCK_HALF_W = TRUCK.bedWidth / 2 + 0.05;
const ARRIVE_LANE = -3.5; // corsia (z) da cui arriva il camion: si guida a destra, verso +x su z = -3,5
// distanza del centro del muletto da una scatola { minX, maxX, minZ, maxZ }
const boxDist = (b, f) => Math.hypot(Math.max(b.minX - f.x, 0, f.x - b.maxX), Math.max(b.minZ - f.z, 0, f.z - b.maxZ));
const line = (a, b) => bezierPath(a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (b[0] - a[0]) * 2 / 3, a[1] + (b[1] - a[1]) * 2 / 3], b);

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
    this.bumps = 0;
    this.contact = null; // ostacolo urtato: un nuovo urto conta solo dopo essersi staccati
    this.finished = false;
    this.forceDone = false;

    // Da dove partono i pallet e dove vanno: zona gialla, camion o scaffalatura
    const route = CONTRACT_TYPES[contract.type];
    this.route = route;
    const [bx, bz] = plotToWorld(wh, PLOT.truck.u, PLOT.truck.w);
    if (route && (route.from === 'truck' || route.to === 'truck')) {
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
      this.bedPose = { x: bx, z: bz, hw: L / 2, hd: W / 2, yaw: 0 };
      // Arriva dalla strada: avanti sulla corsia, poi in retromarcia fino al posto (il tempo parte quando e' fermo)
      // corsia verso +x (z = -3,5); per i lotti a nord si sposta sulla corsia vicina prima della manovra
      const zl = ARRIVE_LANE, zn = wh.side * Math.abs(ARRIVE_LANE), xs = bx + 26;
      this.drive = { mode: 'arrive', i: 0, s: 0, v: 13, legs: [
        { path: line([bx - 45, zl], [xs - 26, zl]), vmax: 13, keep: true, travel: true, fadeIn: true },
        { path: bezierPath([xs - 26, zl], [xs - 13, zl], [xs - 13, zn], [xs, zn]), vmax: 10 },
        { path: bezierPath([xs, zn], [xs - 12, zn], [bx + 14, bz], [bx, bz]), vmax: 5, reverse: true },
      ] };
      this.moveCol = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 4, tag: 'truck' };
      this.env.colliders.push(this.moveCol);
      this.placeTruck();
    }

    // Sulla scaffalatura il carico deve passare tra un piano e l'altro (1,4 m)
    const rack = route && (route.from === 'rack' || route.to === 'rack');
    const loadH = rack ? Math.min(1.05, 0.5 + contract.weight / 6000) : Math.min(1.5, 0.55 + contract.weight / 4000);
    const spawn = (x, z, bottom) => this.env.pallets.spawn({
      x, z, bottom, yaw: 0, weight: contract.weight, loadH, fragile: contract.fragile,
    });
    if (route?.from === 'zone') {
      const slots = zoneSlots(wh);
      for (let i = 0; i < contract.pallets; i++) await spawn(slots[i][0], slots[i][1], 0);
    } else if (route?.from === 'truck') {
      for (const [x, z] of bedSlots(wh, contract.pallets)) {
        // viaggiano col camion finche' non e' parcheggiato
        const p = await spawn(x, z, TRUCK.bedHeight);
        p.state = 'onTruck';
        p.node.parent = this.truck;
        p.node.position.set(x - bx, TRUCK.bedHeight, z - bz);
      }
    } else if (route?.from === 'rack') {
      // posti a caso sulla scaffalatura (stesso contratto = stessi posti)
      const slots = rackSlots(wh);
      let seed = contract.seed >>> 0;
      for (let i = 0; i < contract.pallets; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const [s] = slots.splice(seed % slots.length, 1);
        await spawn(s.x, s.z, s.h);
      }
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
    if (this.route.to === 'truck') {
      done = pallets.list.filter((p) => p.state === 'rest' && pallets.onTruck(p) && p.bottom >= TRUCK.bedHeight - 0.01).length;
    } else if (this.route.to === 'rack') {
      const r = rackRect(this.wh);
      done = pallets.list.filter((p) => p.state === 'rest' && p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ).length;
    } else {
      const z = zoneRect(this.wh);
      done = pallets.list.filter((p) => p.state === 'rest' && p.bottom < 0.05
        && p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ).length;
    }
    return { done, total: c.pallets };
  }

  // Ritorna 'complete', 'failed' o null.
  update(dt, forklift, cars, walkers) {
    if (!this.contract || this.finished) {
      this.driveTruck(dt, forklift, cars, walkers);
      return null;
    }
    if (this.contract.type === 'free') return null;
    if (this.drive) {
      this.driveTruck(dt, forklift, cars, walkers);
      return null;
    }
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
      if (this.route.to === 'truck') {
        for (const p of this.env.pallets.list) if (this.env.pallets.onTruck(p)) p.node.parent = this.truck;
        for (const p of this.env.pallets.list) {
          if (p.node.parent === this.truck) p.node.position.set(p.x - this.truck.position.x, p.bottom, p.z - this.truck.position.z);
        }
      }
      this.env.colliders = this.env.colliders.filter((c) => c.tag !== 'truck');
      if (this.truck) {
        // riparte in avanti verso la strada e se ne va
        this.drive = { mode: 'leave', i: 0, s: 0, v: 0, legs: this.leaveLegsFor() };
        this.env.colliders.push(this.moveCol);
      }
      return 'complete';
    }
    return null;
  }

  // Uscita: avanti fino alla corsia vicina, poi sulla corsia di marcia (verso +x) e via
  leaveLegsFor() {
    const { x: bx, z: bz } = this.bedPose, zl = ARRIVE_LANE, zn = Math.abs(ARRIVE_LANE) * this.wh.side;
    return [
      { path: bezierPath([bx, bz], [bx + 11, bz], [bx + 15, zn], [bx + 26, zn]), vmax: 4 },
      { path: bezierPath([bx + 26, zn], [bx + 39, zn], [bx + 39, zl], [bx + 52, zl]), vmax: 7 },
      { path: line([bx + 52, zl], [bx + 140, zl]), vmax: 12, travel: true, fadeOut: true },
    ];
  }

  // Camion in movimento lungo le sue tratte: rallenta alla fine di ognuna e si ferma se il muletto e' davanti
  // cars: macchine { x, z, v } da seguire sulle tratte di viaggio (in manovra sono loro ad aspettare il camion)
  driveTruck(dt, forklift, cars = [], walkers = []) {
    const d = this.drive;
    if (!d || !this.truck) return;
    const leg = d.legs[d.i];
    const left = leg.path.len - d.s;
    // rallenta in fondo alla tratta (non su quelle di solo viaggio, che proseguono nella successiva)
    let want = leg.keep ? leg.vmax : Math.min(leg.vmax, Math.sqrt(2 * 2.6 * Math.max(0, left)) + 0.3);
    if (leg.keep && d.legs[d.i + 1]) want = Math.min(want, d.legs[d.i + 1].vmax + Math.sqrt(2 * 2.6 * Math.max(0, left)));
    if (forklift && this.blockedBy(forklift, leg.reverse)) want = 0;
    if (walkers.some((w) => this.blockedBy(w, leg.reverse))) want = 0;
    if (leg.travel) {
      for (const c of cars) {
        const [lx, lz] = toLocal(this.truckPose, c.x, c.z);
        const gap = lx - TRUCK_FRONT;
        if (Math.abs(lz) < 2 && gap > -2 && gap < 18) want = Math.min(want, gap < 6 ? 0 : c.v);
      }
    }
    d.v += Math.max(-3.5 * dt, Math.min(2.4 * dt, want - d.v));
    d.s = Math.min(leg.path.len, d.s + Math.max(0, d.v) * dt);
    this.placeTruck();
    if (d.s >= leg.path.len - 1e-3) {
      d.i += 1;
      d.s = 0;
      if (d.i < d.legs.length) return;
      this.drive = null;
      this.env.colliders = this.env.colliders.filter((c) => c !== this.moveCol);
      if (d.mode === 'arrive') this.park();
      else this.truck.setEnabled(false);
    }
  }

  placeTruck() {
    const d = this.drive, leg = d.legs[d.i];
    const pt = pointAt(leg.path, d.s);
    // la cabina guarda nel verso del moto, o all'indietro in retromarcia
    const hx = leg.reverse ? -pt.dx : pt.dx, hz = leg.reverse ? -pt.dz : pt.dz;
    const yaw = Math.atan2(-hz, hx);
    this.truck.position.set(pt.x, 0, pt.z);
    this.truck.rotation.y = yaw;
    // compare e sparisce in dissolvenza (inizio e fine della strada)
    const fade = leg.fadeIn ? Math.min(1, d.s / 12) : leg.fadeOut ? Math.min(1, (leg.path.len - d.s) / 12) : 1;
    if (fade !== this.truckFade) {
      this.truckFade = fade;
      for (const m of this.truck.getChildMeshes(false, (n) => !n.isAnInstance)) m.visibility = fade; // i pallet (istanze) no
    }
    this.truckPose = { x: pt.x, z: pt.z, yaw, reverse: !!leg.reverse, moving: true };
    // ostacolo per il muletto (scatola che contiene il camion girato)
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const cx = pt.x + Math.cos(yaw) * (TRUCK_FRONT + TRUCK_REAR) / 2, cz = pt.z - Math.sin(yaw) * (TRUCK_FRONT + TRUCK_REAR) / 2;
    const hl = (TRUCK_FRONT - TRUCK_REAR) / 2;
    const ex = c * hl + s * TRUCK_HALF_W, ez = s * hl + c * TRUCK_HALF_W;
    Object.assign(this.moveCol, { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez });
  }

  // Il muletto sta davanti al camion (nel verso in cui si muove)?
  blockedBy(f, reverse) {
    const P = this.truckPose;
    const [lx, lz] = toLocal(P, f.x, f.z); // lx lungo il camion (+ = cabina), lz di lato
    const ahead = reverse ? TRUCK_REAR - lx : lx - TRUCK_FRONT;
    return Math.abs(lz) < TRUCK_HALF_W + 1.8 && ahead > -(TRUCK_FRONT - TRUCK_REAR) && ahead < 6;
  }

  // Camion fermo al suo posto: ostacoli precisi, pallet scaricabili, parte il tempo
  park() {
    this.truck.position.set(this.bedPose.x, 0, this.bedPose.z);
    this.truck.rotation.y = 0;
    this.truckPose = { ...this.bedPose, moving: false };
    if (this.truckFade !== 1) {
      this.truckFade = 1;
      for (const m of this.truck.getChildMeshes(false, (n) => !n.isAnInstance)) m.visibility = 1;
    }
    this.env.colliders.push(...this.truckColliders);
    this.env.pallets.truckBed = this.bedPose;
    for (const p of this.env.pallets.list) {
      if (p.state !== 'onTruck') continue;
      p.state = 'rest';
      p.node.parent = null;
      this.env.pallets.sync(p);
    }
    this.justParked = true;
  }

  // Urto contro una persona o una macchina (col = il suo ostacolo): conta una volta finche' il muletto
  // resta appoggiato; dopo essersi staccati (mezzo metro) il prossimo urto conta di nuovo. true se contato.
  bump(col, f) {
    if (!this.contract || this.finished) return false;
    if (this.contact?.col === col) return false;
    this.contact = { col, d: boxDist(col, f) };
    this.bumps += 1;
    return true;
  }

  // chiamata a ogni passo: si e' staccati quando ci si allontana dall'ostacolo urtato
  updateContact(f) {
    const c = this.contact;
    if (c && boxDist(c.col, f) > c.d + 0.5) this.contact = null;
  }

  get bumpPctTotal() {
    return Math.min(BUMP_MAX, this.bumps * bumpPct(this.contract?.level || 1));
  }

  result() {
    const c = this.contract;
    const timeRatio = Math.max(0, this.timeLeft / c.timeLimit);
    const timeBonus = Math.round(c.reward * 0.3 * timeRatio);
    const penalty = Math.round(c.reward * (c.fragile ? 0.35 : 0.15) * this.drops);
    const bumpPenalty = Math.round(c.reward * this.bumpPctTotal / 100);
    const coins = Math.max(Math.round(c.reward * 0.1), c.reward + timeBonus - penalty - bumpPenalty);
    const faults = this.drops + this.bumps;
    const stars = faults === 0 && timeRatio > 0.35 ? 3 : faults <= 1 ? 2 : 1;
    return { base: c.reward, timeBonus, penalty, coins, stars, xp: c.xp, drops: this.drops,
      bumps: this.bumps, bumpPct: this.bumpPctTotal, bumpPenalty };
  }

  cleanup() {
    this.env.pallets.clear();
    this.env.pallets.truckBed = null;
    this.env.colliders = this.env.colliders.filter((c) => c.tag !== 'truck');
    this.drive = null;
    this.truckPose = null;
    this.truck?.dispose();
    this.truck = null;
    this.contract = null;
  }
}

export { PALLET };
