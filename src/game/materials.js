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

// Facciata del capannone (9 m di altezza, si ripete ogni 6 m): lamiera grecata chiara, fascia del colore
// dell'azienda in alto, finestre a nastro, sporco alla base. Tutto disegnato: nessun pezzo 3D in piu'.
function facadeTexture(scene, color) {
  const W = 512, H = 1024, pxm = H / 9; // pixel per metro in altezza
  const tex = new DynamicTexture('facade' + color, { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  const y = (m) => H - m * pxm; // altezza in metri -> riga (in alto = 9 m)
  // lamiera: nervature verticali ogni 25 cm (6 m = 512 px)
  ctx.fillStyle = '#c9ced3';
  ctx.fillRect(0, 0, W, H);
  const rib = W / 24;
  for (let x = 0; x < W; x += rib) {
    const g = ctx.createLinearGradient(x, 0, x + rib, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.04)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, rib, H);
  }
  // giunti orizzontali tra i pannelli
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (const m of [3, 5.9]) ctx.fillRect(0, y(m), W, 3);
  // fascia in alto col colore dell'azienda
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, y(8.35));
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, y(8.35) - 6, W, 3);
  // finestre a nastro (6,4 - 7,4 m): telaio scuro, vetri con riflesso
  const top = y(7.4), bot = y(6.4);
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(0, top - 6, W, bot - top + 12);
  const pane = W / 4;
  for (let x = 0; x < W; x += pane) {
    const g = ctx.createLinearGradient(x, top, x + pane, bot);
    g.addColorStop(0, '#9fb7c9');
    g.addColorStop(0.45, '#5f7a90');
    g.addColorStop(0.5, '#b7cad8');
    g.addColorStop(0.56, '#58718a');
    g.addColorStop(1, '#3f566b');
    ctx.fillStyle = g;
    ctx.fillRect(x + 5, top, pane - 10, bot - top);
  }
  // colature sotto le finestre e sporco alla base
  for (let x = 6; x < W; x += pane / 2) {
    const g = ctx.createLinearGradient(0, bot + 6, 0, bot + 150);
    g.addColorStop(0, 'rgba(60,55,50,0.18)');
    g.addColorStop(1, 'rgba(60,55,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + Math.random() * 40, bot + 6, 10 + Math.random() * 14, 150);
  }
  const dirt = ctx.createLinearGradient(0, y(1.2), 0, H);
  dirt.addColorStop(0, 'rgba(70,62,52,0)');
  dirt.addColorStop(1, 'rgba(70,62,52,0.45)');
  ctx.fillStyle = dirt;
  ctx.fillRect(0, y(1.2), W, H - y(1.2));
  for (let i = 0; i < 2500; i++) {
    const v = Math.floor(Math.random() * 120);
    ctx.fillStyle = `rgba(${v},${v},${v},0.06)`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

// Insegna dell'azienda: nome grande, logo semplice e numero del magazzino
function companySignTexture(scene, name, color, num) {
  const W = 1024, H = 256;
  const tex = new DynamicTexture('company' + name, { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, 18);
  ctx.fillRect(0, H - 18, W, 18);
  // logo: cerchio con freccia (merce in movimento)
  ctx.beginPath();
  ctx.arc(128, H / 2, 82, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(80, 104); ctx.lineTo(150, 104); ctx.lineTo(150, 78); ctx.lineTo(192, 128);
  ctx.lineTo(150, 178); ctx.lineTo(150, 152); ctx.lineTo(80, 152);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1f2933';
  ctx.textBaseline = 'middle';
  let size = 96;
  ctx.font = `900 ${size}px Arial`;
  const maxW = W - 260 - 150;
  while (ctx.measureText(name).width > maxW && size > 40) { size -= 4; ctx.font = `900 ${size}px Arial`; }
  ctx.fillText(name, 240, H / 2 + 4);
  ctx.fillStyle = color;
  ctx.font = '900 64px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(`#${num}`, W - 40, H / 2 + 4);
  tex.update();
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

// Controsoffitto del capannone (30 x 26 m): pannelli chiari e tre lucernari lungo la larghezza.
// Restituisce colore e maschera dei lucernari (la luce cambia con l'ora: vedi environment.js)
function ceilingTextures(scene) {
  const S = 512;
  const col = new DynamicTexture('ceilingCol', S, scene, true);
  const mask = new DynamicTexture('ceilingMask', S, scene, true);
  const c = col.getContext(), k = mask.getContext();
  c.fillStyle = '#cfd4d8';
  c.fillRect(0, 0, S, S);
  c.strokeStyle = 'rgba(0,0,0,0.14)';
  c.lineWidth = 2;
  for (let x = 0; x < S; x += S / 30) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
  k.fillStyle = '#000';
  k.fillRect(0, 0, S, S);
  // lucernari: strisce lungo u (x della texture), a 1/4, 1/2 e 3/4 della profondita'
  for (const f of [0.22, 0.5, 0.78]) {
    const y = f * S;
    c.fillStyle = '#e9f2f8';
    c.fillRect(S * 0.08, y - 14, S * 0.84, 28);
    c.fillStyle = '#7d8790';
    for (let x = S * 0.08; x <= S * 0.92; x += S * 0.084) c.fillRect(x - 1, y - 14, 3, 28);
    k.fillStyle = '#fff';
    k.fillRect(S * 0.08, y - 14, S * 0.84, 28);
  }
  col.update();
  mask.update();
  return { col, mask };
}

// Cartelli di sicurezza (solo simboli, valgono in ogni lingua)
function safetySignTexture(scene, kind) {
  const S = 256;
  const tex = new DynamicTexture('safety' + kind, S, scene, true);
  const c = tex.getContext();
  const bg = { fire: '#d0261d', aid: '#1f9a4b', forklift: '#f4c20d', helmet: '#1f5fa8' }[kind];
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, S, S);
  c.fillStyle = bg;
  if (kind === 'forklift') {
    c.beginPath(); c.moveTo(S / 2, 18); c.lineTo(S - 18, S - 26); c.lineTo(18, S - 26); c.closePath(); c.fill();
    c.lineWidth = 12; c.strokeStyle = '#111'; c.stroke();
    c.fillStyle = '#111';
    c.fillRect(82, 130, 70, 50); c.fillRect(150, 100, 10, 80); c.fillRect(150, 170, 40, 8);
    c.beginPath(); c.arc(100, 186, 12, 0, 7); c.arc(140, 186, 12, 0, 7); c.fill();
  } else if (kind === 'helmet') {
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 12, 0, 7); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(S / 2, 150, 62, Math.PI, 0); c.fill(); c.fillRect(56, 146, 144, 16);
  } else {
    c.fillRect(14, 14, S - 28, S - 28);
    c.fillStyle = '#fff';
    if (kind === 'aid') { c.fillRect(104, 56, 48, 144); c.fillRect(56, 104, 144, 48); }
    else { c.fillRect(100, 92, 48, 120); c.fillRect(92, 70, 64, 26); c.fillRect(150, 74, 40, 12); c.fillRect(184, 74, 10, 50); }
  }
  tex.update();
  return tex;
}

// Autobloccanti del marciapiede (1 m): mattoncini sfalsati grigio-sabbia
function pavingTexture(scene) {
  return canvasTexture(scene, 'paving', 256, (c, s) => {
    c.fillStyle = '#b9b3a8';
    c.fillRect(0, 0, s, s);
    const bw = s / 4, bh = s / 8;
    for (let r = 0; r < 8; r++) {
      for (let k = -1; k < 5; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        const v = 165 + Math.floor(Math.random() * 30);
        c.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        c.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
  });
}

// Rete metallica a maglie romboidali (trasparente tra i fili)
function wireTexture(scene) {
  const tex = new DynamicTexture('wire', 128, scene, true);
  const c = tex.getContext();
  c.clearRect(0, 0, 128, 128);
  c.strokeStyle = 'rgba(70,92,74,1)';
  c.lineWidth = 3;
  for (let k = -128; k <= 256; k += 32) {
    c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 128, 128); c.stroke();
    c.beginPath(); c.moveTo(k, 128); c.lineTo(k + 128, 0); c.stroke();
  }
  tex.update();
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

// Scritte e segni a terra (bianco su trasparente): STOP, freccia
function groundMarkTexture(scene, kind) {
  const tex = new DynamicTexture('mark' + kind, { width: 512, height: 256 }, scene, true);
  const c = tex.getContext();
  c.clearRect(0, 0, 512, 256);
  // il piano a terra mostra la texture specchiata: si disegna gia' specchiata
  c.translate(512, 0);
  c.scale(-1, 1);
  c.fillStyle = 'rgba(240,240,232,1)';
  if (kind === 'stop') {
    c.font = '900 200px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('STOP', 256, 136);
  } else {
    c.beginPath();
    c.moveTo(40, 100); c.lineTo(330, 100); c.lineTo(330, 40); c.lineTo(480, 128);
    c.lineTo(330, 216); c.lineTo(330, 156); c.lineTo(40, 156);
    c.closePath(); c.fill();
  }
  tex.update();
  tex.hasAlpha = true;
  return tex;
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
    plinth: pbr(scene, 'plinth', { color: '#8d9196', rough: 0.92 }),
    beam: pbr(scene, 'beam', { color: '#6f8194', metal: 0.55, rough: 0.45 }),
    paving: (() => { const m = pbr(scene, 'paving', { color: '#ffffff', rough: 0.9, tex: pavingTexture(scene) }); m.metadata = { tile: 1 }; return m; })(),
    curb: pbr(scene, 'curb', { color: '#a9adb0', rough: 0.85 }),
    soil: pbr(scene, 'soil', { color: '#4a3b2c', rough: 1 }),
    bush: pbr(scene, 'bush', { color: '#3f6b2e', rough: 0.95 }),
    bush2: pbr(scene, 'bush2', { color: '#577f34', rough: 0.95 }),
    fencePost: pbr(scene, 'fencePost', { color: '#3c5a42', metal: 0.5, rough: 0.5 }),
    wire: (() => {
      const m = pbr(scene, 'wireMesh', { color: '#ffffff', metal: 0.6, rough: 0.45, tex: wireTexture(scene) });
      m.transparencyMode = 1; // solo i fili: niente fusione trasparente
      m.useAlphaFromAlbedoTexture = true;
      m.alphaCutOff = 0.4;
      m.backFaceCulling = false;
      m.metadata = { tile: 1 };
      return m;
    })(),
    hatch: pbr(scene, 'hatch', { color: '#f4c20d', rough: 0.6, emissive: '#3a2d00' }),
    groundMark: memo((kind) => {
      const tex = groundMarkTexture(scene, kind);
      const m = pbr(scene, 'groundMark' + kind, { color: '#ffffff', rough: 0.7, tex });
      m.useAlphaFromAlbedoTexture = true;
      m.transparencyMode = 1;
      m.alphaCutOff = 0.5;
      return m;
    }),
    gutter: pbr(scene, 'gutter', { color: '#9aa2aa', metal: 0.6, rough: 0.4 }),
    container: memo((c) => pbr(scene, 'container' + c, { color: c, metal: 0.5, rough: 0.6 })),
    paint: memo((c) => pbr(scene, 'paint' + c, { color: c, metal: 0.35, rough: 0.35 })),
    // facciata del capannone: u ogni 6 m, v da terra (0) al tetto (9 m)
    facade: memo((c) => {
      const m = pbr(scene, 'facadeMat' + c, { color: '#ffffff', metal: 0.3, rough: 0.55, tex: facadeTexture(scene, c) });
      m.metadata = { tile: 6, tileY: 9 };
      return m;
    }),
    ceiling: (() => {
      const { col, mask } = ceilingTextures(scene);
      const m = pbr(scene, 'ceiling', { color: '#ffffff', rough: 0.85, tex: col });
      m.emissiveTexture = mask; // lucernari: la luce la regola l'ora del giorno
      m.emissiveColor = new Color3(0.85, 0.9, 0.95);
      return m;
    })(),
    safety: memo((kind) => {
      const tex = safetySignTexture(scene, kind);
      const m = pbr(scene, 'safety' + kind, { color: '#ffffff', rough: 0.6, tex });
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(0.25, 0.25, 0.25);
      return m;
    }),
    extinguisher: pbr(scene, 'extinguisher', { color: '#c4161c', metal: 0.3, rough: 0.35 }),
    companySign: memo((name, color, num) => {
      const tex = companySignTexture(scene, name, color, num);
      const m = pbr(scene, 'companySign' + name, { color: '#ffffff', rough: 0.5, tex });
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(0.3, 0.3, 0.3);
      return m;
    }),
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
