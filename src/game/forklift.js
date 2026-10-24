import { createForkliftModel, FORK, PALLET } from './models.js';
import { rectsOverlap, aabbToRect, verticalOverlap, toLocal, toWorld, wrapAngle } from './physics.js';

const WHEELBASE = 1.55;
const MAX_STEER = 1.05; // rad, angolo massimo ruote posteriori
const BODY = { hw: 0.6, z0: -2.25, z1: 0.6, height: 2.45 };
const SPREAD = [0.25, 1.0];
const TILT = [-0.09, 0.17]; // negativo = in avanti
const QUARTER = Math.PI / 2;

export class Forklift {
  constructor(scene, mats, vehicle) {
    this.scene = scene;
    this.mats = mats;
    this.vehicle = vehicle;
    this.x = 0; this.z = 0; this.yaw = 0;
    this.v = 0;
    this.steer = 0; // -1..1
    this.forkY = 0.05;
    this.spread = 0.6;
    this.tilt = 0.03;
    this.gear = 1;
    this.carried = null; // { p, lx, lz, relYaw, shallowTime }
    this.unstable = 0;
    this.events = []; // messaggi per l'HUD: 'tooHeavy', 'insertDeeper', 'dropped', 'widen', 'pickup', 'place'
    this.wheelSpin = 0;
  }

  async build(shadowGen) {
    this.model = await createForkliftModel(this.scene, this.mats, this.vehicle);
    this.model.root.getChildMeshes().forEach((m) => {
      shadowGen?.addShadowCaster(m);
      m.receiveShadows = true;
    });
    this.sync();
  }

  dispose() {
    this.model?.root.dispose();
  }

  place(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.v = 0; this.steer = 0;
    this.carried = null;
    this.forkY = 0.05;
    this.sync();
  }

  get frame() {
    return { x: this.x, z: this.z, yaw: this.yaw };
  }

  bodyRect(x = this.x, z = this.z, yaw = this.yaw) {
    const cz = (BODY.z0 + BODY.z1) / 2;
    const [wx, wz] = toWorld({ x, z, yaw }, 0, cz);
    return { x: wx, z: wz, hw: BODY.hw, hd: (BODY.z1 - BODY.z0) / 2, yaw };
  }

  forkRects(x = this.x, z = this.z, yaw = this.yaw, spread = this.spread) {
    const cz = FORK.baseZ + FORK.length / 2;
    return [-1, 1].map((side) => {
      const [wx, wz] = toWorld({ x, z, yaw }, side * spread / 2, cz);
      return { x: wx, z: wz, hw: FORK.width / 2, hd: FORK.length / 2, yaw, side };
    });
  }

  carriedPose(x = this.x, z = this.z, yaw = this.yaw) {
    const c = this.carried;
    const [wx, wz] = toWorld({ x, z, yaw }, c.lx, c.lz);
    return { x: wx, z: wz, yaw: yaw + c.relYaw, bottom: this.forkY + FORK.thickness - PALLET.pocketHigh };
  }

  // Analizza come le forche stanno entrando in un pallet fermo.
  insertion(p, pallets, x = this.x, z = this.z, yaw = this.yaw, forkY = this.forkY, spread = this.spread) {
    const [lx, lz] = toLocal({ x, z, yaw }, p.x, p.z);
    if (lz < -1 || lz > 3.5 || Math.abs(lx) > 2.5) return null;
    const pr = pallets.rect(p);
    const forks = this.forkRects(x, z, yaw, spread);
    const overlapping = forks.some((f) => rectsOverlap(f, pr));
    if (!overlapping) return null;
    const dy = wrapAngle(p.yaw - yaw);
    const k = Math.round(dy / QUARTER);
    const err = dy - k * QUARTER;
    const aligned = Math.abs(err) < 0.2;
    const inHeight = forkY >= p.bottom + PALLET.pocketLow - 0.035
      && forkY + FORK.thickness <= p.bottom + PALLET.pocketHigh + 0.02;
    const dL = -spread / 2 - lx, dR = spread / 2 - lx;
    const inPockets = dL < -0.12 && dL > -0.41 && dR > 0.12 && dR < 0.41;
    const nearFace = lz - PALLET.size / 2;
    const notTooDeep = nearFace >= FORK.baseZ - 0.03;
    const depth = FORK.baseZ + FORK.length - nearFace;
    return { valid: aligned && inHeight && inPockets && notTooDeep, depth, lx, lz, dy, aligned, inPockets };
  }

  // true se la posa candidata urta qualcosa.
  collides(env, x, z, yaw, forkY = this.forkY, spread = this.spread) {
    const body = this.bodyRect(x, z, yaw);
    const forks = this.forkRects(x, z, yaw, spread);
    const carried = this.carried ? this.carriedPose(x, z, yaw) : null;
    const cRect = carried && { x: carried.x, z: carried.z, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw: carried.yaw };
    const cTop = carried && carried.bottom + PALLET.height + this.carried.p.loadH;

    for (const c of env.colliders) {
      if (c.y1 <= 0) continue;
      const r = aabbToRect(c);
      if (verticalOverlap(0.05, BODY.height, c.y0, c.y1) && rectsOverlap(body, r)) return true;
      if (verticalOverlap(forkY, forkY + FORK.thickness, c.y0, c.y1) && forks.some((f) => rectsOverlap(f, r))) return true;
      if (cRect && verticalOverlap(carried.bottom + 0.01, cTop, c.y0, c.y1) && rectsOverlap(cRect, r, 0.0)) return true;
    }
    for (const p of env.pallets.list) {
      if (p.state !== 'rest' || (this.carried && this.carried.p === p)) continue;
      const pr = env.pallets.rect(p);
      const top = env.pallets.top(p);
      if (verticalOverlap(0.05, BODY.height, p.bottom, top) && rectsOverlap(body, pr)) return true;
      if (cRect && verticalOverlap(carried.bottom + 0.01, cTop, p.bottom, top) && rectsOverlap(cRect, pr, -0.02)) return true;
      if (verticalOverlap(forkY, forkY + FORK.thickness, p.bottom, top) && forks.some((f) => rectsOverlap(f, pr))) {
        const ins = this.insertion(p, env.pallets, x, z, yaw, forkY, spread);
        if (!ins || !ins.valid) return true;
      }
    }
    return false;
  }

  update(dt, input, env) {
    const veh = this.vehicle;
    const loadRatio = this.carried ? this.carried.p.weight / veh.capacity : 0;

    // --- Sterzo ---
    if (input.steerTarget !== null) {
      this.steer += (input.steerTarget - this.steer) * Math.min(1, dt * 10);
    } else {
      const target = input.steerAxis;
      const rate = (target === 0 ? 3 : 2.4) * input.sensitivity;
      const d = target - this.steer;
      this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    this.steer = Math.max(-1, Math.min(1, this.steer));

    // --- Marcia, acceleratore, freno ---
    if (input.gear && input.gear !== this.gear && Math.abs(this.v) < 0.3) this.gear = input.gear;
    const maxV = (this.gear > 0 ? veh.speed : veh.speed * 0.6) * (1 - loadRatio * 0.25);
    const prevV = this.v;
    const dir = this.gear;
    if (input.throttle > 0) {
      if (Math.sign(this.v || dir) === dir) {
        this.v += dir * input.throttle * veh.accel * (1 - loadRatio * 0.3) * dt;
      } else {
        // Acceleratore contro il verso di marcia (es. dopo un rimbalzo): frena fino a fermarsi
        const dec = input.throttle * 5 * dt;
        this.v = Math.abs(this.v) <= dec ? 0 : this.v - Math.sign(this.v) * dec;
      }
    }
    if (input.brake > 0) {
      const dec = input.brake * 7 * dt;
      this.v = Math.abs(this.v) <= dec ? 0 : this.v - Math.sign(this.v) * dec;
    }
    if (input.throttle === 0) {
      const roll = 1.2 * dt;
      this.v = Math.abs(this.v) <= roll ? 0 : this.v - Math.sign(this.v) * roll;
    }
    if (Math.abs(this.v) > maxV) this.v = Math.sign(this.v) * maxV;

    // --- Forche ---
    const minFork = this.minForkHeight(env);
    let newForkY = this.forkY + input.lift * 0.55 * dt * (1 - loadRatio * 0.3);
    newForkY = Math.max(minFork, Math.min(veh.lift, newForkY));
    if (input.lift > 0 && this.wouldLiftPallet(env, newForkY)) newForkY = this.forkY;
    let newSpread = Math.max(SPREAD[0], Math.min(SPREAD[1], this.spread + input.spread * 0.3 * dt));
    if (newSpread !== this.spread && !this.carried && this.collides(env, this.x, this.z, this.yaw, this.forkY, newSpread)) {
      newSpread = this.spread;
    }
    if (newForkY !== this.forkY && this.collides(env, this.x, this.z, this.yaw, newForkY, newSpread)) newForkY = this.forkY;
    this.forkY = newForkY;
    this.spread = newSpread;
    this.tilt = Math.max(TILT[0], Math.min(TILT[1], this.tilt + input.tilt * 0.12 * dt));

    // --- Cinematica: modello bicicletta con riferimento sull'asse anteriore ---
    const delta = this.steer * MAX_STEER;
    const yawRate = this.v * Math.tan(delta) / WHEELBASE;
    const nYaw = this.yaw + yawRate * dt;
    const nx = this.x + Math.sin(nYaw) * this.v * dt;
    const nz = this.z + Math.cos(nYaw) * this.v * dt;
    let hit = false;
    if (!this.collides(env, nx, nz, nYaw)) {
      this.x = nx; this.z = nz; this.yaw = nYaw;
    } else if (!this.collides(env, this.x, this.z, nYaw)) {
      this.yaw = nYaw;
      hit = true;
    } else {
      hit = true;
    }
    if (hit) {
      if (Math.abs(this.v) > 1.6 && this.carried) this.dropCarried(env);
      this.v *= -0.15;
      env.onImpact?.(Math.abs(prevV));
    }

    this.updateCarried(dt, env, { yawRate, decel: (Math.abs(prevV) - Math.abs(this.v)) / dt, loadRatio });
    this.checkPickup(env);
    this.wheelSpin += this.v * dt / 0.33;
    this.sync(delta);
  }

  // Altezza minima delle forche: non possono attraversare il pianale o un pallet sotto di esse.
  minForkHeight(env) {
    let min = 0;
    const forks = this.forkRects();
    for (const p of env.pallets.list) {
      if (p.state !== 'rest' || (this.carried && this.carried.p === p)) continue;
      const pr = env.pallets.rect(p);
      if (!forks.some((f) => rectsOverlap(f, pr))) continue;
      const top = env.pallets.top(p);
      if (this.forkY >= top - 0.02) min = Math.max(min, top);
      else if (this.forkY >= p.bottom - 0.01) min = Math.max(min, p.bottom + PALLET.pocketLow - 0.03);
    }
    const bed = env.pallets.truckBed;
    if (bed && this.forkY >= env.truckBedHeight - 0.02 && forks.some((f) => rectsOverlap(f, bed))) {
      min = Math.max(min, env.truckBedHeight);
    }
    return min;
  }

  // Le forche stanno per sollevare un pallet troppo pesante?
  wouldLiftPallet(env, newForkY) {
    if (this.carried) return false;
    for (const p of env.pallets.list) {
      if (p.state !== 'rest') continue;
      const ins = this.insertion(p, env.pallets);
      if (!ins || !ins.valid) continue;
      if (newForkY + FORK.thickness > p.bottom + PALLET.pocketHigh + 0.005 && p.weight > this.vehicle.capacity) {
        // resta appena sotto la soglia di presa
        this.emit('tooHeavy');
        return true;
      }
    }
    return false;
  }

  checkPickup(env) {
    if (this.carried) return;
    for (const p of env.pallets.list) {
      if (p.state !== 'rest') continue;
      const ins = this.insertion(p, env.pallets);
      if (!ins || !ins.valid) continue;
      // Le forche toccano il piano superiore della tasca: il pallet si solleva.
      if (this.forkY + FORK.thickness >= p.bottom + PALLET.pocketHigh + 0.01) {
        this.carried = { p, lx: ins.lx, lz: ins.lz, relYaw: ins.dy, shallow: ins.depth < 0.55, time: 0 };
        p.state = 'carried';
        this.emit('pickup');
        return;
      }
    }
  }

  updateCarried(dt, env, { yawRate, decel, loadRatio }) {
    const c = this.carried;
    if (!c) return;
    c.time += dt;
    const pose = this.carriedPose();
    const p = c.p;
    p.x = pose.x; p.z = pose.z; p.yaw = pose.yaw; p.bottom = pose.bottom;
    const support = env.pallets.supportAt(p, p.bottom + 0.05);
    const lifted = p.bottom - support;

    // Appoggiato: il pallet si stacca dalle forche
    if (lifted <= 0.002) {
      p.bottom = support;
      p.state = 'rest';
      this.carried = null;
      env.pallets.sync(p, 0);
      this.emit('place');
      return;
    }

    // Stabilita' del carico
    const h = this.forkY;
    const speed = Math.abs(this.v);
    const fork = (side) => side * this.spread / 2 - c.lx;
    const outside = Math.abs(fork(-1)) > 0.58 || Math.abs(fork(1)) > 0.58;
    const spreadBonus = (this.spread - 0.5) * 2.2;
    const latLimit = 3.4 - 0.35 * h - 1.1 * loadRatio + spreadBonus;
    const brakeLimit = 4.6 - 0.45 * h + this.tilt * 14 - loadRatio;
    let reason = null;
    if (outside) reason = 'widen';
    else if (c.shallow && lifted > 0.08 && c.time > 0.4) reason = 'insertDeeper';
    else if (Math.abs(this.v * yawRate) > latLimit) reason = 'dropped';
    else if (decel > brakeLimit && speed > 0.5) reason = 'dropped';
    else if (this.tilt < -0.03 && speed > 0.8 && h > 0.3) this.unstable += dt;
    else if (this.spread < 0.38 && loadRatio > 0.5 && speed > 0.5) {
      this.unstable += dt;
      if (this.unstable > 0.8) reason = 'widen';
    } else this.unstable = Math.max(0, this.unstable - dt);
    if (this.unstable > 1.0 && !reason) reason = 'dropped';

    if (reason) {
      this.emit(reason);
      this.dropCarried(env);
      return;
    }
    env.pallets.sync(p, -this.tilt);
  }

  dropCarried(env) {
    if (!this.carried) return;
    const p = this.carried.p;
    this.carried = null;
    this.unstable = 0;
    env.pallets.drop(p);
    this.emit('dropped');
  }

  emit(type) {
    if (!this.events.includes(type)) this.events.push(type);
  }

  sync(delta = this.steer * MAX_STEER) {
    const m = this.model;
    if (!m) return;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.yaw;
    m.mastPivot.rotation.x = -this.tilt;
    m.carriage.position.y = this.forkY - m.mastPivot.position.y;
    m.inner.position.y = Math.max(0, this.forkY - 1.6);
    m.forkL.position.x = -this.spread / 2;
    m.forkR.position.x = this.spread / 2;
    m.rearWheels.forEach((w) => { w.rotation.y = -delta; });
    [...m.frontWheels, ...m.rearWheels].forEach((w) => {
      w.getChildMeshes()[0].rotation.x = this.wheelSpin;
    });
  }
}
