import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

// Fanali finti (nessuna luce vera: costerebbero troppo sul telefono). Per ogni mezzo:
// - lenti luminose appoggiate sulla carrozzeria vera (la posizione si cerca sul modello, vedi snapZ)
// - alone stretto attorno alla lente, fascio sull'asfalto che parte dal mezzo, luci rosse dietro.
// Coordinate locali: avanti = +z (come il muletto); i mezzi che guardano +x usano un nodo girato di PI/2.
// Atlante: [0, 0.5] fascio a terra, [0.5, 0.75] bianco, [0.75, 1] rosso (in alto l'alone, in basso la lente accesa).

const all = new Set();
let glowMat = null;
let level = 0; // 0 = spenti

function materials(scene) {
  if (glowMat) return;
  const tex = new DynamicTexture('headlightAtlas', { width: 512, height: 256 }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 512, 256);
  // fascio a terra: il trapezio e' gia' nella forma del pezzo; qui la sfumatura. Comincia sotto il mezzo e
  // cresce dolcemente fino a poco davanti al muso (nessun bordo netto), poi cala con la distanza e verso i bordi
  const img = ctx.createImageData(256, 256);
  const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let py = 0; py < 256; py++) {
    const v = 1 - py / 255; // 0 = sotto il faro (in basso), 1 = lontano
    const along = 1.2 * sm(0.02, 0.2, v) * Math.pow(1 - v, 1.5);
    for (let px = 0; px < 256; px++) {
      const u = Math.abs(px / 255 - 0.5) * 2; // 0 al centro, 1 ai bordi
      // due fari: due chiazze piu' chiare che si fondono in avanti
      const lobes = 1 + 0.25 * (1 - v) * Math.exp(-Math.pow((u - 0.45) / 0.22, 2));
      const a = 0.62 * along * (1 - sm(0.45, 1, u)) * lobes;
      const i = (py * 256 + px) * 4;
      img.data[i] = 255; img.data[i + 1] = 241; img.data[i + 2] = 210; img.data[i + 3] = Math.min(255, Math.round(255 * a));
    }
  }
  ctx.putImageData(img, 0, 0);
  const glow = (cx, cy, r, rgb) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},0.9)`);
    g.addColorStop(0.2, `rgba(${rgb},0.45)`);
    g.addColorStop(0.5, `rgba(${rgb},0.1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  glow(320, 64, 62, '255,248,228');
  glow(448, 64, 62, '255,45,30');
  // lente accesa: nucleo pieno e bordo morbido (in basso nell'atlante)
  const core = (cx, cy, r, rgb) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.45, `rgba(${rgb},0.95)`);
    g.addColorStop(0.75, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  core(320, 192, 62, '255,250,236');
  core(448, 192, 62, '255,40,25');
  tex.update();
  tex.hasAlpha = true;
  glowMat = new StandardMaterial('headlightGlow', scene);
  glowMat.diffuseColor = Color3.Black();
  glowMat.specularColor = Color3.Black();
  glowMat.emissiveTexture = tex;
  glowMat.opacityTexture = tex;
  glowMat.disableLighting = true;
  glowMat.alphaMode = Constants.ALPHA_ADD;
  glowMat.disableDepthWrite = true;
  glowMat.backFaceCulling = false;
  glowMat.fogEnabled = false;
}

// Cerca la carrozzeria lungo l'asse avanti/indietro: dal punto (x, y, fromZ) verso toZ, nelle coordinate di
// 'frame'. Ritorna la z del primo punto colpito (o null). Cosi' i fari stanno sulla superficie del modello.
export function snapZ(frame, meshes, x, y, fromZ, toZ) {
  const M = frame.computeWorldMatrix(true);
  const a = Vector3.TransformCoordinates(new Vector3(x, y, fromZ), M);
  const b = Vector3.TransformCoordinates(new Vector3(x, y, toZ), M);
  const dir = b.subtract(a);
  const len = dir.length();
  const ray = new Ray(a, dir.normalize(), len);
  let best = null;
  for (const m of meshes) {
    if (!m.getTotalVertices?.()) continue;
    m.computeWorldMatrix(true);
    const hit = ray.intersectsMesh(m, false);
    if (hit.hit && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) return null;
  const inv = Matrix.Invert(M);
  return Vector3.TransformCoordinates(best.pickedPoint, inv).z;
}

// spec: { lamps: [[x, y, z]...] fari (z = superficie del faro), tails: [[x, y, z]...] luci rosse (z = superficie dietro),
//         lens: [larghezza, altezza] delle lenti, tailLens: idem, glow: raggio dell'alone,
//         beam: { z0, z1, w0, w1 } fascio a terra (da z0 a z1, larghezza w0 -> w1) }
export function createHeadlights(scene, name, spec, parent) {
  materials(scene);
  const geo = () => ({ pos: [], uv: [], idx: [] });
  const glowG = geo(), haloG = geo();
  const quad = (G, p, r = [0, 0, 1, 1]) => {
    const b = G.pos.length / 3;
    for (const q of p) G.pos.push(...q);
    G.uv.push(r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]);
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const { beam, glow = 0.16 } = spec;
  if (beam) {
    const y = 0.035;
    quad(glowG, [[-beam.w0 / 2, y, beam.z0], [beam.w0 / 2, y, beam.z0], [beam.w1 / 2, y, beam.z1], [-beam.w1 / 2, y, beam.z1]], [0, 0, 0.5, 1]);
  }
  // lente accesa: bagliore pieno grande quanto il faro, appena davanti alla superficie (dir = +1 davanti, -1 dietro)
  const lens = (x, y, z, [w, h], dir, rect) => {
    const zz = z + dir * 0.02, hw = w * 0.8, hh = h * 0.9;
    quad(haloG, [[x - hw, y - hh, zz], [x + hw, y - hh, zz], [x + hw, y + hh, zz], [x - hw, y + hh, zz]], rect);
  };
  // alone: un quadrato davanti alla lente e uno orizzontale (si vede anche di lato e dall'alto);
  // le parti dentro la carrozzeria restano nascoste: l'alone sembra uscire dal faro
  const halo = (x, y, z, r, rect, dir) => {
    const zz = z + dir * 0.03;
    quad(haloG, [[x - r, y - r, zz], [x + r, y - r, zz], [x + r, y + r, zz], [x - r, y + r, zz]], rect);
    quad(haloG, [[x - r, y, zz - r], [x + r, y, zz - r], [x + r, y, zz + r], [x - r, y, zz + r]], rect);
  };
  for (const [x, y, z] of spec.lamps || []) {
    lens(x, y, z, spec.lens || [0.18, 0.1], 1, [0.5, 0, 0.75, 0.5]);
    halo(x, y, z, glow, [0.5, 0.5, 0.75, 1], 1);
  }
  for (const [x, y, z] of spec.tails || []) {
    lens(x, y, z, spec.tailLens || [0.16, 0.08], -1, [0.75, 0, 1, 0.5]);
    halo(x, y, z, glow * 0.7, [0.75, 0.5, 1, 1], -1);
  }
  const mesh = build(scene, name, glowG, glowMat, parent);
  // lenti e aloni a parte: il muletto del giocatore li nasconde in prima persona (sarebbero davanti agli occhi)
  mesh.lenses = [build(scene, `${name}Halo`, haloG, glowMat, parent)];
  return mesh;
}

function build(scene, name, G, mat, parent) {
  const mesh = new Mesh(name, scene);
  if (G.pos.length) {
    const vd = new VertexData();
    vd.positions = G.pos;
    vd.uvs = G.uv;
    vd.indices = G.idx;
    vd.applyToMesh(mesh);
  }
  mesh.material = mat;
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
  if (glowMat) glowMat.alpha = Math.max(0.01, v);
  for (const m of all) m.setEnabled(v > 0);
}
