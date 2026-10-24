import { createPalletModel, PALLET, TRUCK } from './models.js';
import { rectsOverlap } from './physics.js';

const HALF = PALLET.size / 2;

export class PalletManager {
  constructor(scene, mats, shadowGen) {
    this.scene = scene;
    this.mats = mats;
    this.shadowGen = shadowGen;
    this.list = [];
    this.truckBed = null; // rettangolo del pianale { x, z, hw, hd, yaw }
    this.nextId = 1;
  }

  async spawn({ x, z, yaw = 0, bottom = 0, weight, loadH, fragile }) {
    const node = await createPalletModel(this.scene, this.mats, { loadHeight: loadH, fragile });
    node.getChildMeshes().forEach((m) => {
      this.shadowGen?.addShadowCaster(m);
      m.receiveShadows = true;
    });
    const p = {
      id: this.nextId++, x, z, yaw, bottom, weight, loadH, fragile, node,
      state: 'rest', vy: 0, dropped: false, tiltX: 0, tiltZ: 0,
    };
    this.list.push(p);
    this.sync(p);
    return p;
  }

  clear() {
    this.list.forEach((p) => p.node.dispose());
    this.list = [];
  }

  top(p) {
    return p.bottom + PALLET.height + p.loadH;
  }

  rect(p, x = p.x, z = p.z, yaw = p.yaw) {
    return { x, z, hw: HALF, hd: HALF, yaw };
  }

  // Altezza della superficie su cui il pallet si appoggerebbe (terra, pianale o altro pallet).
  supportAt(p, below = Infinity) {
    let h = 0;
    const r = this.rect(p);
    if (this.truckBed && this.onTruck(p)) h = TRUCK.bedHeight;
    for (const o of this.list) {
      if (o === p || o.state !== 'rest') continue;
      const t = this.top(o);
      if (t <= below + 0.02 && t > h && rectsOverlap(r, this.rect(o), -0.25)) h = t;
    }
    return h;
  }

  // Il centro del pallet e' sul pianale del camion.
  onTruck(p) {
    const b = this.truckBed;
    if (!b) return false;
    const dx = p.x - b.x, dz = p.z - b.z;
    return Math.abs(dx) <= b.hw && Math.abs(dz) <= b.hd;
  }

  // dx, dz: scivolamento orizzontale durante la caduta (via dalle forche)
  drop(p, dx = 0, dz = 0) {
    p.state = 'falling';
    p.vy = 0;
    p.dropped = true;
    p.slide = { x: p.x + dx, z: p.z + dz };
    p.tiltX = (Math.random() - 0.5) * 0.3;
    p.tiltZ = (Math.random() - 0.5) * 0.3;
    // Rotazione contenuta: il pallet resta riprendibile allineando il muletto
    p.yaw += (Math.random() - 0.5) * 0.3;
  }

  update(dt) {
    for (const p of this.list) {
      if (p.state !== 'falling') continue;
      if (p.slide) {
        const dx = p.slide.x - p.x, dz = p.slide.z - p.z;
        const dist = Math.hypot(dx, dz);
        const step = Math.min(dist, 3 * dt);
        if (dist > 1e-3) {
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          if (p.bottom < 0.4 && dist > 0.05) p.vy = Math.max(p.vy, 0); // finisce di scivolare prima di toccare terra
        } else p.slide = null;
      }
      p.vy -= 9.81 * dt;
      p.bottom += p.vy * dt;
      const s = this.supportAt(p, p.bottom + 0.5);
      if (p.bottom <= s) {
        p.bottom = s;
        p.state = 'rest';
        p.slide = null;
        p.tiltX *= 0.3;
        p.tiltZ *= 0.3;
      }
      this.sync(p);
    }
  }

  sync(p, tiltX = p.tiltX) {
    p.node.position.set(p.x, p.bottom, p.z);
    p.node.rotation.set(tiltX, p.yaw, p.tiltZ);
  }
}
