import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

// Ombra morbida sotto mezzi e persone (una macchia scura sfumata): li fa sembrare appoggiati a terra anche
// di notte e col cielo coperto, quando le ombre vere sono spente. Costa pochissimo (un quadrato per oggetto).
let mat = null;

function material(scene) {
  if (mat) return mat;
  const tex = new DynamicTexture('blobShadowTex', 64, scene, true);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex.update();
  tex.hasAlpha = true;
  mat = new StandardMaterial('blobShadow', scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.Black();
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.disableDepthWrite = true;
  mat.alpha = 0.8;
  mat.zOffset = -2; // sopra l'asfalto senza tremolio
  return mat;
}

// w = larghezza (x), d = lunghezza (z), centro (cx, cz) nelle coordinate del genitore
export function addBlobShadow(scene, parent, w, d, cx = 0, cz = 0) {
  const m = MeshBuilder.CreateGround('blobShadow', { width: w, height: d }, scene);
  m.material = material(scene);
  m.parent = parent;
  m.position.set(cx, 0.015, cz);
  m.isPickable = false;
  m.metadata = { rearview: true, headlights: true }; // come i fanali: niente ombra propria, fuori dai conti del modello
  return m;
}
