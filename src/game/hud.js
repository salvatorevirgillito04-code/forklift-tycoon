import { WAREHOUSES, WORLD } from '../data.js';
import { PLOT, plotToWorld, zoneRect } from './world.js';
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

export class Hud {
  constructor(root, { onSettings, onMap }) {
    this.root = root;
    root.innerHTML = `
      <div class="minimap"><canvas width="300" height="300"></canvas></div>
      <div class="top-right">
        <button class="round-btn small" data-act="map" aria-label="${t('map')}">${ICONS.map}</button>
        <button class="round-btn small" data-act="settings" aria-label="${t('settings')}">${ICONS.gear}</button>
      </div>
      <div class="objective">
        <div class="obj-text"></div>
        <div class="obj-row">
          <span class="chip timer"></span>
          <span class="chip pallets"></span>
        </div>
      </div>
      <div class="gauges">
        <span class="chip speed"></span><span class="chip height"></span><span class="chip load"></span>
      </div>
      <div class="toast"></div>`;
    root.querySelector('[data-act="settings"]').addEventListener('click', onSettings);
    root.querySelector('[data-act="map"]').addEventListener('click', onMap);
    this.canvas = root.querySelector('.minimap canvas');
    this.ctx = this.canvas.getContext('2d');
    this.els = {
      obj: root.querySelector('.obj-text'),
      timer: root.querySelector('.timer'),
      pallets: root.querySelector('.pallets'),
      speed: root.querySelector('.speed'),
      height: root.querySelector('.height'),
      load: root.querySelector('.load'),
      toast: root.querySelector('.toast'),
    };
    this.toastTimer = null;
    this.mapScale = 3;
  }

  setOwned(owned) {
    const s = this.mapScale;
    this.staticMap = document.createElement('canvas');
    this.staticMap.width = MAP_W * s;
    this.staticMap.height = MAP_H * s;
    drawStaticMap(this.staticMap.getContext('2d'), s, owned);
  }

  setObjective(contract) {
    const key = !contract || contract.type === 'free' ? 'objFree' : contract.type === 'load' ? 'objLoad' : 'objUnload';
    this.els.obj.textContent = t(key);
    const timed = contract && contract.type !== 'free';
    this.els.timer.style.display = timed ? '' : 'none';
    this.els.pallets.style.display = timed ? '' : 'none';
  }

  toast(text, kind = 'info') {
    const el = this.els.toast;
    el.textContent = text;
    el.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  update({ forklift, mission, pallets }) {
    const { els } = this;
    if (mission.contract && mission.contract.type !== 'free') {
      const tl = Math.ceil(mission.timeLeft);
      els.timer.textContent = `⏱ ${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('warn', tl <= 20);
      const { done, total } = mission.progress();
      els.pallets.textContent = `▣ ${done}/${total}`;
    }
    els.speed.textContent = `${Math.abs(forklift.v * 3.6).toFixed(0)} km/h`;
    els.height.textContent = `↕ ${forklift.forkY.toFixed(2)} m`;
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
      if (mission.contract.type === 'unload') {
        const z = zoneRect(wh);
        const [a, b] = P(z.minX, z.maxZ);
        ctx.fillRect(a, b, (z.maxX - z.minX) * s, (z.maxZ - z.minZ) * s);
      }
    }
    if (pallets.truckBed && mission.truck) {
      const b = pallets.truckBed;
      const [a, c] = P(b.x - b.hw, b.z + b.hd);
      ctx.fillStyle = mission.contract?.type === 'load' ? 'rgba(255,210,30,0.8)' : '#c0392b';
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
