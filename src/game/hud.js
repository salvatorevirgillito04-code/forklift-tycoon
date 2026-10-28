import { coinText } from '../ui/ui.js';
import { WAREHOUSES, WORLD } from '../data.js';
import { PLOT, plotToWorld, zoneRect, rackRect } from './world.js';
import { t, fmt } from '../i18n.js';
import { ICONS } from '../ui/icons.js';

const MARGIN = 10;
const MAP_W = WORLD.maxX - WORLD.minX + MARGIN * 2;
const MAP_H = WORLD.maxZ - WORLD.minZ + MARGIN * 2;

// Disegna la pianta statica del quartiere (nord in alto).
export function drawStaticMap(ctx, scale, owned) {
  const px = (x) => (x - WORLD.minX + MARGIN) * scale;
  const pz = (z) => (WORLD.maxZ - z + MARGIN) * scale;
  const rect = (x0, z0, x1, z1) => {
    const a = px(Math.min(x0, x1)), b = pz(Math.max(z0, z1));
    ctx.fillRect(a, b, Math.abs(x1 - x0) * scale, Math.abs(z1 - z0) * scale);
  };
  ctx.fillStyle = '#4a6b3a';
  ctx.fillRect(0, 0, MAP_W * scale, MAP_H * scale);
  ctx.fillStyle = '#a7a59d';
  rect(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ);
  ctx.fillStyle = '#4b4e53';
  rect(WORLD.minX, -WORLD.roadHalf, WORLD.maxX, WORLD.roadHalf);
  ctx.fillStyle = '#e8e8e0';
  for (let x = WORLD.minX + 2; x < WORLD.maxX; x += 6) rect(x, -0.25, x + 3, 0.25);
  for (const wh of WAREHOUSES) {
    const isOwned = owned.includes(wh.id);
    const B = PLOT.building;
    const [x0, z0] = plotToWorld(wh, B.u[0], B.w[0]);
    const [x1, z1] = plotToWorld(wh, B.u[1], B.w[1]);
    ctx.fillStyle = isOwned ? '#2f7de1' : '#7d858d';
    rect(x0, z0, x1, z1);
    ctx.fillStyle = isOwned ? '#9cd2ff' : '#555b61';
    const [d0x, d0z] = plotToWorld(wh, PLOT.door.u[0], B.w[0]);
    const [d1x, d1z] = plotToWorld(wh, PLOT.door.u[1], B.w[0] + 1.2);
    rect(d0x, d0z, d1x, d1z);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const u of [-PLOT.halfWidth, PLOT.halfWidth]) {
      const [a, b] = plotToWorld(wh, u - 0.3, PLOT.yard[0] + 1);
      const [c, d] = plotToWorld(wh, u + 0.3, 62);
      rect(a, b, c, d);
    }
    const [cx, cz] = plotToWorld(wh, 0, (B.w[0] + B.w[1]) / 2);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, 9 * scale)}px Lilita One, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(wh.id + 1), px(cx), pz(cz));
  }
}

export function worldToMap(x, z, scale) {
  return [(x - WORLD.minX + MARGIN) * scale, (WORLD.maxZ - z + MARGIN) * scale];
}

// Gocce di pioggia sulla visuale (prima persona): cerchietti trasparenti col bordo chiaro che a volte scivolano giu'
class RainDrops {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drops = [];
    this.acc = 0;
    this.on = false;
  }

  frame(dt, active) {
    const c = this.canvas;
    if (!active && !this.drops.length) {
      if (this.on) { this.ctx.clearRect(0, 0, c.width, c.height); this.on = false; }
      return;
    }
    this.on = true;
    // mezza risoluzione: basta per gocce sfocate e costa poco
    const w = Math.round(c.clientWidth / 2), h = Math.round(c.clientHeight / 2);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    const step = this.acc;
    this.acc = 0;
    if (active && this.drops.length < 40 && Math.random() < step * 9) {
      this.drops.push({ x: Math.random() * w, y: Math.random() * h * 0.9, r: 2 + Math.random() * 5, life: 0, max: 2 + Math.random() * 4, vy: 0 });
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this.drops = this.drops.filter((d) => {
      d.life += step;
      d.r = Math.min(d.r + step * 1.5, 9);
      // le gocce grandi scivolano
      if (d.r > 6.5) d.vy = Math.min(d.vy + step * 60, 90);
      d.y += d.vy * step;
      const fade = Math.min(1, d.life * 4) * Math.max(0, 1 - Math.max(0, d.life - d.max) * 2);
      if (fade <= 0 || d.y > h + 10) return false;
      if (d.vy > 1) {
        ctx.strokeStyle = `rgba(210,225,240,${0.12 * fade})`;
        ctx.lineWidth = d.r * 0.6;
        ctx.beginPath(); ctx.moveTo(d.x, d.y - d.vy * 0.4); ctx.lineTo(d.x, d.y); ctx.stroke();
      }
      const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.1, d.x, d.y, d.r);
      g.addColorStop(0, `rgba(255,255,255,${0.35 * fade})`);
      g.addColorStop(0.55, `rgba(200,215,235,${0.08 * fade})`);
      g.addColorStop(0.85, `rgba(40,50,60,${0.22 * fade})`);
      g.addColorStop(1, 'rgba(40,50,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      return true;
    });
  }
}

export class Hud {
  constructor(root, { onSettings, onMap, onCamera, onLights, coins }) {
    this.root = root;
    root.innerHTML = `
      <canvas class="rain-drops"></canvas>
      <div class="minimap"><canvas width="300" height="300"></canvas></div>
      <div class="top-right">
        <div class="coin-pill hud-coins">${ICONS.coin}<span>${coinText(coins)}</span></div>
        <button class="round-btn small" data-act="map" aria-label="${t('map')}">${ICONS.map}</button>
        <button class="round-btn small" data-act="settings" aria-label="${t('settings')}">${ICONS.gear}</button>
      </div>
      <button class="hud-cam" data-act="camera" aria-label="${t('view')}">${ICONS.camera}</button>
      <button class="hud-cam lights" data-act="lights" aria-label="${t('lights')}">${ICONS.headlight}</button>
      <div class="task-panel">
        <div class="task-stats">
          <div class="task-stat" data-stat="time">${ICONS.clock}<b class="timer">--:--</b></div>
          <div class="task-stat" data-stat="pallets">${ICONS.pallets}<b class="pallets">0/0</b></div>
          <div class="task-stat" data-stat="drops">${ICONS.drop}<b class="drops">0</b></div>
        </div>
      </div>
      <div class="gauges">
        <span class="chip speed"></span><span class="chip height"></span><span class="chip tilt"></span><span class="chip load"></span>
      </div>
      <div class="toast"></div>`;
    root.querySelector('[data-act="settings"]').addEventListener('click', onSettings);
    root.querySelector('[data-act="map"]').addEventListener('click', onMap);
    root.querySelector('[data-act="camera"]').addEventListener('click', onCamera);
    this.lightsBtn = root.querySelector('[data-act="lights"]');
    this.lightsBtn.addEventListener('click', () => onLights?.());
    this.rainDrops = new RainDrops(root.querySelector('.rain-drops'));
    this.canvas = root.querySelector('.minimap canvas');
    this.ctx = this.canvas.getContext('2d');
    this.els = {
      panel: root.querySelector('.task-panel'),
      timer: root.querySelector('.timer'),
      pallets: root.querySelector('.pallets'),
      drops: root.querySelector('.drops'),
      coins: root.querySelector('.hud-coins span'),
      speed: root.querySelector('.speed'),
      height: root.querySelector('.height'),
      tilt: root.querySelector('.tilt'),
      load: root.querySelector('.load'),
      toast: root.querySelector('.toast'),
    };
    this.toastTimer = null;
    this.mapScale = 3;
    this.lastTasks = '';
  }

  setOwned(owned) {
    const s = this.mapScale;
    this.staticMap = document.createElement('canvas');
    this.staticMap.width = MAP_W * s;
    this.staticMap.height = MAP_H * s;
    drawStaticMap(this.staticMap.getContext('2d'), s, owned);
  }

  setCoins(coins) {
    this.els.coins.textContent = coinText(coins);
  }

  setObjective(contract) {
    this.contract = contract;
    const timed = contract && contract.type !== 'free';
    this.els.panel.classList.toggle('free', !timed);
  }

  toast(text, kind = 'info') {
    const el = this.els.toast;
    el.textContent = text;
    el.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  update({ forklift, mission, pallets }) {
    const now = performance.now();
    if (now - (this.lastUpdate || 0) < 100) return;
    this.lastUpdate = now;
    const { els } = this;
    const c = mission.contract;
    if (c && c.type !== 'free') {
      const tl = Math.ceil(mission.timeLeft);
      els.timer.textContent = `${String(Math.floor(tl / 60)).padStart(2, '0')}:${String(tl % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('warn', tl <= 20);
      const { done, total } = mission.progress();
      els.pallets.textContent = `${done}/${total}`;
      els.drops.textContent = String(mission.drops);
      els.drops.classList.toggle('warn', mission.drops > 0);
    }
    els.speed.textContent = `${Math.abs(forklift.v * 3.6).toFixed(0)} km/h`;
    els.height.textContent = `↕ ${forklift.forkY.toFixed(2)} m`;
    // Inclinazione: positiva = forche all'indietro, negativa = in avanti
    const deg = forklift.tilt * 180 / Math.PI;
    els.tilt.textContent = `∠ ${deg > 0.05 ? '+' : ''}${deg.toFixed(1)}°`;
    els.load.textContent = forklift.carried ? `${fmt(forklift.carried.p.weight)} kg` : `0 / ${fmt(forklift.vehicle.capacity)} kg`;
    els.load.classList.toggle('warn', !!forklift.carried && forklift.carried.p.weight > forklift.vehicle.capacity * 0.8);
    this.drawMinimap(forklift, mission, pallets);
  }

  drawMinimap(f, mission, pallets) {
    const { ctx, canvas } = this;
    if (!this.staticMap) return;
    const size = canvas.width;
    const s = this.mapScale;
    const view = 70; // metri visibili
    const zoom = size / (view * s);
    const [mx, mz] = worldToMap(f.x, f.z, s);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-mx, -mz);
    ctx.drawImage(this.staticMap, 0, 0);
    const P = (x, z) => worldToMap(x, z, s);
    if (mission.contract && mission.wh && mission.contract.type !== 'free') {
      // Obiettivo: zona gialla (scarico) o pianale (carico)
      const wh = mission.wh;
      ctx.fillStyle = 'rgba(255,210,30,0.55)';
      const to = mission.route?.to;
      if (to === 'zone' || to === 'rack') {
        const z = to === 'zone' ? zoneRect(wh) : rackRect(wh);
        const [a, b] = P(z.minX, z.maxZ);
        ctx.fillRect(a, b, (z.maxX - z.minX) * s, (z.maxZ - z.minZ) * s);
      }
    }
    if (pallets.truckBed && mission.truck) {
      const b = pallets.truckBed;
      const [a, c] = P(b.x - b.hw, b.z + b.hd);
      ctx.fillStyle = mission.route?.to === 'truck' ? 'rgba(255,210,30,0.8)' : '#c0392b';
      ctx.fillRect(a, c, b.hw * 2 * s, b.hd * 2 * s);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(a + b.hw * 2 * s, c, 5 * s, b.hd * 2 * s);
    }
    for (const p of pallets.list) {
      const [a, c] = P(p.x, p.z);
      ctx.fillStyle = p.dropped ? '#ff4d4d' : '#ff9f1c';
      ctx.fillRect(a - 0.6 * s, c - 0.6 * s, 1.2 * s, 1.2 * s);
    }
    ctx.restore();
    // Freccia del giocatore al centro (nord in alto)
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(f.yaw);
    ctx.fillStyle = '#35d07f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(14, 16);
    ctx.lineTo(0, 8);
    ctx.lineTo(-14, 16);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}

export { MAP_W, MAP_H };
