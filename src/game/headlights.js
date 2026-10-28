import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';

// Fanali finti (nessuna luce vera: costerebbero troppo sul telefono). Per ogni mezzo un solo oggetto con:
// fascio a cono sull'asfalto, alone sui fari (visibile da piu' lati), cono leggero nell'aria, luci rosse dietro.
// Coordinate locali del mezzo: avanti = +z (come il muletto); i mezzi che guardano +x usano yaw = PI/2.
// Atlante: [0, 0.5] fascio a terra, [0.5, 0.75] alone bianco, [0.75, 1] alone rosso (in alto) e cono nell'aria (in basso).

const all = new Set();
let shared = null;
let level = 0; // 0 = spenti

function material(scene) {
  if (shared && !shared.isDisposed?.()) return shared;
  const W = 512, H = 256;
  const tex = new DynamicTexture('headlightAtlas', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);
  // fascio a terra: il trapezio del fascio e' gia' nella forma del pezzo; qui solo la sfumatura morbida
  // (di lato verso i bordi, in avanti con la distanza, e un attacco graduale vicino al faro)
  const img = ctx.createImageData(256, 256);
  const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let py = 0; py < 256; py++) {
    const v = 1 - py / 255; // 0 = vicino al faro (in basso), 1 = lontano
    const along = sm(0, 0.16, v) * Math.pow(1 - v, 1.7);
    for (let px = 0; px < 256; px++) {
      const lat = 1 - sm(0.18, 0.5, Math.abs(px / 255 - 0.5));
      const a = 0.9 * along * lat;
      const i = (py * 256 + px) * 4;
      img.data[i] = 255; img.data[i + 1] = 240; img.data[i + 2] = 205; img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  // alone bianco del faro
  const glow = (cx, cy, r, rgb) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.15, `rgba(${rgb},0.85)`);
    g.addColorStop(0.45, `rgba(${rgb},0.22)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  glow(320, 64, 62, '255,248,225');
  glow(320, 192, 62, '255,248,225');
  // alone rosso (luci di posizione e stop)
  glow(448, 64, 62, '255,40,25');
  // cono nell'aria: sfuma dal faro (in alto della striscia) in avanti, e dal centro ai bordi
  const vol = ctx.createLinearGradient(0, 128, 0, 256);
  vol.addColorStop(0, 'rgba(255,240,210,0.22)');
  vol.addColorStop(0.5, 'rgba(255,238,205,0.06)');
  vol.addColorStop(1, 'rgba(255,235,200,0)');
  ctx.fillStyle = vol;
  ctx.fillRect(384, 128, 128, 128);
  const vs = ctx.createLinearGradient(384, 0, 512, 0);
  vs.addColorStop(0, 'rgba(0,0,0,1)');
  vs.addColorStop(0.45, 'rgba(0,0,0,0)');
  vs.addColorStop(0.55, 'rgba(0,0,0,0)');
  vs.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = vs;
  ctx.fillRect(384, 128, 128, 128);
  ctx.globalCompositeOperation = 'source-over';
  tex.update();
  tex.hasAlpha = true;
  const mat = new StandardMaterial('headlightMat', scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  mat.alpha = 1;
  shared = mat;
  return mat;
}

// spec: { lamps: [[x, y, z]...] fari davanti, tails: [[x, y, z]...] luci rosse dietro,
//         beam: { z0, z1, w0, w1 } fascio a terra (da z0 a z1, larghezza w0 -> w1), glow: raggio dell'alone,
//         air: lunghezza del cono nell'aria (0 = niente) }
export function createHeadlights(scene, name, spec, parent) {
  const pos = [], uv = [], idx = [], hpos = [], huv = [], hidx = [];
  const into = (P, U, I) => (p, r) => {
    // p: 4 vertici; r: [u0, v0, u1, v1] nell'atlante (v = 1 in alto)
    const b = P.length / 3;
    for (const q of p) P.push(...q);
    U.push(r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const quad = into(pos, uv, idx), hquad = into(hpos, huv, hidx);
  const { beam, glow = 0.35, air = 0 } = spec;
  if (beam) {
    const y = 0.04;
    quad([[-beam.w0 / 2, y, beam.z0], [beam.w0 / 2, y, beam.z0], [beam.w1 / 2, y, beam.z1], [-beam.w1 / 2, y, beam.z1]], [0, 0, 0.5, 1]);
  }
  const halo = (x, y, z, r, rect) => {
    // tre quadrati incrociati: l'alone si vede da davanti, di lato e dall'alto
    hquad([[x - r, y - r, z], [x + r, y - r, z], [x + r, y + r, z], [x - r, y + r, z]], rect);
    hquad([[x, y - r, z - r], [x, y - r, z + r], [x, y + r, z + r], [x, y + r, z - r]], rect);
    hquad([[x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r]], rect);
  };
  for (const [x, y, z] of spec.lamps || []) {
    halo(x, y, z, glow, [0.5, 0.5, 0.75, 1]);
    if (air) {
      // cono nell'aria: piano verticale che si allarga e scende verso l'asfalto (si vede di lato e da dietro)
      const z1 = z + air, w = air * 0.18, y1 = Math.max(0.15, y - air * 0.18);
      quad([[x, y - 0.06, z], [x, y + 0.06, z], [x, y1 + w, z1], [x, y1 - w, z1]], [0.75, 0.5, 1, 0]);
    }
  }
  for (const [x, y, z] of spec.tails || []) halo(x, y, z, glow * 0.6, [0.75, 0.5, 1, 1]);
  const mesh = build(scene, name, pos, uv, idx, parent);
  // aloni a parte: il muletto del giocatore li nasconde in prima persona (sarebbero davanti agli occhi)
  mesh.halo = build(scene, `${name}Halo`, hpos, huv, hidx, parent);
  return mesh;
}

function build(scene, name, pos, uv, idx, parent) {
  const mesh = new Mesh(name, scene);
  if (pos.length) {
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uv;
    vd.indices = idx;
    vd.applyToMesh(mesh);
  }
  mesh.material = material(scene);
  mesh.isPickable = false;
  mesh.metadata = { rearview: true, headlights: true };
  if (parent) mesh.parent = parent;
  mesh.setEnabled(level > 0);
  all.add(mesh);
  mesh.onDisposeObservable.addOnce(() => all.delete(mesh));
  return mesh;
}

// Accesi o spenti per tutti i mezzi; v = quanto si vedono (1 di notte, meno con la luce del giorno)
export function setHeadlights(v) {
  level = v;
  if (shared) shared.alpha = Math.max(0.01, v);
  for (const m of all) m.setEnabled(v > 0);
}
