// Comparsa sicura dei camion (contratto e operai IA).
// Un camion compare (e diventa un ostacolo) solo se l'area dove nasce E il primo tratto che percorre sono liberi:
//  - giocatore: corpo, forche e carico, nella posizione attuale (margine pieno) e in quella prevista fra 1 e 2 s
//    in base a velocita' e direzione (margine ridotto). Il margine e' una base, non una garanzia: per questo
//    si controlla anche il percorso iniziale e, dopo la comparsa, il camion si ferma se ha il muletto davanti.
//  - altri veicoli e ostacoli mobili: auto, persone, altri camion, muletti degli operai, pallet a terra.
// Se non e' libero la comparsa si rinvia e si riprova ogni SPAWN.retryS secondi (nessun camion nuovo: e' lo stesso).
import { rectsOverlap, aabbToRect } from './physics.js';
import { PALLET } from './models.js';

export const SPAWN = {
  margin: 6, // m di spazio libero attorno al camion rispetto al muletto (posizione attuale)
  aheadMargin: 3, // m attorno alle posizioni previste del muletto
  aheadS: [1, 2], // secondi di previsione della posizione del muletto
  vehicleMargin: 1, // m da auto, persone e altri mezzi
  retryS: 0.5,
  tags: new Set(['car', 'person', 'truck', 'bot', 'botPallet']),
};

// Rettangolo (AABB) che contiene tutti quelli dati: l'area spazzata dal camion nel tratto iniziale
export function unionBox(boxes) {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)), maxX: Math.max(...boxes.map((b) => b.maxX)),
    minZ: Math.min(...boxes.map((b) => b.minZ)), maxZ: Math.max(...boxes.map((b) => b.maxZ)),
  };
}

// Parti del muletto (corpo, forche, carico) in una posa
function playerParts(f, x, z, yaw) {
  const parts = [f.bodyRect(x, z, yaw), ...f.forkRects(x, z, yaw)];
  if (f.carried) {
    const c = f.carriedPose(x, z, yaw);
    parts.push({ x: c.x, z: c.z, hw: PALLET.size / 2, hd: PALLET.size / 2, yaw: c.yaw });
  }
  return parts;
}

// boxes: aree (AABB) occupate dal camion alla comparsa e nel primo tratto. ignore: ostacoli del camion stesso.
// Ritorna { ok, why } (why: cosa occupa l'area, per i test e la diagnostica).
export function spawnClear(boxes, { player = null, env, ignore = [] }) {
  const rects = boxes.map(aabbToRect);
  if (player) {
    const poses = [[player.x, player.z, SPAWN.margin]];
    for (const t of SPAWN.aheadS) {
      poses.push([player.x + Math.sin(player.yaw) * player.v * t, player.z + Math.cos(player.yaw) * player.v * t, SPAWN.aheadMargin]);
    }
    for (const [x, z, m] of poses) {
      const parts = playerParts(player, x, z, player.yaw);
      if (parts.some((p) => rects.some((r) => rectsOverlap(p, r, m)))) return { ok: false, why: 'giocatore' };
    }
  }
  for (const c of env.colliders) {
    if (c.y1 <= 0 || !SPAWN.tags.has(c.tag) || ignore.includes(c)) continue;
    const r = aabbToRect(c);
    if (rects.some((q) => rectsOverlap(q, r, SPAWN.vehicleMargin))) return { ok: false, why: c.tag };
  }
  for (const p of env.pallets?.list || []) {
    if (p.state === 'onTruck') continue;
    const pr = env.pallets.rect(p);
    if (rects.some((q) => rectsOverlap(q, pr, 0.5))) return { ok: false, why: 'pallet' };
  }
  return { ok: true };
}

// ---------- Camion degli operai: zona sicura con traiettoria intera ----------
// Valori iniziali approvati, configurabili. Verificati dai test (npm run test:camion), non dati per sufficienti.
export const ZONE = {
  fadeS: 1.0, // dissolvenza (entrata e uscita), da fermo
  abortS: 0.3, // dissolvenza rapida quando la comparsa si annulla (o ritorno visibile in uscita)
  checkS: 0.1, // controllo della zona durante l'attesa e la dissolvenza
  reactS: 1.5, // tempo di reazione del giocatore
  brakeDec: 2.5, // frenata del muletto considerata (m/s^2, prudente: dal banco di prova della guida il Colossus da 7,2 m/s
  // si ferma in 6,2 m sull'asciutto, circa 4,2 m/s^2, e in 8,8 m sulla neve, circa 3)
  speedMarginS: 1.0, // margine sulla posizione attuale: SPAWN.margin + velocita' x questo tempo
  stepS: 0.25, // passo dei campioni della traiettoria
  carS: 1.5, // previsione delle auto lungo la corsia, oltre la dissolvenza che manca
  carDec: 5.5, // frenata delle auto (come in traffic.js)
};

// Durata della previsione: dissolvenza che resta + reazione + frenata
export const zoneHorizon = (v, fadeLeftS) => fadeLeftS + ZONE.reactS + Math.abs(v) / ZONE.brakeDec;

// Il muletto puo' arrivare nella zona? Posizione attuale (margine 6 m + velocita' x 1 s) e traiettoria prevista
// fino a zoneHorizon (margine SPAWN.aheadMargin), in linea retta e lungo l'arco della sterzata attuale: a velocita'
// costante per la dissolvenza che manca + il tempo di reazione, poi in frenata (ZONE.brakeDec) fino a fermarsi.
// yawRate: velocita' di rotazione del muletto (rad/s), misurata da chi chiama.
export function playerThreat(rects, player, yawRate, fadeLeftS) {
  const v = player.v;
  const T = zoneHorizon(v, fadeLeftS);
  const m0 = SPAWN.margin + Math.abs(v) * ZONE.speedMarginS;
  // lontano da tutto: nessun calcolo
  let near = false;
  for (const r of rects) {
    const reach = Math.abs(v) * T + m0 + Math.hypot(r.hw, r.hd) + 6;
    if (Math.hypot(player.x - r.x, player.z - r.z) < reach) { near = true; break; }
  }
  if (!near) return false;
  const hit = (x, z, yaw, m) => playerParts(player, x, z, yaw).some((p) => rects.some((r) => rectsOverlap(p, r, m)));
  if (hit(player.x, player.z, player.yaw, m0)) return true;
  for (const w of yawRate && Math.abs(yawRate) > 1e-3 ? [0, yawRate] : [0]) {
    let x = player.x, z = player.z, yaw = player.yaw;
    const tBrake = fadeLeftS + ZONE.reactS;
    for (let t = ZONE.stepS; t <= T + 1e-6; t += ZONE.stepS) {
      // passi piccoli dentro ogni campione: l'arco non taglia gli angoli
      for (let k = 0; k < 2; k++) {
        const h = ZONE.stepS / 2, tm = t - ZONE.stepS + (k + 0.5) * h;
        const vt = tm <= tBrake ? v : Math.sign(v) * Math.max(0, Math.abs(v) - ZONE.brakeDec * (tm - tBrake));
        yaw += w * h * (v ? vt / v : 0); // si gira meno mentre rallenta
        x += Math.sin(yaw) * vt * h;
        z += Math.cos(yaw) * vt * h;
      }
      if (hit(x, z, yaw, SPAWN.aheadMargin)) return true;
    }
  }
  return false;
}

// Zona dei camion degli operai libera? boxes: AABB occupate; player e yawRate: muletto; cars: auto del traffico
// (previste lungo la corsia per la dissolvenza che manca + ZONE.carS); env/ignore: altri ostacoli mobili e pallet come spawnClear.
// opts.onlyPlayer: solo il giocatore (uscita: le auto si fermano davanti al camion solido).
export function zoneClear(boxes, { player = null, yawRate = 0, fadeLeftS = 0, cars = [], env, ignore = [], onlyPlayer = false }) {
  const rects = boxes.map(aabbToRect);
  if (player && playerThreat(rects, player, yawRate, fadeLeftS)) return { ok: false, why: 'giocatore' };
  if (onlyPlayer) return { ok: true };
  for (const car of cars) {
    const c = car.col, v = Math.max(0, car.v);
    // fino a camion solido + margine, piu' lo spazio di frenata dell'auto: non deve frenare per un camion appena comparso
    const dx = car.dir * (v * (ZONE.carS + fadeLeftS) + (v * v) / (2 * ZONE.carDec));
    const swept = { minX: Math.min(c.minX, c.minX + dx), maxX: Math.max(c.maxX, c.maxX + dx), minZ: c.minZ, maxZ: c.maxZ };
    if (rects.some((q) => rectsOverlap(q, aabbToRect(swept), SPAWN.vehicleMargin))) return { ok: false, why: 'car' };
  }
  return spawnClear(boxes, { player: null, env, ignore });
}
