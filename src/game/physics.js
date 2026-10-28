// Collisioni 2D sul piano XZ con un intervallo verticale [y0, y1].
// Rettangolo orientato: { x, z, hw, hd, yaw } (hw lungo X locale, hd lungo Z locale).

// Separating Axis Theorem tra due rettangoli orientati.
// Senza creare oggetti: e' chiamata centinaia di volte per fotogramma e la memoria temporanea
// faceva fermare il gioco per la pulizia (scatti casuali sui telefoni).
const CA = new Float64Array(8);
const CB = new Float64Array(8);

function cornersInto(r, out) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const ax = r.hw * c, az = -r.hw * s; // asse X locale scalato
  const bx = r.hd * s, bz = r.hd * c; // asse Z locale scalato
  out[0] = r.x - ax - bx; out[1] = r.z - az - bz;
  out[2] = r.x + ax - bx; out[3] = r.z + az - bz;
  out[4] = r.x + ax + bx; out[5] = r.z + az + bz;
  out[6] = r.x - ax + bx; out[7] = r.z - az + bz;
}

// true se sull'asse (ux, uz) le proiezioni dei due rettangoli sono separate
function separated(ux, uz, margin) {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const da = CA[i] * ux + CA[i + 1] * uz;
    if (da < a0) a0 = da;
    if (da > a1) a1 = da;
    const db = CB[i] * ux + CB[i + 1] * uz;
    if (db < b0) b0 = db;
    if (db > b1) b1 = db;
  }
  return a1 + margin <= b0 || b1 + margin <= a0;
}

export function rectsOverlap(a, b, margin = 0) {
  cornersInto(a, CA);
  cornersInto(b, CB);
  const ca = Math.cos(a.yaw), sa = Math.sin(a.yaw), cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
  return !(separated(ca, -sa, margin) || separated(sa, ca, margin)
    || separated(cb, -sb, margin) || separated(sb, cb, margin));
}

export const aabbToRect = (b) => ({
  x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
  hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2, yaw: 0,
});

// Come aabbToRect ma riempie un rettangolo gia' esistente (niente memoria nuova nei cicli caldi)
export function aabbIntoRect(b, out) {
  out.x = (b.minX + b.maxX) / 2;
  out.z = (b.minZ + b.maxZ) / 2;
  out.hw = (b.maxX - b.minX) / 2;
  out.hd = (b.maxZ - b.minZ) / 2;
  out.yaw = 0;
  return out;
}

export const verticalOverlap = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// Punto in coordinate locali di un sistema (x, z, yaw).
export function toLocal(frame, px, pz) {
  const dx = px - frame.x, dz = pz - frame.z;
  const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function toWorld(frame, lx, lz) {
  const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
  return [frame.x + lx * c + lz * s, frame.z - lx * s + lz * c];
}

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Curva di Bezier: tabella distanza -> parametro t, poi posizione e direzione calcolate esatte (niente spigoli).
export function bezierPath(p0, p1, p2, p3, n = 96) {
  const P = [p0, p1, p2, p3];
  const pos = (t) => {
    const a = 1 - t;
    const w = [a * a * a, 3 * a * a * t, 3 * a * t * t, t * t * t];
    return [0, 1].map((k) => w[0] * P[0][k] + w[1] * P[1][k] + w[2] * P[2][k] + w[3] * P[3][k]);
  };
  const tbl = [{ t: 0, s: 0 }];
  let prev = pos(0), len = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, q = pos(t);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    tbl.push({ t, s: len });
    prev = q;
  }
  return { P, pos, tbl, len };
}

export function pointAt(path, s) {
  const { tbl, P } = path;
  s = Math.max(0, Math.min(path.len, s));
  let i = 1;
  while (i < tbl.length - 1 && tbl[i].s < s) i++;
  const a = tbl[i - 1], b = tbl[i];
  const t = a.t + (b.t - a.t) * (b.s > a.s ? (s - a.s) / (b.s - a.s) : 0);
  const [x, z] = path.pos(t);
  // Derivata della Bezier: direzione del moto (agli estremi di un tratto dritto e' nulla: si usa la corda)
  const u = 1 - t;
  let dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
  let dz = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
  if (Math.hypot(dx, dz) < 1e-6) { dx = P[3][0] - P[0][0]; dz = P[3][1] - P[0][1]; }
  return { x, z, dx, dz, h: Math.atan2(dx, dz) };
}
