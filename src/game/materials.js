import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';

const TEX_URL = `${import.meta.env.BASE_URL}textures/`;

// Texture procedurali disegnate su canvas: nessun asset esterno da scaricare.
function canvasTexture(scene, name, size, draw, uScale = 1, vScale = 1) {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  draw(ctx, size);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uScale;
  tex.vScale = vScale;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

function noise(ctx, size, base, spread, count, alpha = 0.25) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(Math.random() * spread);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const r = Math.random() * 2.2 + 0.4;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
}

function pbr(scene, name, { color = '#ffffff', metal = 0, rough = 0.8, tex = null, emissive = null, alpha = 1 } = {}) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(color).toLinearSpace();
  m.metallic = metal;
  m.roughness = rough;
  if (tex) m.albedoTexture = tex;
  if (emissive) m.emissiveColor = Color3.FromHexString(emissive);
  if (alpha < 1) m.alpha = alpha;
  m.environmentIntensity = 0.6;
  return m;
}

// Materiale PBR con texture fotografica (CC0, Poly Haven / ambientCG) e ruvidita' fissa:
// niente normal map / ORM, che sul telefono costano molto e si notano poco.
// tile = metri coperti da una ripetizione (UV calcolati sul mondo).
function texturedPbr(scene, name, key, { color = '#ffffff', tile = 0, metal = 0, rough = 0.85 } = {}) {
  const tex = new Texture(`${TEX_URL}${key}_col.jpg`, scene);
  tex.anisotropicFilteringLevel = 4;
  const m = pbr(scene, name, { color, metal, rough, tex });
  m.metadata = { tile };
  return m;
}

export function createMaterials(scene) {
  const grassTex = canvasTexture(scene, 'grassTex', 256, (ctx, s) => {
    noise(ctx, s, '#4f7a35', 90, 6000, 0.25);
  }, 30, 30);

  const chainTex = canvasTexture(scene, 'chainTex', 64, (ctx, s) => {
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#8b9096';
    ctx.lineWidth = 5;
    for (let y = 0; y < s; y += 16) {
      ctx.strokeRect(14, y + 2, 36, 12);
    }
  }, 1, 30);
  const chain = pbr(scene, 'chain', { color: '#ffffff', metal: 0.7, rough: 0.4, tex: chainTex });

  return {
    chain,
    chrome: pbr(scene, 'chrome', { color: '#d9dde2', metal: 1, rough: 0.12 }),
    asphalt: texturedPbr(scene, 'asphalt', 'asphalt', { tile: 5, rough: 0.95 }),
    concrete: texturedPbr(scene, 'concrete', 'concrete', { tile: 4 }),
    floor: texturedPbr(scene, 'floor', 'floor', { tile: 6 }),
    grass: pbr(scene, 'grass', { color: '#ffffff', rough: 1, tex: grassTex }),
    metalWall: texturedPbr(scene, 'metalWall', 'corrugated', { tile: 3, color: '#dfe5ea', metal: 0.5, rough: 0.5 }),
    roof: pbr(scene, 'roof', { color: '#6b7178', metal: 0.6, rough: 0.55 }),
    trim: pbr(scene, 'trim', { color: '#25507a', metal: 0.4, rough: 0.5 }),
    doorClosed: pbr(scene, 'doorClosed', { color: '#8a9096', metal: 0.6, rough: 0.45 }),
    steel: pbr(scene, 'steel', { color: '#7d8287', metal: 0.85, rough: 0.35 }),
    darkSteel: pbr(scene, 'darkSteel', { color: '#2e3134', metal: 0.7, rough: 0.45 }),
    rubber: pbr(scene, 'rubber', { color: '#161616', rough: 0.95 }),
    wood: texturedPbr(scene, 'wood', 'wood'),
    cardboard: texturedPbr(scene, 'cardboard', 'cardboard'),
    fragileBox: texturedPbr(scene, 'fragileBox', 'cardboard', { color: '#e0605a' }),
    rack: pbr(scene, 'rack', { color: '#e0601e', metal: 0.5, rough: 0.5 }),
    rackBeam: pbr(scene, 'rackBeam', { color: '#2f62a8', metal: 0.5, rough: 0.5 }),
    lineWhite: pbr(scene, 'lineWhite', { color: '#e9e9e2', rough: 0.7 }),
    lineYellow: pbr(scene, 'lineYellow', { color: '#f4c20d', rough: 0.6, emissive: '#3a2d00' }),
    fence: pbr(scene, 'fence', { color: '#8e969c', metal: 0.7, rough: 0.4 }),
    container: memo((c) => pbr(scene, 'container' + c, { color: c, metal: 0.5, rough: 0.6 })),
    paint: memo((c) => pbr(scene, 'paint' + c, { color: c, metal: 0.35, rough: 0.35 })),
    light: pbr(scene, 'light', { color: '#fff7d6', emissive: '#fff2b0' }),
    sign: memo((text, bg, fg) => {
      const tex = canvasTexture(scene, 'sign' + text, 512, (ctx, s) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = String(text).split('\n');
        // Carattere grande ma ridotto se una riga non ci sta nella larghezza
        let size = lines.length > 1 ? 110 : 200;
        ctx.font = `bold ${size}px Arial`;
        const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
        if (widest > s * 0.92) {
          size = Math.floor(size * (s * 0.92) / widest);
          ctx.font = `bold ${size}px Arial`;
        }
        lines.forEach((l, i) => ctx.fillText(l, s / 2, s / 2 + (i - (lines.length - 1) / 2) * size * 1.18));
      });
      tex.hasAlpha = false;
      const m = pbr(scene, 'signMat' + text, { color: '#ffffff', rough: 0.6, tex });
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(0.35, 0.35, 0.35);
      return m;
    }),
  };
}

function memo(fn) {
  const cache = new Map();
  return (...args) => {
    const k = args.join('|');
    if (!cache.has(k)) cache.set(k, fn(...args));
    return cache.get(k);
  };
}
