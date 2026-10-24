// Collisioni 2D sul piano XZ con un intervallo verticale [y0, y1].
// Rettangolo orientato: { x, z, hw, hd, yaw } (hw lungo X locale, hd lungo Z locale).

export function rectCorners(r) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const pts = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = a * r.hw, lz = b * r.hd;
    pts.push([r.x + lx * c + lz * s, r.z - lx * s + lz * c]);
  }
  return pts;
}

function axesOf(r) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [[c, -s], [s, c]];
}

function project(pts, ax) {
  let min = Infinity, max = -Infinity;
  for (const p of pts) {
    const d = p[0] * ax[0] + p[1] * ax[1];
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// Separating Axis Theorem tra due rettangoli orientati.
export function rectsOverlap(a, b, margin = 0) {
  const pa = rectCorners(a), pb = rectCorners(b);
  for (const ax of [...axesOf(a), ...axesOf(b)]) {
    const [a0, a1] = project(pa, ax);
    const [b0, b1] = project(pb, ax);
    if (a1 + margin <= b0 || b1 + margin <= a0) return false;
  }
  return true;
}

export const aabbToRect = (b) => ({
  x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
  hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2, yaw: 0,
});

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
