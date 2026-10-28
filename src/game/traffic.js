import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { tryLoadGLB, instantiateGLB } from './models.js';
import { createHeadlights, snapZ } from './headlights.js';
import { addBlobShadow } from './blobshadow.js';
import { WORLD } from '../data.js';

// Traffico sulla strada principale: poche macchine (Tripo 3D, carrozzeria bianca tinta di colori diversi).
// Frenano davanti al muletto, al camion e alle altre macchine; se il muletto resta davanti suonano il clacson.
const MODELS = [
  // yaw: rotazione che porta il muso del modello verso +x; lamp/tail: altezza (m) e distanza dal centro (frazione)
  { file: 'car-sedan.glb', yaw: Math.PI, lampY: 0.72, lampX: 0.66, tailY: 0.86, tailX: 0.7 },
  { file: 'car-hatch.glb', yaw: Math.PI / 2, lampY: 0.78, lampX: 0.64, tailY: 0.95, tailX: 0.72 },
];
const PAINT = ['#c8312b', '#1f4f9c', '#2b2d31', '#e8e8e8', '#8a9097', '#2f6b3f', '#d9a21b', '#6b2a45'];
const CARS = 3;
const LANE_Z = 3.5; // si guida a destra: verso +x sulla corsia z = -3,5, verso -x su z = +3,5
const X_END = WORLD.maxX + WORLD.roadOut - 10;
const ACC = 2.2, DEC = 5.5, GAP = 3.5;

export class Traffic {
  constructor(scene, env, audio) {
    this.scene = scene;
    this.env = env;
    this.audio = audio;
    this.cars = [];
  }

  async init() {
    const conts = await Promise.all(MODELS.map((m) => tryLoadGLB(this.scene, m.file)));
    if (conts.some((c) => !c)) return;
    for (let i = 0; i < CARS; i++) {
      const kind = i % MODELS.length, M = MODELS[kind];
      const root = new TransformNode(`car${i}`, this.scene);
      const body = new TransformNode(`carBody${i}`, this.scene);
      body.parent = root;
      body.rotation.y = M.yaw;
      const inst = instantiateGLB(conts[kind], body, `car${i}`);
      // vernice: il materiale bianco del modello, tinto (copia per ogni macchina)
      const meshes = inst.rootNodes[0].getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
      for (const m of meshes) {
        m.material = m.material.clone(`carPaint${i}`);
        m.isPickable = false;
      }
      root.computeWorldMatrix(true);
      let min = Infinity, max = -Infinity, hw = 0;
      for (const m of meshes) {
        m.computeWorldMatrix(true); // dopo la rotazione del modello (l'utilitaria nel file e' girata)
        const b = m.getBoundingInfo().boundingBox;
        min = Math.min(min, b.minimumWorld.x); max = Math.max(max, b.maximumWorld.x);
        hw = Math.max(hw, Math.abs(b.minimumWorld.z), Math.abs(b.maximumWorld.z));
      }
      const front = max, rear = min;
      // fanali finti (accesi di notte e col brutto tempo): lenti appoggiate sulla carrozzeria, aloni, fascio
      const lights = new TransformNode(`carLights${i}`, this.scene);
      lights.parent = root;
      lights.rotation.y = Math.PI / 2; // i fanali guardano +z: girati verso il muso (+x)
      const lx = hw * M.lampX, tx = hw * M.tailX;
      const onFront = (x, y) => snapZ(lights, meshes, x, y, front + 1, front - 1.5) ?? front;
      const onRear = (x, y) => snapZ(lights, meshes, x, y, rear - 1, rear + 1.5) ?? rear;
      createHeadlights(this.scene, `carLamps${i}`, {
        lamps: [[lx, M.lampY, onFront(lx, M.lampY)], [-lx, M.lampY, onFront(-lx, M.lampY)]],
        tails: [[tx, M.tailY, onRear(tx, M.tailY)], [-tx, M.tailY, onRear(-tx, M.tailY)]],
        lens: [0.24, 0.09], tailLens: [0.2, 0.07], glow: 0.14,
        beam: { z0: front + 0.3, z1: front + 18, w0: hw * 1.5, w1: 9 },
      }, lights);
      addBlobShadow(this.scene, root, (front - rear) * 1.3, hw * 2 + 1.2, (front + rear) / 2, 0);
      const col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 1.5, tag: 'car' };
      this.env.colliders.push(col);
      const car = { root, meshes, col, front, rear, hw, v: 0, blockT: 0, hornT: 0 };
      this.cars.push(car);
      this.respawn(car, true);
    }
  }

  // Nuova macchina a un capo della strada, su una corsia a caso, lontano dalle altre
  respawn(car, anywhere = false) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    car.dir = dir;
    car.z = dir > 0 ? -LANE_Z : LANE_Z;
    car.vmax = 8 + Math.random() * 3.5;
    car.v = car.vmax;
    let x = anywhere ? (Math.random() * 2 - 1) * (X_END - 20) : -dir * X_END;
    for (let k = 0; k < 6; k++) {
      if (!this.cars.some((o) => o !== car && o.dir === dir && Math.abs(o.x - x) < 25)) break;
      x -= dir * 30;
    }
    car.x = x;
    const paint = Color3.FromHexString(PAINT[Math.floor(Math.random() * PAINT.length)]);
    for (const m of car.meshes) m.material.albedoColor = paint;
    car.root.rotation.y = dir > 0 ? 0 : Math.PI;
    car.blockT = 0;
  }

  // obstacles: rettangoli { minX, maxX, minZ, maxZ } da rispettare (camion del contratto, persone); forklift: il muletto
  update(dt, forklift, obstacles = []) {
    for (const car of this.cars) {
      const ahead = (x) => (x - car.x) * car.dir; // distanza in avanti dal centro
      const frontOff = car.dir > 0 ? car.front : -car.rear;
      let gap = Infinity, byForklift = false;
      const z0 = car.z - car.hw - 0.4, z1 = car.z + car.hw + 0.4;
      const consider = (minX, maxX, minZ, maxZ, fk) => {
        if (maxZ < z0 || minZ > z1) return;
        const near = car.dir > 0 ? minX : maxX;
        const far = car.dir > 0 ? maxX : minX;
        const d = ahead(near) - frontOff;
        if (ahead(far) < 0 || d > 40) return; // gia' dietro o troppo lontano
        const g = Math.max(0, d);
        if (g < gap) { gap = g; byForklift = fk; }
      };
      if (forklift) {
        // ingombro del muletto (corpo + forche) girato secondo il suo orientamento
        const hl = 2.6 * forklift.geo.s, hw = forklift.geo.body.hw + 0.1;
        const sn = Math.abs(Math.sin(forklift.yaw)), cs = Math.abs(Math.cos(forklift.yaw));
        const ex = sn * hl + cs * hw, ez = cs * hl + sn * hw;
        consider(forklift.x - ex, forklift.x + ex, forklift.z - ez, forklift.z + ez, true);
      }
      for (const o of obstacles) consider(o.minX, o.maxX, o.minZ, o.maxZ, false);
      for (const o of this.cars) {
        if (o === car || o.dir !== car.dir) continue;
        consider(o.col.minX, o.col.maxX, o.col.minZ, o.col.maxZ, false);
      }
      const want = Math.min(car.vmax, Math.sqrt(2 * DEC * 0.6 * Math.max(0, gap - GAP)));
      car.v += Math.max(-DEC * dt, Math.min(ACC * dt, want - car.v));
      // ostacolo comparso all'improvviso a ridosso: frenata secca, mai attraverso
      if (car.v < 0 || gap < 0.4) car.v = 0;
      car.x += car.v * car.dir * dt;
      // fermi per colpa del muletto: dopo 2 s il clacson, poi ogni 4 s
      if (byForklift && car.v < 0.3) {
        car.blockT += dt;
        car.hornT -= dt;
        if (car.blockT > 2 && car.hornT <= 0) {
          car.hornT = 4;
          this.audio?.horn(Math.hypot(forklift.x - car.x, forklift.z - car.z));
        }
      } else {
        car.blockT = 0;
        car.hornT = 0;
      }
      if (ahead(car.dir * X_END) < 0) this.respawn(car);
      car.root.position.set(car.x, 0, car.z);
      // ostacolo per il muletto (girata di 180 gradi verso -x)
      car.col.minX = car.dir > 0 ? car.x + car.rear : car.x - car.front;
      car.col.maxX = car.dir > 0 ? car.x + car.front : car.x - car.rear;
      car.col.minZ = car.z - car.hw;
      car.col.maxZ = car.z + car.hw;
    }
  }

  dispose() {
    for (const c of this.cars) {
      const i = this.env.colliders.indexOf(c.col);
      if (i >= 0) this.env.colliders.splice(i, 1);
      c.root.dispose(false, true);
    }
    this.cars = [];
  }
}

