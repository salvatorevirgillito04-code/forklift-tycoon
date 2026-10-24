import { DynamicTexture, PBRMaterial, Color3, Texture } from '@babylonjs/core';

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

export function createMaterials(scene) {
  const asphaltTex = canvasTexture(scene, 'asphaltTex', 512, (ctx, s) => {
    noise(ctx, s, '#3b3d40', 140, 9000, 0.35);
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, 40, 12);

  const concreteTex = canvasTexture(scene, 'concreteTex', 512, (ctx, s) => {
    noise(ctx, s, '#9a9890', 200, 7000, 0.18);
    ctx.strokeStyle = 'rgba(60,60,60,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
  }, 12, 12);

  const metalWallTex = canvasTexture(scene, 'metalWallTex', 256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    for (let i = 0; i <= 16; i++) {
      g.addColorStop(i / 16, i % 2 ? '#c9ced3' : '#a6adb4');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(90,80,70,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 6);
    }
  }, 8, 1);

  const woodTex = canvasTexture(scene, 'woodTex', 256, (ctx, s) => {
    ctx.fillStyle = '#b48a58';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(110,70,30,${0.08 + Math.random() * 0.12})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(80,50,20,0.4)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const cardboardTex = canvasTexture(scene, 'cardboardTex', 256, (ctx, s) => {
    noise(ctx, s, '#b98d57', 80, 2500, 0.12);
    ctx.fillStyle = 'rgba(200,160,100,0.9)';
    ctx.fillRect(0, s * 0.46, s, s * 0.08); // nastro adesivo
    ctx.strokeStyle = 'rgba(90,60,30,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.fillStyle = 'rgba(30,30,30,0.7)';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('↑↑', 20, 50);
  });

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
    display: pbr(scene, 'display', { color: '#3b5f3b', rough: 0.3, emissive: '#2f6b3a' }),
    asphalt: pbr(scene, 'asphalt', { color: '#ffffff', rough: 0.95, tex: asphaltTex }),
    concrete: pbr(scene, 'concrete', { color: '#ffffff', rough: 0.9, tex: concreteTex }),
    grass: pbr(scene, 'grass', { color: '#ffffff', rough: 1, tex: grassTex }),
    metalWall: pbr(scene, 'metalWall', { color: '#ffffff', metal: 0.5, rough: 0.5, tex: metalWallTex }),
    roof: pbr(scene, 'roof', { color: '#6b7178', metal: 0.6, rough: 0.55 }),
    trim: pbr(scene, 'trim', { color: '#25507a', metal: 0.4, rough: 0.5 }),
    doorClosed: pbr(scene, 'doorClosed', { color: '#8a9096', metal: 0.6, rough: 0.45 }),
    darkInterior: pbr(scene, 'darkInterior', { color: '#2a2c30', rough: 0.9 }),
    steel: pbr(scene, 'steel', { color: '#7d8287', metal: 0.85, rough: 0.35 }),
    darkSteel: pbr(scene, 'darkSteel', { color: '#2e3134', metal: 0.7, rough: 0.45 }),
    rubber: pbr(scene, 'rubber', { color: '#161616', rough: 0.95 }),
    glass: pbr(scene, 'glass', { color: '#9fc4d8', metal: 0.1, rough: 0.05, alpha: 0.35 }),
    seat: pbr(scene, 'seat', { color: '#1e1e1e', rough: 0.7 }),
    wood: pbr(scene, 'wood', { color: '#ffffff', rough: 0.85, tex: woodTex }),
    cardboard: pbr(scene, 'cardboard', { color: '#ffffff', rough: 0.9, tex: cardboardTex }),
    fragileBox: pbr(scene, 'fragileBox', { color: '#d9534f', rough: 0.85, tex: cardboardTex }),
    wrap: pbr(scene, 'wrap', { color: '#e8eef2', metal: 0, rough: 0.25, alpha: 0.55 }),
    rack: pbr(scene, 'rack', { color: '#e0601e', metal: 0.5, rough: 0.5 }),
    rackBeam: pbr(scene, 'rackBeam', { color: '#2f62a8', metal: 0.5, rough: 0.5 }),
    lineWhite: pbr(scene, 'lineWhite', { color: '#e9e9e2', rough: 0.7 }),
    lineYellow: pbr(scene, 'lineYellow', { color: '#f4c20d', rough: 0.6, emissive: '#3a2d00' }),
    zoneGreen: pbr(scene, 'zoneGreen', { color: '#35d07f', rough: 0.6, emissive: '#0d5a2e', alpha: 0.55 }),
    fence: pbr(scene, 'fence', { color: '#8e969c', metal: 0.7, rough: 0.4 }),
    container: memo((c) => pbr(scene, 'container' + c, { color: c, metal: 0.5, rough: 0.6 })),
    paint: memo((c) => pbr(scene, 'paint' + c, { color: c, metal: 0.35, rough: 0.35 })),
    light: pbr(scene, 'light', { color: '#fff7d6', emissive: '#fff2b0' }),
    redLight: pbr(scene, 'redLight', { color: '#ff3b30', emissive: '#a01010' }),
    leaves: pbr(scene, 'leaves', { color: '#3f6b2a', rough: 0.95 }),
    bark: pbr(scene, 'bark', { color: '#5a4030', rough: 1 }),
    sign: memo((text, bg, fg) => {
      const tex = canvasTexture(scene, 'sign' + text, 512, (ctx, s) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = String(text).split('\n');
        ctx.font = `bold ${lines.length > 1 ? 110 : 200}px Arial`;
        lines.forEach((l, i) => ctx.fillText(l, s / 2, s / 2 + (i - (lines.length - 1) / 2) * 130));
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
