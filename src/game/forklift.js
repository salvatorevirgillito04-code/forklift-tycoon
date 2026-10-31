import { createForkliftModel, vehicleGeometry, FORK, PALLET } from './models.js';
import { rectsOverlap, aabbToRect, aabbIntoRect, verticalOverlap, toLocal, toWorld, wrapAngle } from './physics.js';

const TMP_RECT = { x: 0, z: 0, hw: 0, hd: 0, yaw: 0 };

const MAX_STEER = 1.05; // rad, angolo massimo ruote posteriori
// Guida (valori di un muletto vero, poi 'assistiti' per il telefono)
const BRAKE_DECEL = 4.5; // m/s^2 col freno di servizio (a vuoto, asciutto)
const ENGINE_DECEL = 1.6; // m/s^2 rilasciando l'acceleratore (freno motore / recupero)
const BRAKE_RAMP = 0.15; // s per arrivare alla frenata piena (niente strappi)
// Sterzo (idroguida): corsa al secondo da fermo, con frecce e con volante/giroscopio; piu' lenta andando forte
export const STEER = {
  rateArrows: 3.2, // da fermo: fine corsa in ~0,3 s
  rateTarget: 5.0, // volante e giroscopio seguono il dito: fine corsa in ~0,2 s (come nella 2.9.0)
  rateSpeed: 5.0, // m/s: a questa velocita' la corsa e' dimezzata
  centerBoost: 1.3, // frecce rilasciate: lo sterzo torna al centro un po' piu' in fretta
  lat: 5.0, // m/s^2: a velocita' alta l'angolo di sterzo e' limitato a questa accelerazione laterale
  yawK: 30, // risposta del telaio allo sterzo (1/s), sull'asciutto
};
const CURVE_LAT = 2.6; // m/s^2: oltre questa accelerazione laterale il mezzo rallenta da solo in curva
const CURVE_DECEL = 3.0; // m/s^2 di rallentamento automatico in curva
const SLIDE_MAX_COS = 0.6; // urto di striscio (scivola) se il moto e' quasi parallelo al muro
const SLIDE_MAX_VN = 1.4; // m/s: oltre questa velocita' contro il muro e' un urto, non uno strisciamento
const SCRAPE_DECEL = 1.5; // m/s^2 di attrito strisciando contro il muro
const SPREAD = [0.25, 1.0];
const TILT = [-0.09, 0.17]; // negativo = in avanti
const QUARTER = Math.PI / 2;
const WHEEL_TURNS = Math.PI * 1.5; // rotazione del volante a fine corsa

export class Forklift {
  constructor(scene, mats, vehicle) {
    this.scene = scene;
    this.mats = mats;
    this.vehicle = vehicle;
    this.geo = vehicleGeometry(vehicle); // misure del mezzo (corpo, passo, montante)
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
    this.rates = { lift: 0, spread: 0, tilt: 0 }; // velocita' idrauliche (con inerzia)
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
    if (this.carried) this.carried.p.node.parent = null;
    // il tetto ha un materiale proprio (copia, con le sue texture): va liberato, altrimenti restava a ogni contratto
    const roofMats = new Set((this.model?.roof || []).map((m) => m.material).filter(Boolean));
    this.model?.root.dispose();
    roofMats.forEach((m) => m.dispose(false, true));
  }

  place(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.v = 0; this.steer = 0;
    if (this.carried) this.carried.p.node.parent = null;
    this.carried = null;
    this.forkY = 0.05;
    this.sync();
  }

  get frame() {
    return { x: this.x, z: this.z, yaw: this.yaw };
  }

  bodyRect(x = this.x, z = this.z, yaw = this.yaw) {
    const cz = (this.geo.body.z0 + this.geo.body.z1) / 2;
    const [wx, wz] = toWorld({ x, z, yaw }, 0, cz);
    return { x: wx, z: wz, hw: this.geo.body.hw, hd: (this.geo.body.z1 - this.geo.body.z0) / 2, yaw };
  }

  forkRects(x = this.x, z = this.z, yaw = this.yaw, spread = this.spread) {
    const cz = this.geo.forkBase + FORK.length / 2;
    return [-1, 1].map((side) => {
      const [wx, wz] = toWorld({ x, z, yaw }, side * spread / 2, cz);
      return { x: wx, z: wz, hw: FORK.width / 2, hd: FORK.length / 2, yaw, side };
    });
  }

  carriedPose(x = this.x, z = this.z, yaw = this.yaw) {
    const c = this.carried;
    const [wx, wz] = toWorld({ x, z, yaw }, c.lx, c.lz);
    return { x: wx, z: wz, yaw: yaw + c.relYaw, bottom: this.forkY + c.off };
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
    const notTooDeep = nearFace >= this.geo.forkBase - 0.03;
    const depth = this.geo.forkBase + FORK.length - nearFace;
    return { valid: aligned && inHeight && inPockets && notTooDeep, depth, lx, lz, dy, aligned, inPockets };
  }

  // true se la posa candidata urta qualcosa.
  collides(env, x, z, yaw, forkY = this.forkY, spread = this.spread) {
    const c = this.contacts(env, x, z, yaw, forkY, spread);
    return c === null || c.length > 0;
  }

  // null se la posa urta un ostacolo fisso, altrimenti l'elenco dei pallet urtati.
  contacts(env, x, z, yaw, forkY = this.forkY, spread = this.spread) {
    const body = this.bodyRect(x, z, yaw);
    const forks = this.forkRects(x, z, yaw, spread);
    // Le punte si alzano/abbassano con l'inclinazione: l'ingombro verticale delle forche lo include
    const tipY = forkY + Math.sin(this.tilt) * this.geo.tipArm;
    const fy0 = Math.min(forkY, tipY), fy1 = Math.max(forkY, tipY) + FORK.thickness;
    // Carrello porta-forche con griglia, e parte alta del montante quando e' sfilato
    const [cx, cz] = toWorld({ x, z, yaw }, 0, this.geo.forkBase - 0.07);
    const carriage = { x: cx, z: cz, hw: 0.5, hd: 0.05, yaw };
    const [mx, mz] = toWorld({ x, z, yaw }, 0, this.geo.mastZ);
    const mast = { x: mx, z: mz, hw: 0.46, hd: 0.1, yaw };
    const mastTop = this.geo.mastHeight + Math.max(0, forkY - this.geo.freeLift);
    const carried = this.carried ? this.carriedPose(x, z, yaw) : null;
    const cRect = carried && { x: carried.x, z: carried.z, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw: carried.yaw };
    const cTop = carried && carried.bottom + PALLET.height + this.carried.p.loadH;

    for (const c of env.colliders) {
      if (c.y1 <= 0) continue;
      // Scarta subito gli ostacoli lontani (il muletto con forche e carico sta in ~5 m)
      if (c.maxX < x - 5 || c.minX > x + 5 || c.maxZ < z - 5 || c.minZ > z + 5) continue;
      const r = aabbIntoRect(c, TMP_RECT);
      this.blockedBy = c; // l'ostacolo urtato (persone e macchine danno la penalita')
      if (verticalOverlap(0.05, this.geo.body.height, c.y0, c.y1) && rectsOverlap(body, r)) return null;
      if (verticalOverlap(fy0, fy1, c.y0, c.y1) && (rectsOverlap(forks[0], r) || rectsOverlap(forks[1], r))) return null;
      if (!c.noCarriage && verticalOverlap(forkY - 0.05, forkY + 1.32, c.y0, c.y1) && rectsOverlap(carriage, r)) return null;
      if (mastTop > this.geo.body.height && verticalOverlap(this.geo.body.height, mastTop, c.y0, c.y1) && rectsOverlap(mast, r)) return null;
      if (cRect && verticalOverlap(carried.bottom + 0.01, cTop, c.y0, c.y1) && rectsOverlap(cRect, r, 0.0)) return null;
    }
    this.blockedBy = null;
    const hits = [];
    for (const p of env.pallets.list) {
      const hit = this.palletHit(p, env, x, z, yaw, forkY, spread, body, forks, cRect, carried, cTop);
      if (!hit) continue;
      // Gia' incastrato in questo pallet (es. appena caduto): permesso solo allontanarsi
      const stuck = this.stuck?.get(p);
      if (stuck && this.palletDistance(p, stuck.via, x, z, yaw) >= stuck.d - 1e-4) continue;
      hits.push(p);
    }
    return hits;
  }

  // Attrito di primo distacco: un tocco leggero non sposta il pallet; serve tenere
  // il gas contro il pallet per un attimo (di piu' se e' pesante).
  readyToPush(dt, input, hits) {
    if (input.throttle <= 0) { this.pushTime = 0; this.pushGrace = 0; return false; }
    if (this.pushGrace > 0) { this.pushGrace = 0.4; return true; }
    this.pushTime = (this.pushTime || 0) + dt;
    const heavy = hits.reduce((m, p) => Math.max(m, p.weight), 0) / this.vehicle.capacity;
    if (this.pushTime < 0.12 + Math.min(1, heavy) * 0.25) return false;
    this.pushGrace = 0.4;
    return true;
  }

  // Spinge i pallet urtati: si muovono insieme al punto del muletto che li tocca,
  // ruotando se spinti fuori centro. Ritorna false se non si possono spostare.
  pushPallets(env, hits, nx, nz, nYaw) {
    const cur = this.frame;
    const next = { x: nx, z: nz, yaw: nYaw };
    const pallets = env.pallets;
    const saved = hits.map((p) => ({ p, x: p.x, z: p.z, yaw: p.yaw }));
    const restore = () => saved.forEach((o) => { o.p.x = o.x; o.p.z = o.z; o.p.yaw = o.yaw; });
    for (const p of hits) {
      if (p.state !== 'rest' || p.weight > this.vehicle.capacity * 2.5) { restore(); return false; }
      const [lx, lz] = toLocal(cur, p.x, p.z);
      const [wx, wz] = toWorld(next, lx, lz);
      const dx = wx - p.x, dz = wz - p.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) { restore(); return false; }
      // Il pallet spinto segue la traiettoria del muletto (avanti, curve a destra e a sinistra),
      // con un piccolo distacco per non restare compenetrato.
      p.x = wx + (dx / len) * 0.003;
      p.z = wz + (dz / len) * 0.003;
      // In curva il pallet scivola un po' verso l'esterno e ruota leggermente meno del muletto
      const dYaw = nYaw - cur.yaw;
      if (Math.abs(dYaw) > 1e-5) {
        const centerSide = Math.sign(dYaw * Math.sign(this.v || 1)); // lato del centro di curva (x locale)
        const slip = Math.min(0.01, Math.abs(dYaw) * Math.hypot(lx, lz) * 0.3);
        const [ox, oz] = toWorld({ x: 0, z: 0, yaw: nYaw }, -centerSide * slip, 0);
        p.x += ox; p.z += oz;
      }
      p.yaw += dYaw * 0.9;
    }
    // Il pallet spostato non deve entrare in muri, camion o altri pallet
    for (const p of hits) {
      const r = pallets.rect(p);
      const top = pallets.top(p);
      const blocked = env.colliders.some((c) => c.y1 > 0 && verticalOverlap(p.bottom + 0.01, top, c.y0, c.y1) && rectsOverlap(r, aabbToRect(c)))
        || pallets.list.some((o) => o !== p && o.state === 'rest' && !hits.includes(o)
          && verticalOverlap(p.bottom + 0.01, top, o.bottom, pallets.top(o)) && rectsOverlap(r, pallets.rect(o), -0.01));
      if (blocked) { restore(); return false; }
    }
    const still = this.contacts(env, nx, nz, nYaw);
    if (still === null || still.some((p) => !hits.includes(p))) { restore(); return false; }
    if (still.length) { restore(); return false; }
    for (const p of hits) {
      // Spinto oltre il bordo del pianale: cade
      if (pallets.supportAt(p, p.bottom + 0.05) < p.bottom - 0.02) {
        pallets.drop(p);
        this.emit('dropped');
      } else pallets.sync(p);
    }
    return true;
  }

  // Tipo di contatto con un pallet fermo: 'body', 'fork', 'carried' oppure null.
  palletHit(p, env, x, z, yaw, forkY, spread, body, forks, cRect, carried, cTop) {
    if (p.state !== 'rest' || (this.carried && this.carried.p === p)) return null;
    const pr = env.pallets.rect(p);
    const top = env.pallets.top(p);
    if (verticalOverlap(0.05, this.geo.body.height, p.bottom, top) && rectsOverlap(body, pr)) return 'body';
    if (cRect && verticalOverlap(carried.bottom + 0.01, cTop, p.bottom, top) && rectsOverlap(cRect, pr, -0.02)) return 'carried';
    if (verticalOverlap(forkY, forkY + FORK.thickness, p.bottom, top) && forks.some((f) => rectsOverlap(f, pr))) {
      const ins = this.insertion(p, env.pallets, x, z, yaw, forkY, spread);
      if (!ins || !ins.valid) return 'fork';
    }
    return null;
  }

  // Distanza tra il pallet e la parte del muletto che lo tocca (forche o corpo).
  palletDistance(p, via, x, z, yaw) {
    const [rx, rz] = via === 'fork'
      ? toWorld({ x, z, yaw }, 0, this.geo.forkBase + FORK.length / 2)
      : toWorld({ x, z, yaw }, 0, (this.geo.body.z0 + this.geo.body.z1) / 2);
    return Math.hypot(p.x - rx, p.z - rz);
  }

  // Pallet in cui il muletto e' gia' incastrato nella posa attuale.
  findStuck(env) {
    const map = new Map();
    const body = this.bodyRect();
    const forks = this.forkRects();
    const carried = this.carried ? this.carriedPose() : null;
    const cRect = carried && { x: carried.x, z: carried.z, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw: carried.yaw };
    const cTop = carried && carried.bottom + PALLET.height + this.carried.p.loadH;
    for (const p of env.pallets.list) {
      const hit = this.palletHit(p, env, this.x, this.z, this.yaw, this.forkY, this.spread, body, forks, cRect, carried, cTop);
      if (hit) {
        const via = hit === 'fork' ? 'fork' : 'body';
        map.set(p, { via, d: this.palletDistance(p, via, this.x, this.z, this.yaw) });
      }
    }
    return map.size ? map : null;
  }

  // Passo del muletto del giocatore: diviso in sottopassi di al massimo 1/60 s, cosi' sterzo e traiettoria
  // sono gli stessi a 30 e a 60 FPS (con un passo unico piu' lungo la curva veniva un po' piu' stretta)
  step(dt, input, env) {
    const n = Math.max(1, Math.ceil(dt * 60 - 1e-6));
    for (let i = 0; i < n; i++) this.update(dt / n, input, env);
  }

  update(dt, input, env) {
    const veh = this.vehicle;
    this.stuck = this.findStuck(env);
    const loadRatio = this.carried ? this.carried.p.weight / veh.capacity : 0;
    // aderenza del punto in cui si trova (pioggia/neve all'aperto)
    const grip = env.grip?.(this.x, this.z) || { brake: 1, accel: 1, steer: 30, stability: 1 };
    this.grip = grip;

    // --- Sterzo (idroguida: corsa a velocita' limitata, piu' lenta quando si va forte) ---
    // A velocita' alta l'angolo massimo e' ridotto (sterzo assistito): niente sterzate a fondo a tutta velocita'
    const speed = Math.abs(this.v);
    const steerLimit = this.steerLimitAt(speed, loadRatio, grip);
    const asked = input.steerTarget !== null ? input.steerTarget : input.steerAxis;
    const target = Math.max(-steerLimit, Math.min(steerLimit, asked));
    const base = input.steerTarget !== null ? STEER.rateTarget : STEER.rateArrows * (target === 0 ? STEER.centerBoost : 1);
    const rate = base * input.sensitivity / (1 + speed / STEER.rateSpeed);
    const sd = target - this.steer;
    this.steer += Math.sign(sd) * Math.min(Math.abs(sd), rate * dt);
    this.steer = Math.max(-1, Math.min(1, this.steer));

    // Sterzando piu' di quanto permette la velocita', il mezzo rallenta fino alla velocita' in cui quell'angolo e'
    // consentito: lo sterzo arriva dove chiesto senza attese lunghe (prima rallentava solo per l'angolo gia' raggiunto)
    // L'acceleratore non spinge oltre questa velocita' (il controllo in curva vince sul pedale)
    const vCurve = Math.min(this.curveSpeed(this.steer * MAX_STEER, loadRatio, grip),
      Math.abs(asked) > steerLimit + 0.02 ? this.speedForSteer(Math.abs(asked), loadRatio, grip) : Infinity);

    // --- Marcia, acceleratore, freno motore ---
    // La marcia si puo' cambiare anche in movimento: premendo l'acceleratore
    // il muletto rallenta e poi riparte nel nuovo senso (inversione come sui veri muletti).
    if (input.gear && input.gear !== this.gear) this.gear = input.gear;
    const maxV = (this.gear > 0 ? veh.speed : veh.speed * 0.6) * (1 - loadRatio * 0.25);
    const prevV = this.v;
    const dir = this.gear;
    // massa: col carico il muletto accelera e frena piu' piano (inerzia)
    const mass = 1 + loadRatio * 0.45;
    const slow = (amount) => { this.v = Math.abs(this.v) <= amount ? 0 : this.v - Math.sign(this.v) * amount; };
    // Acceleratore analogico: decide la velocita' voluta (10% = passo d'uomo), non solo la spinta
    const throttle = Math.max(0, Math.min(1, input.throttle));
    if (throttle > 0) {
      if (this.v === 0 || Math.sign(this.v) === dir) {
        const want = Math.min(throttle * maxV, vCurve);
        if (Math.abs(this.v) < want) {
          const acc = veh.accel * grip.accel * (1 - loadRatio * 0.3) / mass * (0.45 + 0.55 * throttle);
          this.v = dir * Math.min(want, Math.abs(this.v) + acc * dt);
        } else if (Math.abs(this.v) > throttle * maxV) {
          // pedale rilasciato un po' (il rallentamento in curva e' piu' sotto: non si sommano)
          slow(Math.min(Math.abs(this.v) - throttle * maxV, ENGINE_DECEL * grip.brake / mass * dt));
        }
      } else {
        const dec = (1.2 + throttle * 0.8) * dt; // inversione dolce: max 2 m/s²
        if (Math.abs(this.v) <= dec) {
          // supera lo zero e inizia a muoversi nel nuovo senso
          const left = 1 - Math.abs(this.v) / dec;
          this.v = dir * throttle * veh.accel * dt * left;
        } else this.v -= Math.sign(this.v) * dec;
      }
    }
    // Freno di servizio: entra in 0,15 s (niente strappi), meno efficace col carico e sul bagnato
    this.brakeLevel = input.brake > 0 ? Math.min(input.brake, (this.brakeLevel || 0) + dt / BRAKE_RAMP) : 0;
    if (this.brakeLevel > 0) slow(this.brakeLevel * BRAKE_DECEL * grip.brake / mass * dt);
    else if (throttle === 0) slow(ENGINE_DECEL * grip.brake / mass * dt); // freno motore (non si somma al freno)
    // In curva il mezzo rallenta da solo (come i muletti con controllo di velocita' in curva)
    if (Math.abs(this.v) > vCurve) slow(Math.min(Math.abs(this.v) - vCurve, CURVE_DECEL * dt));
    if (Math.abs(this.v) > maxV) this.v = Math.sign(this.v) * maxV;

    // --- Forche (idraulica con inerzia) ---
    const ease = (k, target, accel) => {
      const r = this.rates[k];
      this.rates[k] = r + Math.sign(target - r) * Math.min(Math.abs(target - r), accel * dt);
      return this.rates[k];
    };
    const liftRate = ease('lift', input.lift * 0.55 * (1 - loadRatio * 0.3), 2.2);
    const spreadRate = ease('spread', input.spread * 0.3, 1.5);
    const tiltRate = ease('tilt', input.tilt * 0.1, 0.5);

    const minFork = Math.max(this.minForkHeight(env), this.tipDrop(this.tilt));
    let newForkY = this.forkY + liftRate * dt;
    newForkY = Math.max(minFork, Math.min(veh.lift, newForkY));
    if (newForkY === minFork || newForkY === veh.lift) this.rates.lift = 0;
    if (liftRate > 0 && this.wouldLiftPallet(env, newForkY)) { newForkY = this.forkY; this.rates.lift = 0; }
    let newSpread = Math.max(SPREAD[0], Math.min(SPREAD[1], this.spread + spreadRate * dt));
    if (newSpread !== this.spread && !this.carried && this.collides(env, this.x, this.z, this.yaw, this.forkY, newSpread)) {
      newSpread = this.spread;
      this.rates.spread = 0;
    }
    if (newForkY !== this.forkY && this.collides(env, this.x, this.z, this.yaw, newForkY, newSpread)) { newForkY = this.forkY; this.rates.lift = 0; }
    this.forkY = newForkY;
    this.spread = newSpread;
    // In avanti le punte non possono scendere sotto la superficie su cui poggiano
    const ground = this.minForkHeight(env);
    const maxFwd = Math.asin(Math.max(0, Math.min(1, (this.forkY - ground) / this.geo.tipArm)));
    const tiltMin = Math.max(TILT[0], -maxFwd);
    let newTilt = this.tilt + tiltRate * dt;
    if (newTilt < tiltMin) { newTilt = Math.max(tiltMin, Math.min(this.tilt, newTilt)); this.rates.tilt = Math.max(0, this.rates.tilt); }
    if (newTilt > TILT[1]) { newTilt = TILT[1]; this.rates.tilt = 0; }
    // Inclinando, le punte non devono entrare negli ostacoli
    if (newTilt !== this.tilt) {
      const old = this.tilt;
      this.tilt = newTilt;
      if (this.contacts(env, this.x, this.z, this.yaw) === null) {
        this.tilt = old;
        if (this.contacts(env, this.x, this.z, this.yaw) !== null) this.rates.tilt = 0;
        else this.tilt = newTilt; // era gia' a contatto: non bloccare per sempre
      }
    }
    this.tilt = Math.max(TILT[0], Math.min(TILT[1], this.tilt));

    // --- Cinematica: modello bicicletta con riferimento sull'asse anteriore ---
    const delta = this.steer * MAX_STEER;
    // sul bagnato/neve la rotazione segue lo sterzo in ritardo: il muletto "scivola" un po' in curva
    const wantYaw = this.v * Math.tan(delta) / this.geo.wheelbase;
    this.yawRateNow = (this.yawRateNow ?? wantYaw) + (wantYaw - (this.yawRateNow ?? wantYaw)) * (1 - Math.exp(-dt * grip.steer * STEER.yawK / 30)); // uguale a 30 e 60 FPS
    const yawRate = this.yawRateNow;
    const nYaw = this.yaw + yawRate * dt;
    const nx = this.x + Math.sin(nYaw) * this.v * dt;
    const nz = this.z + Math.cos(nYaw) * this.v * dt;
    let hit = false;
    const touched = this.contacts(env, nx, nz, nYaw);
    const blocker = touched ? null : this.blockedBy;
    if (!touched || touched.length === 0) {
      // Pallet gia' smosso: resta "in movimento" per un attimo anche senza contatto
      this.pushGrace = (this.pushGrace || 0) - dt;
      if (this.pushGrace <= 0) this.pushTime = 0;
    }
    if (touched && touched.length === 0) {
      this.x = nx; this.z = nz; this.yaw = nYaw;
    } else if (touched && this.readyToPush(dt, input, touched) && this.pushPallets(env, touched, nx, nz, nYaw)) {
      // Spingere un pallet frena il muletto in base al peso
      this.x = nx; this.z = nz; this.yaw = nYaw;
      const heavy = touched.reduce((m, p) => Math.max(m, p.weight), 0) / veh.capacity;
      const maxPush = Math.max(0.6, 1.6 - heavy * 0.6);
      if (Math.abs(this.v) > maxPush) this.v = Math.sign(this.v) * maxPush;
    } else if (!touched && this.slideAlong(env, blocker, nYaw, dt)) {
      // contatto leggero di striscio con un muro: il muletto scorre lungo di esso
    } else if (!this.collides(env, this.x, this.z, nYaw)) {
      this.yaw = nYaw;
      hit = true;
    } else {
      hit = true;
    }
    if (hit) {
      if (Math.abs(this.v) > 1.6 && this.carried) this.dropCarried(env);
      // Urto frontale: il mezzo si ferma (senza rimbalzi); i pallet non spinti lo fermano allo stesso modo
      this.v = 0;
      this.brakeLevel = 0;
      const tag = blocker?.tag;
      if (tag === 'car' || tag === 'person') {
        this.lastHit = blocker;
        this.events.push(tag === 'car' ? 'hitCar' : 'hitPerson');
      }
    }

    this.updateCarried(dt, env, { yawRate, decel: (Math.abs(prevV) - Math.abs(this.v)) / dt, loadRatio, input });
    this.checkPickup(env, input);
    this.wheelSpin += this.v * dt / 0.33;
    this.sync(delta);
  }

  // Velocita' massima in curva con questo angolo di sterzo (accelerazione laterale CURVE_LAT, meno con carico alto)
  curveSpeed(delta, loadRatio, grip) {
    const k = Math.abs(Math.tan(delta)) / this.geo.wheelbase; // curvatura (1/raggio)
    if (k < 1e-3) return Infinity;
    const lat = Math.max(1, (CURVE_LAT - 0.25 * this.forkY - 0.6 * loadRatio) * (grip?.stability ?? 1));
    return Math.max(0.8, Math.sqrt(lat / k));
  }

  // Angolo di sterzo massimo (0..1) alla velocita' data: a bassa velocita' tutto, a velocita' alta meno
  steerLimitAt(speed, loadRatio, grip) {
    if (speed < 0.5) return 1;
    const lat = Math.max(1.5, (STEER.lat - 0.3 * this.forkY - 0.8 * loadRatio) * (grip?.stability ?? 1));
    const delta = Math.atan(lat * this.geo.wheelbase / (speed * speed));
    return Math.min(1, delta / MAX_STEER);
  }

  // Velocita' alla quale l'angolo di sterzo s (0..1) e' consentito (inversa di steerLimitAt)
  speedForSteer(s, loadRatio, grip) {
    const lat = Math.max(1.5, (STEER.lat - 0.3 * this.forkY - 0.8 * loadRatio) * (grip?.stability ?? 1));
    return Math.max(0.5, Math.sqrt(lat * this.geo.wheelbase / Math.tan(Math.min(1, s) * MAX_STEER)));
  }

  // Strisciamento lungo un ostacolo fisso (muri, recinzioni, scaffali): solo se il contatto e' di striscio
  // e lento; il mezzo scorre parallelo all'ostacolo senza entrarci. Ritorna true se si e' mosso.
  slideAlong(env, c, nYaw, dt) {
    if (!c || c.tag === 'car' || c.tag === 'person' || Math.abs(this.v) < 0.05) return false;
    const body = this.bodyRect();
    // normale della faccia piu' vicina della scatola (ostacoli allineati agli assi)
    const ox = Math.max(c.minX - body.x, body.x - c.maxX);
    const oz = Math.max(c.minZ - body.z, body.z - c.maxZ);
    const n = ox > oz ? [body.x < c.minX ? -1 : 1, 0] : [0, body.z < c.minZ ? -1 : 1];
    const dx = Math.sin(this.yaw) * Math.sign(this.v), dz = Math.cos(this.yaw) * Math.sign(this.v);
    const into = -(dx * n[0] + dz * n[1]); // quanto il moto va contro l'ostacolo (0..1)
    if (into <= 0) return false; // ci si sta gia' allontanando: il blocco viene da altro
    if (into > SLIDE_MAX_COS || Math.abs(this.v) * into > SLIDE_MAX_VN) return false; // urto frontale o troppo forte
    // si muove solo la parte del moto parallela al muro; strisciando si perde un po' di velocita'
    const tx = dx + n[0] * into, tz = dz + n[1] * into;
    const speed = Math.max(0, Math.abs(this.v) - SCRAPE_DECEL * dt);
    const sx = this.x + tx * speed * dt, sz = this.z + tz * speed * dt;
    // la rotazione si tiene solo se non porta dentro l'ostacolo
    for (const yaw of [nYaw, this.yaw]) {
      const t = this.contacts(env, sx, sz, yaw);
      if (t && t.length === 0) {
        this.x = sx; this.z = sz; this.yaw = yaw;
        this.v = Math.sign(this.v) * speed;
        return true;
      }
    }
    return false;
  }

  // Abbassamento delle punte dovuto all'inclinazione in avanti.
  tipDrop(tilt) {
    return tilt < 0 ? Math.sin(-tilt) * this.geo.tipArm : 0;
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

  checkPickup(env, input = {}) {
    if (this.carried) return;
    for (const p of env.pallets.list) {
      if (p.state !== 'rest') continue;
      const ins = this.insertion(p, env.pallets);
      if (!ins || !ins.valid) continue;
      // Forche infilate e inclinate: il pallet segue l'inclinazione (resta appoggiato finche' non lo alzi)
      if (input.tilt && ins.depth > 0.3) {
        this.carried = {
          p, lx: ins.lx, lz: ins.lz, relYaw: ins.dy, shallow: ins.depth < 0.55, time: 0,
          off: p.bottom - this.forkY, byTilt: true, attachTilt: this.tilt,
        };
        p.state = 'carried';
        this.attachVisual(p);
        return;
      }
      // Le forche toccano il piano superiore della tasca: il pallet si solleva.
      if (this.forkY + FORK.thickness >= p.bottom + PALLET.pocketHigh + 0.01) {
        this.carried = {
          p, lx: ins.lx, lz: ins.lz, relYaw: ins.dy, shallow: ins.depth < 0.55, time: 0,
          off: FORK.thickness - PALLET.pocketHigh,
        };
        p.state = 'carried';
        this.attachVisual(p);
        this.emit('pickup');
        return;
      }
    }
  }

  // Il modello del pallet segue il carrello porta-forche (inclinazione e altezza comprese).
  attachVisual(p) {
    const m = this.model;
    if (!m) return;
    const c = this.carried;
    p.node.parent = m.carriage;
    p.node.position.set(c.lx, c.off, c.lz - m.mastPivot.position.z);
    p.node.rotation.set(0, c.relYaw, 0);
  }

  detachVisual(p, env) {
    p.node.parent = null;
    p.tiltX = 0;
    p.tiltZ = 0;
    env.pallets.sync(p);
  }

  updateCarried(dt, env, { yawRate, decel, loadRatio, input = {} }) {
    const c = this.carried;
    if (!c) return;
    c.time += dt;
    const pose = this.carriedPose();
    const p = c.p;
    p.x = pose.x; p.z = pose.z; p.yaw = pose.yaw; p.bottom = pose.bottom;
    const support = env.pallets.supportAt(p, p.bottom + 0.05);
    const lifted = p.bottom - support;

    // Agganciato inclinando: finche' resta appoggiato segue l'inclinazione;
    // si stacca se le forche tornano all'inclinazione iniziale o si abbassano.
    if (c.byTilt) {
      if (lifted > 0.02) c.byTilt = false;
      else {
        // Tornato (o oltre) all'inclinazione con cui era appoggiato: si sgancia
        const delta = this.tilt - c.attachTilt;
        const back = c.lastDelta
          ? Math.abs(delta) < 0.004 || Math.sign(delta) !== Math.sign(c.lastDelta)
          : !input.tilt && Math.abs(this.rates.tilt) < 1e-3 && Math.abs(delta) < 0.004;
        if (Math.abs(delta) >= 0.004) c.lastDelta = delta;
        // Se il muletto si muove, il pallet appoggiato non viene trascinato: si raddrizza e resta li'
        const moving = Math.abs(this.v) > 0.05;
        if (!back && !moving && !(input.lift < 0)) {
          p.bottom = Math.max(p.bottom, support);
          c.off = p.bottom - this.forkY;
          return;
        }
      }
    }
    // Appoggiato: il pallet si stacca dalle forche
    if (lifted <= 0.002) {
      p.bottom = support;
      p.state = 'rest';
      this.carried = null;
      this.detachVisual(p, env);
      this.emit('place');
      return;
    }

    // Stabilita' del carico
    const h = this.forkY;
    const speed = Math.abs(this.v);
    const fork = (side) => side * this.spread / 2 - c.lx;
    // Soglie ammorbidite (~60% di cadute in meno in curva e con forche inclinate/strette)
    const outside = Math.abs(fork(-1)) > 0.62 || Math.abs(fork(1)) > 0.62;
    const spreadBonus = (this.spread - 0.5) * 1.2;
    const latLimit = (7.5 - 0.3 * h - 0.8 * loadRatio + spreadBonus) * (this.grip?.stability ?? 1);
    const brakeLimit = (4.6 - 0.45 * h + this.tilt * 14 - loadRatio) * (this.grip?.stability ?? 1);
    let reason = null;
    if (outside) reason = 'widen';
    else if (c.shallow && lifted > 0.08 && c.time > 0.4) reason = 'insertDeeper';
    else if (Math.abs(this.v * yawRate) > latLimit) reason = 'dropped';
    else if (decel > brakeLimit && speed > 0.5) reason = 'dropped';
    else if (this.tilt < -0.05 && speed > 1.5 && h > 0.8) this.unstable += dt * 0.5;
    else if (this.spread < 0.32 && loadRatio > 0.7 && speed > 1.0) {
      this.unstable += dt * 0.5;
      if (this.unstable > 2.0) reason = 'widen';
    } else this.unstable = Math.max(0, this.unstable - dt);
    if (this.unstable > 2.5 && !reason) reason = 'dropped';

    if (reason) {
      this.emit(reason);
      this.dropCarried(env);
      return;
    }
  }

  dropCarried(env) {
    if (!this.carried) return;
    const c = this.carried;
    const p = c.p;
    this.carried = null;
    this.unstable = 0;
    this.detachVisual(p, env);
    // Il pallet scivola in avanti oltre le punte delle forche (se c'e' spazio)
    const clear = this.geo.forkBase + FORK.length - (c.lz - PALLET.size / 2) + 0.15;
    const dir = [Math.sin(this.yaw), Math.cos(this.yaw)];
    let slide = 0;
    for (const d of [clear, clear * 0.6, clear * 0.3]) {
      const r = { x: p.x + dir[0] * d, z: p.z + dir[1] * d, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw: p.yaw };
      const blocked = env.colliders.some((col) => col.y1 > 0 && col.y0 < 1 && rectsOverlap(r, aabbToRect(col)));
      if (!blocked) { slide = d; break; }
    }
    env.pallets.drop(p, dir[0] * slide, dir[1] * slide);
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
    m.inner.position.y = Math.max(0, this.forkY - this.geo.freeLift);
    if (m.middle) m.middle.position.y = m.inner.position.y / 2;
    // Catene: dal carrello alla puleggia in cima allo sfilo interno
    const bottom = this.forkY - m.mastPivot.position.y + 0.55;
    const top = m.inner.position.y + this.geo.innerLen;
    for (const c of m.chains) {
      c.scaling.y = Math.max(0.05, top - bottom);
      c.position.y = (top + bottom) / 2;
    }
    m.forkL.position.x = -this.spread / 2;
    m.forkR.position.x = this.spread / 2;
    m.rearWheels.forEach((w) => { w.rotation.y = -delta; });
    if (m.steerSpin) m.steerSpin.rotation.y = this.steer * WHEEL_TURNS;
    [...m.frontWheels, ...m.rearWheels].forEach((w) => {
      w.spin.rotation.x = this.wheelSpin;
    });
  }
}
