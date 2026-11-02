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
