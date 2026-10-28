import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { tryLoadGLB, instantiateGLB, mergeByMaterial } from './models.js';
import { WORLD } from '../data.js';

// Traffico sulla strada principale: poche macchine (Tripo 3D, carrozzeria bianca tinta di colori diversi).
// Frenano davanti al muletto, al camion e alle altre macchine; se il muletto resta davanti suonano il clacson.
const MODELS = [
  { file: 'car-sedan.glb', yaw: 0 }, // yaw: rotazione che porta il muso del modello verso +x
  { file: 'car-hatch.glb', yaw: Math.PI / 2 },
];
const PAINT = ['#c8312b', '#1f4f9c', '#2b2d31', '#e8e8e8', '#8a9097', '#2f6b3f', '#d9a21b', '#6b2a45'];
const CARS = 3;
const LANE_Z = 3.5; // corsia verso +x a z = +3,5, verso -x a z = -3,5
const X_END = WORLD.maxX + WORLD.roadOut - 10;
const ACC = 2.2, DEC = 5.5, GAP = 3.5;

export class Traffic {
  constructor(scene, env, audio) {
    this.scene = scene;
    this.env = env;
    this.audio = audio;
    this.cars = [];
    this.lightsOn = false;
  }

  async init() {
    const conts = await Promise.all(MODELS.map((m) => tryLoadGLB(this.scene, m.file)));
    if (conts.some((c) => !c)) return;
    const pool = this.makeHeadlightPool();
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
        const b = m.getBoundingInfo().boundingBox;
        min = Math.min(min, b.minimumWorld.x); max = Math.max(max, b.maximumWorld.x);
        hw = Math.max(hw, Math.abs(b.minimumWorld.z), Math.abs(b.maximumWorld.z));
      }
      const front = max, rear = min;
      // fari: due luci davanti, due rosse dietro e una macchia di luce sull'asfalto (accese di notte e col brutto tempo)
      const lights = new TransformNode(`carLights${i}`, this.scene);
      lights.parent = root;
      const lamp = (name, x, z, mat, s) => {
        const d = MeshBuilder.CreateDisc(name, { radius: s, tessellation: 10 }, this.scene);
        d.parent = lights;
        d.position.set(x, 0.68, z);
        d.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        d.material = mat;
        return d;
      };
      const parts = [
        lamp('head', front + 0.02, hw * 0.62, this.lampMat('#fff6d8'), 0.11),
        lamp('head', front + 0.02, -hw * 0.62, this.lampMat('#fff6d8'), 0.11),
        lamp('tail', rear - 0.02, hw * 0.65, this.lampMat('#ff2a1a'), 0.08),
        lamp('tail', rear - 0.02, -hw * 0.65, this.lampMat('#ff2a1a'), 0.08),
      ];
      const beam = pool.clone(`carBeam${i}`);
      beam.parent = lights;
      beam.position.set(front + 6, 0.035, 0);
      mergeByMaterial(parts, lights, `carLamps${i}`);
      lights.setEnabled(false);
      const col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 1.5, tag: 'car' };
      this.env.colliders.push(col);
      const car = { root, meshes, lights, col, front, rear, hw, v: 0, blockT: 0, hornT: 0 };
      this.cars.push(car);
      this.respawn(car, true);
    }
    pool.dispose();
  }

  lampMat(hex) {
    const m = new StandardMaterial(`lamp${hex}`, this.scene);
    m.emissiveColor = Color3.FromHexString(hex);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    return m;
  }

  // Macchia di luce allungata davanti alla macchina (finta luce additiva, nessuna luce vera)
  makeHeadlightPool() {
    // la texture va lungo x: chiara a sinistra (vicino al muso), sfuma in avanti
    const tex = new DynamicTexture('beamTex', { width: 128, height: 64 }, this.scene, true);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(6, 32, 4, 60, 32, 64);
    g.addColorStop(0, 'rgba(255,240,200,0.7)');
    g.addColorStop(0.5, 'rgba(255,235,190,0.25)');
    g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
    tex.update();
    tex.hasAlpha = true;
    const mat = new StandardMaterial('beamMat', this.scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    // lungo l'asse x della macchina: 11 m davanti, 4 m di larghezza
    const p = MeshBuilder.CreateGround('beam', { width: 11, height: 4 }, this.scene);
    p.material = mat;
    p.isPickable = false;
    return p;
  }

  // Nuova macchina a un capo della strada, su una corsia a caso, lontano dalle altre
  respawn(car, anywhere = false) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    car.dir = dir;
    car.z = dir > 0 ? LANE_Z : -LANE_Z;
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

  setLights(on) {
    if (on === this.lightsOn) return;
    this.lightsOn = on;
    for (const c of this.cars) c.lights.setEnabled(on);
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

