import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { tryLoadGLB } from './models.js';
import { addBlobShadow } from './blobshadow.js';
import { WAREHOUSES } from '../data.js';
import { plotToWorld } from './world.js';
import { wrapAngle } from './physics.js';

// Persone a piedi vicino al giocatore (Tripo 3D con scheletro e animazioni camminata/fermo).
// Camminano sul marciapiede e davanti ai capannoni; si fermano (e guardano) quando arriva un muletto.
const MODELS = ['person-worker.glb', 'person-office.glb'];
const CAST = [0, 1, 0]; // due operai e un impiegato
const SPEED = 1.25;
const STOP_DIST = 4.2; // muletto piu' vicino di cosi' (davanti): si ferma
const GO_DIST = 5.5; // riparte quando e' piu' lontano
const SIDEWALK_W = 8.3; // marciapiede tra la strada e il piazzale
const FRONT_W = 28; // passaggio davanti al capannone
const SPUR_U = 9.6; // vialetto tra il posto del camion e la zona degli operai
const ROAM = 40; // quanto lontano dal lotto del giocatore

const rnd = (a, b) => a + Math.random() * (b - a);

export class People {
  constructor(scene, env) {
    this.scene = scene;
    this.env = env;
    this.list = [];
  }

  async init() {
    const conts = await Promise.all(MODELS.map((f) => tryLoadGLB(this.scene, f)));
    if (conts.some((c) => !c)) return;
    for (const [i, kind] of CAST.entries()) {
      const root = new TransformNode(`person${i}`, this.scene);
      const inst = conts[kind].instantiateModelsToScene((n) => `person${i}_${n}`, false);
      // nel file la persona guarda verso -x: girata in modo che guardi verso +z (avanti per il gioco)
      const body = new TransformNode(`personBody${i}`, this.scene);
      body.parent = root;
      body.rotation.y = Math.PI / 2;
      inst.rootNodes.forEach((n) => { n.parent = body; });
      const anims = {};
      for (const g of inst.animationGroups) {
        g.stop();
        anims[/walk/i.test(g.name) ? 'walk' : 'idle'] = g;
      }
      root.getChildMeshes().forEach((m) => { m.isPickable = false; });
      addBlobShadow(this.scene, root, 1.2, 1.2);
      const col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 1.8, tag: 'person' };
      this.env.colliders.push(col);
      const p = { root, anims, col, x: 0, z: 0, yaw: 0, route: [], wait: 0, stopped: false, anim: null, enabled: true };
      this.list.push(p);
      this.play(p, 'idle');
    }
  }

  play(p, name) {
    if (p.anim === name) return;
    p.anims[p.anim]?.stop();
    p.anim = name;
    p.anims[name]?.start(true, name === 'walk' ? SPEED / 1.25 : 1);
    if (p.far) p.anims[name]?.pause(); // da lontano la muove updateLod
    p.frame = null;
  }

  // Da lontano (oltre 25 m) l'animazione si aggiorna ~7 volte al secondo invece che a ogni fotogramma
  updateLod(p, dt, dist) {
    const g = p.anims[p.anim];
    if (!g) return;
    const far = dist > 25;
    if (far !== p.far) {
      p.far = far;
      if (far) g.pause(); else g.play(true);
      p.frame = null;
      p.lodT = 0;
    }
    if (!far) return;
    p.lodT = (p.lodT || 0) + dt;
    if (p.lodT < 0.15) return;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond || 30;
    const len = Math.max(1, g.to - g.from);
    p.frame = g.from + (((p.frame ?? g.from) - g.from + p.lodT * fps * g.speedRatio) % len);
    g.goToFrame(p.frame);
    p.lodT = 0;
  }

  // Lotto di riferimento: quello del giocatore (o il piu' vicino)
  homeOf(player) {
    let best = WAREHOUSES[0], d = Infinity;
    for (const wh of WAREHOUSES) {
      const dd = Math.hypot(wh.cx - player.x, wh.side * 30 - player.z);
      if (dd < d) { d = dd; best = wh; }
    }
    return best;
  }

  // Nuovo giro: un punto del marciapiede o davanti al capannone, passando dal vialetto
  plan(p, wh) {
    const onSidewalk = Math.abs(Math.abs(p.z) - SIDEWALK_W) < 1;
    const toFront = Math.random() < 0.4;
    const [sx, sz] = plotToWorld(wh, SPUR_U, SIDEWALK_W);
    const [fx, fz] = plotToWorld(wh, SPUR_U, FRONT_W);
    if (toFront) {
      const [tx, tz] = plotToWorld(wh, rnd(-11, SPUR_U), FRONT_W);
      p.route = onSidewalk ? [[sx, sz], [fx, fz], [tx, tz]] : [[tx, tz]];
    } else {
      const tx = wh.cx + rnd(-ROAM, ROAM), tz = wh.side * SIDEWALK_W;
      p.route = onSidewalk ? [[tx, tz]] : [[fx, fz], [sx, sz], [tx, tz]];
    }
  }

  place(p, wh) {
    // compare sul marciapiede, a qualche decina di metri
    p.x = wh.cx + rnd(-ROAM, ROAM);
    p.z = wh.side * SIDEWALK_W;
    p.route = [];
    p.wait = rnd(0, 2);
  }

  // forklifts: il muletto del giocatore e quelli degli operai
  update(dt, player, forklifts) {
    if (!this.list.length || !player) return;
    const wh = this.homeOf(player);
    for (const p of this.list) {
      if (Math.hypot(p.x - player.x, p.z - player.z) > 75 || !p.placed) {
        p.placed = true;
        this.place(p, wh);
      }
      // muletto vicino davanti (o vicinissimo): si ferma e lo guarda
      let near = null, nd = Infinity;
      for (const f of forklifts) {
        if (!f) continue;
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        if (d < nd) { nd = d; near = f; }
      }
      if (near) {
        const toF = Math.atan2(near.x - p.x, near.z - p.z);
        const inFront = Math.abs(wrapAngle(toF - p.yaw)) < 1.4;
        if (!p.stopped && nd < (inFront ? STOP_DIST : 2.4)) p.stopped = true;
        else if (p.stopped && nd > GO_DIST) p.stopped = false;
        if (p.stopped) p.yaw += wrapAngle(toF - p.yaw) * Math.min(1, dt * 3);
      } else p.stopped = false;

      if (p.stopped || p.wait > 0) {
        p.wait -= dt;
        this.play(p, 'idle');
      } else {
        if (!p.route.length) this.plan(p, wh);
        const [tx, tz] = p.route[0];
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        // un'altra persona proprio davanti: aspetta che passi (quella con l'indice piu' basso ha la precedenza)
        const blocked = this.list.some((o) => o !== p && this.list.indexOf(o) < this.list.indexOf(p)
          && Math.hypot(o.x - p.x, o.z - p.z) < 0.9 && ((o.x - p.x) * dx + (o.z - p.z) * dz) > 0);
        if (blocked) {
          this.play(p, 'idle');
        } else if (d < 0.15) {
          p.route.shift();
          if (!p.route.length) p.wait = rnd(1.5, 5);
        } else {
          const step = Math.min(d, SPEED * dt);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.yaw += wrapAngle(Math.atan2(dx, dz) - p.yaw) * Math.min(1, dt * 6);
          this.play(p, 'walk');
        }
      }
      this.updateLod(p, dt, Math.hypot(p.x - player.x, p.z - player.z));
      p.root.position.set(p.x, 0, p.z);
      p.root.rotation.y = p.yaw;
      Object.assign(p.col, { minX: p.x - 0.28, maxX: p.x + 0.28, minZ: p.z - 0.28, maxZ: p.z + 0.28 });
    }
  }
}
