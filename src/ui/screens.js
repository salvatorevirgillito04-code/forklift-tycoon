import { t, fmt, LANGS, getLang, setLang } from '../i18n.js';
import { ICONS } from './icons.js';
import { IS_NATIVE, APK_URL, APP_VERSION, BUILD_DATE } from '../config.js';
import { $, esc, coinPill, coinText, openModal, confirmDialog, toast } from './ui.js';
import {
  save, buyVehicle, buyWarehouse, resetSave, persist, equipVehicle, ownedCount, assignedCount, freeUnits,
  freeSlots, canAfford, dev, hireWorker, trainWorker, fireWorker, setWorkerVehicle, workersNetPerHour, accrueWorkers,
} from '../state.js';
import {
  VEHICLES, WAREHOUSES, DIFFICULTIES, TIMES, WEATHERS, unitPrice, makeContract, vehicleById, xpForLevel,
  workerSlots, hireCost, trainCost, workerIncome, makeCandidates, WORKER_MAX_LEVEL,
} from '../data.js';
import { isLinked, getUser, linkEmail, logout, isOnline } from '../cloud.js';
import { drawStaticMap, worldToMap, MAP_W, MAP_H } from '../game/hud.js';
import { PLOT, plotToWorld } from '../game/world.js';
import { Controls } from '../game/controls.js';

const screenEl = () => $('#screen');

function topBar(back) {
  return `<div class="top-bar">
    ${back ? `<button class="round-btn small" data-back aria-label="${t('back')}">${ICONS.back}</button>` : `<div class="level-badge"><b>${save.level}</b><span>${t('level')}</span></div>`}
    ${coinPill(save.coins)}
  </div>`;
}

function bindBack(app, target = 'home') {
  screenEl().querySelector('[data-back]')?.addEventListener('click', () => app.go(target));
}

// ---------- HOME ----------
export function renderHome(app) {
  const lang = LANGS.find((l) => l.id === getLang());
  screenEl().innerHTML = `
    <div class="home">
      ${topBar(false)}
      <div class="logo">
        <div class="logo-rays"></div>
        <h1 class="logo-1">${t('title1')}</h1>
        <h2 class="logo-2">${t('title2')}</h2>
      </div>
      ${isAndroidWeb() ? `<a class="pill-btn blue install-btn" href="${APK_URL}" download>${t('downloadApk')}</a>`
    : app.installPrompt || needsIosInstall() ? `<button class="pill-btn blue install-btn" data-act="install">${t('installApp')}</button>` : ''}
      <div class="home-buttons">
        <button class="big-btn green" data-go="hub">${t('play')}</button>
        <button class="big-btn blue" data-go="profile">${ICONS.user}<span>${t('profile')}</span></button>
        <div class="big-btn-wrap">
          <div class="bubble">${t('level')} ${save.level}<br><small>${t('contractLevel', { n: save.contractLevel })}</small></div>
          <button class="big-btn slate" data-act="settings">${ICONS.gear}<span>${t('settings')}</span></button>
        </div>
      </div>
      <div class="home-corner left">
        <button class="round-btn" data-act="login" aria-label="${t('login')}">${ICONS.user}</button>
        <span class="corner-label">${isLinked() ? '✓' : t('login')}</span>
      </div>
      <div class="home-corner right">
        <button class="round-btn" data-act="lang" aria-label="${t('language')}">${ICONS.globe}</button>
        <span class="corner-label">${lang.flag} ${lang.id.toUpperCase()}</span>
      </div>
    </div>`;
  const el = screenEl();
  el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => app.go(b.dataset.go)));
  el.querySelector('[data-act="settings"]').addEventListener('click', () => openSettings(app));
  el.querySelector('[data-act="lang"]').addEventListener('click', () => openLanguage(app));
  el.querySelector('[data-act="login"]').addEventListener('click', () => openLogin(app));
  el.querySelector('[data-act="install"]')?.addEventListener('click', async () => {
    const prompt = app.installPrompt;
    if (!prompt) return openIosInstall();
    prompt.prompt();
    await prompt.userChoice;
    app.installPrompt = null;
    renderHome(app);
  });
}

// iPhone/iPad: Safari non ha il pulsante di installazione, si spiega come aggiungere l'icona alla Home.
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroidWeb = () => !IS_NATIVE && /Android/i.test(navigator.userAgent);
const needsIosInstall = () => isIos() && !navigator.standalone && !matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function openIosInstall() {
  openModal(`
    <h2 class="modal-title">${t('iosTitle')}</h2>
    <ol class="ios-steps">
      <li>${t('iosStep1')}</li>
      <li><span>${t('iosStep2', { i: SHARE_ICON })}</span></li>
      <li><span>${t('iosStep3', { i: ADD_ICON })}</span></li>
      <li>${t('iosStep4')}</li>
    </ol>
    <p class="modal-text small">${t('iosNote')}</p>`, { className: 'small' });
}

// ---------- HUB ----------
export function renderHub(app) {
  const tile = (go, icon, label, cls, locked = false) => `
    <button class="tile ${cls} ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-go="${go}"`}>
      <div class="tile-icon">${locked ? ICONS.lock : icon}</div>
      <span>${label}</span>
      ${locked ? `<small>${t('comingSoon')}</small>` : ''}
    </button>`;
  screenEl().innerHTML = `
    <div class="page">
      ${topBar(true)}
      <div class="tiles">
        ${tile('contracts', ICONS.contract, t('contracts'), 'green')}
        ${tile('garage', ICONS.forklift, t('garage'), 'blue')}
        ${tile('warehouses', ICONS.warehouse, t('warehouses'), 'orange')}
        ${tile('free', ICONS.play, t('freeDrive'), 'purple')}
        ${tile('workers', ICONS.workers, t('workers'), 'slate')}
      </div>
    </div>`;
  bindBack(app);
  screenEl().querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.go === 'free') {
      app.startMission({ type: 'free', warehouseId: save.warehouses[0], level: 0, seed: 0, weight: 600, pallets: 3 });
    } else app.go(b.dataset.go);
  }));
}

// ---------- CONTRATTI ----------
// Menu sviluppatore: orario e meteo scelti a mano al posto di quelli a caso
const devSky = (c) => (dev.on ? { ...c, time: dev.time || c.time, weather: dev.weather || c.weather } : c);
let selectedWarehouse = 0;
export function renderContracts(app) {
  if (!save.warehouses.includes(selectedWarehouse)) selectedWarehouse = save.warehouses[0];
  const veh = vehicleById(save.activeVehicle);
  const lvl = save.contractLevel;
  const cards = DIFFICULTIES.map((d) => {
    const c = devSky(makeContract(lvl, d, selectedWarehouse, save.contractSeed));
    const tooHeavy = c.weight > veh.capacity;
    return `<div class="contract-card ${d}">
        <div class="contract-head">${t(d)}</div>
        <div class="contract-body">
          <div class="contract-type">${ICONS.truck}<b>${t(c.type)}</b>${c.fragile ? `<em>${t('fragile')}</em>` : ''}</div>
          <div class="contract-sky ${c.weather}">${ICONS[c.time === 'day' ? 'sun' : c.time === 'night' ? 'moon' : c.time]}<span>${t('t_' + c.time)}</span>
            ${c.weather !== 'clear' ? `${ICONS[c.weather]}<span>${t('w_' + c.weather)}</span>` : ''}
            ${c.bonus > 1 ? `<i>+${Math.round((c.bonus - 1) * 100)}%</i>` : ''}</div>
          <ul>
            <li><span>${t('pallets')}</span><b>${c.pallets}</b></li>
            <li><span>${t('weight')}</span><b class="${tooHeavy ? 'bad' : ''}">${fmt(c.weight)} kg</b></li>
            <li><span>${t('time')}</span><b>${Math.floor(c.timeLimit / 60)}:${String(c.timeLimit % 60).padStart(2, '0')}</b></li>
            <li><span>${t('xp')}</span><b>+${c.xp}</b></li>
          </ul>
          <div class="contract-reward">${ICONS.coin}<b>${fmt(c.reward)}</b></div>
          ${tooHeavy ? `<div class="contract-warn">${t('needCapacity', { n: fmt(c.weight) })}</div>` : ''}
          <button class="pill-btn ${tooHeavy ? 'grey' : 'green'}" data-diff="${d}" ${tooHeavy ? 'disabled' : ''}>${t('accept')}</button>
        </div>
      </div>`;
  }).join('');
  screenEl().innerHTML = `
    <div class="page">
      ${topBar(true)}
      <h2 class="page-title">${t('contracts')} · ${t('contractLevel', { n: lvl })}</h2>
      <div class="wh-tabs">
        ${save.warehouses.map((id) => `<button class="wh-tab ${id === selectedWarehouse ? 'on' : ''}" data-wh="${id}">
          ${t('warehouse', { n: id + 1 })}<small>${t('rewardMult', { n: WAREHOUSES[id].rewardMult })}</small></button>`).join('')}
      </div>
      <div class="contract-list">${cards}</div>
      <p class="hint">${ICONS.forklift} ${esc(veh.name)} · ${t('capacity')} ${fmt(veh.capacity)} kg</p>
    </div>`;
  bindBack(app, 'hub');
  screenEl().querySelectorAll('[data-wh]').forEach((b) => b.addEventListener('click', () => {
    selectedWarehouse = +b.dataset.wh;
    renderContracts(app);
  }));
  screenEl().querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    app.startMission(devSky(makeContract(lvl, b.dataset.diff, selectedWarehouse, save.contractSeed)));
  }));
}

// ---------- GARAGE ----------
export function renderGarage(app) {
  const maxOf = (k) => Math.max(...VEHICLES.map((v) => v[k]));
  const bar = (label, val, max, unit) => `<div class="stat"><span>${label}</span>
      <div class="bar"><i style="width:${Math.round((val / max) * 100)}%"></i></div><b>${unit}</b></div>`;
  const cards = VEHICLES.map((v) => {
    const count = ownedCount(v.id);
    const active = save.activeVehicle === v.id;
    const price = unitPrice(v, count);
    const canBuy = canAfford(price) ? 'green' : 'grey';
    let btns;
    if (!count) btns = `<button class="pill-btn ${canBuy}" data-buy="${v.id}">${ICONS.coin}${fmt(price)}</button>`;
    else {
      const equip = active
        ? `<button class="pill-btn grey" disabled>${t('equipped')}</button>`
        : `<button class="pill-btn ${freeUnits(v.id) > 0 ? 'blue' : 'grey'}" data-equip="${v.id}">${t('equip')}</button>`;
      btns = `${equip}<button class="pill-btn small ${canBuy}" data-buy="${v.id}">+1 ${ICONS.coin}${fmt(price)}</button>`;
    }
    return `<div class="vehicle-card ${active ? 'active' : ''}">
        <div class="vehicle-photo" style="--c:${v.color}">
          <img src="${import.meta.env.BASE_URL}garage/${v.photo}" alt="${esc(v.name)}" loading="lazy">
          ${count > 1 ? `<span class="unit-count">×${count}</span>` : ''}
        </div>
        <div class="vehicle-info">
          <h3>${esc(v.name)} ${v.price === 0 ? `<small>${t('starter')}</small>` : ''}</h3>
          ${bar(t('capacity'), v.capacity, maxOf('capacity'), `${fmt(v.capacity)} kg`)}
          ${bar(t('liftHeight'), v.lift, maxOf('lift'), `${v.lift} m`)}
          ${bar(t('speed'), v.speed, maxOf('speed'), `${Math.round(v.speed * 3.6)} km/h`)}
          ${count ? `<small class="units">${t('units', { n: count, a: assignedCount(v.id) })}</small>` : ''}
        </div>
        <div class="vehicle-action">${btns}</div>
      </div>`;
  }).join('');
  screenEl().innerHTML = `<div class="page">${topBar(true)}<h2 class="page-title">${t('garage')}</h2>
    <div class="vehicle-list">${cards}</div></div>`;
  bindBack(app, 'hub');
  screenEl().querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => {
    if (!equipVehicle(b.dataset.equip)) return toast(t('workerBusy'), 'bad');
    renderGarage(app);
  }));
  screenEl().querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
    const v = vehicleById(b.dataset.buy);
    const price = unitPrice(v, ownedCount(v.id));
    if (!canAfford(price)) return toast(t('notEnoughCoins'), 'bad');
    if (!(await confirmDialog(`${v.name}: ${t('buyFor', { n: fmt(price) })}?`))) return;
    if (buyVehicle(v.id)) toast(t('bought'), 'good');
    renderGarage(app);
  }));
}

// ---------- OPERAI ----------
export function avatarSvg(a) {
  return `<svg class="worker-avatar" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="#2b4a6f"/>
    <path d="M12 64c2-12 10-17 20-17s18 5 20 17z" fill="#f08a24"/>
    <path d="M24 49l8 9 8-9" fill="none" stroke="#e8ecef" stroke-width="3"/>
    <circle cx="32" cy="33" r="13" fill="${a.skin}"/>
    <path d="M19 32c0-6 3-10 13-10s13 4 13 10c-2-3-6-4-13-4s-11 1-13 4z" fill="${a.hair}"/>
    ${a.beard ? `<path d="M20 35c1 9 6 12 12 12s11-3 12-12c-3 4-7 5-12 5s-9-1-12-5z" fill="${a.hair}"/>` : ''}
    <circle cx="27" cy="34" r="1.6" fill="#222"/><circle cx="37" cy="34" r="1.6" fill="#222"/>
    <path d="M28 40q4 3 8 0" fill="none" stroke="#7a3b2a" stroke-width="1.6" stroke-linecap="round"/>
    ${a.glasses ? '<g fill="none" stroke="#222" stroke-width="1.4"><circle cx="27" cy="34" r="3.6"/><circle cx="37" cy="34" r="3.6"/><path d="M30.6 34h2.8"/></g>' : ''}
    <path d="M17 27c0-9 7-14 15-14s15 5 15 14z" fill="${a.helmet}"/>
    <rect x="14" y="25.5" width="36" height="3.5" rx="1.75" fill="${a.helmet}" stroke="rgba(0,0,0,.18)"/>
    <path d="M30 13.5h4v12h-4z" fill="rgba(0,0,0,.12)"/>
  </svg>`;
}

const money = (n) => `${ICONS.coin}${fmt(n)}`;

export function renderWorkers(app) {
  accrueWorkers();
  const sections = save.warehouses.map((whId) => {
    const wh = WAREHOUSES[whId];
    const list = save.workers.filter((w) => w.warehouse === whId);
    const cards = list.map((w) => {
      const inc = workerIncome(w);
      const max = w.level >= WORKER_MAX_LEVEL;
      return `<div class="worker-card">
          ${avatarSvg(w.avatar)}
          <div class="worker-info">
            <h3>${esc(w.name)}</h3>
            <span class="worker-level">${t('level')} ${w.level}</span>
            <button class="worker-veh" data-veh="${w.id}">${ICONS.forklift}<span>${esc(vehicleById(w.vehicle).name)}</span><em>${t('change')}</em></button>
            <div class="worker-money"><span class="good">+${fmt(inc.gross)}</span><span class="bad">−${fmt(inc.salary)}</span>
              <b>${t('perHour', { n: fmt(inc.net) })}</b></div>
          </div>
          <div class="worker-actions">
            <button class="link-btn" data-fire="${w.id}">${t('fire')}</button>
            ${max ? `<button class="pill-btn grey small" disabled>${t('maxLevel')}</button>`
    : `<button class="pill-btn small ${canAfford(trainCost(w.level)) ? 'blue' : 'grey'}" data-train="${w.id}">${t('train')} ${money(trainCost(w.level))}</button>`}
          </div>
        </div>`;
    });
    for (let i = list.length; i < workerSlots(whId); i++) {
      cards.push(`<button class="worker-card empty" data-hire="${whId}"><div class="worker-plus">+</div>
        <div class="worker-info"><h3>${t('emptySlot')}</h3><small>${t('hire')}</small></div></button>`);
    }
    return `<section class="worker-section">
        <h3 class="worker-section-title">${t('warehouse', { n: whId + 1 })}
          <small>${t('rewardMult', { n: wh.rewardMult })} · ${t('slotsInfo', { n: workerSlots(whId) })}</small></h3>
        <div class="worker-grid">${cards.join('')}</div>
      </section>`;
  }).join('');
  screenEl().innerHTML = `<div class="page">${topBar(true)}
    <h2 class="page-title">${t('workers')}</h2>
    <p class="team-income">${t('teamIncome', { n: fmt(workersNetPerHour()) })}</p>
    <div class="worker-list">${sections}</div>
    ${save.warehouses.length < WAREHOUSES.length ? `<p class="hint">${ICONS.warehouse} ${t('noWarehouseSlots')}</p>` : ''}
  </div>`;
  bindBack(app, 'hub');
  const el = screenEl();
  const refresh = () => renderWorkers(app);
  el.querySelectorAll('[data-hire]').forEach((b) => b.addEventListener('click', () => openHire(app, +b.dataset.hire, refresh)));
  el.querySelectorAll('[data-veh]').forEach((b) => b.addEventListener('click', () => openWorkerVehicle(b.dataset.veh, refresh)));
  el.querySelectorAll('[data-train]').forEach((b) => b.addEventListener('click', () => {
    const w = save.workers.find((x) => x.id === b.dataset.train);
    if (!canAfford(trainCost(w.level))) return toast(t('notEnoughCoins'), 'bad');
    if (trainWorker(w.id)) toast(`${w.name} · ${t('level')} ${w.level}`, 'good');
    refresh();
  }));
  el.querySelectorAll('[data-fire]').forEach((b) => b.addEventListener('click', async () => {
    const w = save.workers.find((x) => x.id === b.dataset.fire);
    if (!(await confirmDialog(t('confirmFire', { n: w.name })))) return;
    fireWorker(w.id);
    refresh();
  }));
}

// Elenco dei modelli con almeno un muletto libero per un operaio.
function vehicleChoices(current) {
  return VEHICLES.filter((v) => v.id === current || freeUnits(v.id, true) > 0);
}

function openHire(app, whId, onDone) {
  if (freeSlots(whId) < 1) return;
  const candidates = makeCandidates(save.candidateSeed);
  const choices = vehicleChoices();
  let vehicle = choices.length ? choices[choices.length - 1].id : null; // di default il piu' potente libero
  const { el, close } = openModal(`
    <h2 class="modal-title">${t('candidates')} · ${t('warehouse', { n: whId + 1 })}</h2>
    <div class="setting"><span>${t('chooseForklift')}</span>
      ${choices.length ? `<div class="segmented wrap" data-vehicles>${choices.map((v) => `<button class="${v.id === vehicle ? 'on' : ''}" data-v="${v.id}">
        ${esc(v.name)} <small>×${freeUnits(v.id, true)}</small></button>`).join('')}</div>`
    : `<p class="modal-text small">${t('noFreeForklift')}</p>`}
    </div>
    <div class="candidate-list">${candidates.map((c) => {
    const cost = hireCost(save.workers.length, c.level);
    return `<div class="candidate">
        ${avatarSvg(c.avatar)}
        <b>${esc(c.name)}</b><small>${t('level')} ${c.level}</small>
        <small class="cand-net"></small>
        <button class="pill-btn small ${choices.length && canAfford(cost) ? 'green' : 'grey'}" data-cand="${c.id}" ${choices.length ? '' : 'disabled'}>${t('hire')} ${money(cost)}</button>
      </div>`;
  }).join('')}</div>
    ${choices.length ? '' : `<button class="pill-btn blue" data-garage>${t('garage')}</button>`}`, { className: 'hire' });
  const showNet = () => el.querySelectorAll('.candidate').forEach((node, i) => {
    if (!vehicle) return;
    const inc = workerIncome({ vehicle, warehouse: whId, level: candidates[i].level });
    node.querySelector('.cand-net').textContent = `${t('net')} ${t('perHour', { n: fmt(inc.net) })}`;
  });
  showNet();
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    vehicle = b.dataset.v;
    el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
    showNet();
  }));
  el.querySelector('[data-garage]')?.addEventListener('click', () => { close(); app.go('garage'); });
  el.querySelectorAll('[data-cand]').forEach((b) => b.addEventListener('click', () => {
    const c = candidates.find((x) => x.id === b.dataset.cand);
    if (!canAfford(hireCost(save.workers.length, c.level))) return toast(t('notEnoughCoins'), 'bad');
    if (hireWorker(c, whId, vehicle)) {
      toast(`${c.name}: ${t('hired')}`, 'good');
      close();
      onDone();
    }
  }));
}

function openWorkerVehicle(workerId, onDone) {
  const w = save.workers.find((x) => x.id === workerId);
  const { el, close } = openModal(`
    <h2 class="modal-title">${esc(w.name)} · ${t('chooseForklift')}</h2>
    <div class="lang-list">${vehicleChoices(w.vehicle).map((v) => {
    const inc = workerIncome({ ...w, vehicle: v.id });
    return `<button class="lang-btn ${v.id === w.vehicle ? 'on' : ''}" data-v="${v.id}">${esc(v.name)}
        <small>${t('perHour', { n: fmt(inc.net) })}</small></button>`;
  }).join('')}</div>
    <p class="modal-text small">${t('noFreeForklift')}</p>`, { className: 'small' });
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    setWorkerVehicle(w.id, b.dataset.v);
    close();
    onDone();
  }));
}

// ---------- MAPPA / MAGAZZINI ----------
export function mapHtml() {
  return `<div class="map-wrap" style="--map-ar:${(MAP_W / MAP_H).toFixed(4)}"><canvas class="map-canvas"></canvas><div class="map-pins"></div></div>`;
}

export function bindMap(root, onChange, playerPos = null) {
  const canvas = root.querySelector('.map-canvas');
  const pins = root.querySelector('.map-pins');
  const draw = () => {
    const scale = 4;
    canvas.width = MAP_W * scale;
    canvas.height = MAP_H * scale;
    const ctx = canvas.getContext('2d');
    drawStaticMap(ctx, scale, save.warehouses);
    if (playerPos) {
      // Freccia del muletto: punta dove guarda (nord in alto, come la minimappa)
      const [x, y] = worldToMap(playerPos.x, playerPos.z, scale);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(playerPos.yaw || 0);
      ctx.scale(1.5, 1.5);
      ctx.fillStyle = '#35d07f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(11, 12);
      ctx.lineTo(0, 6);
      ctx.lineTo(-11, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    pins.innerHTML = WAREHOUSES.map((wh) => {
      const owned = save.warehouses.includes(wh.id);
      // etichetta sopra il capannone: il piazzale (dove sta il muletto) resta libero
      const [x, z] = plotToWorld(wh, 0, (PLOT.building.w[0] + PLOT.building.w[1]) / 2);
      const [px, py] = worldToMap(x, z, 1);
      return `<button class="map-pin ${owned ? 'owned' : ''}" data-wh="${wh.id}"
          style="left:${(px / MAP_W) * 100}%;top:${(py / MAP_H) * 100}%">
          <b>${wh.id + 1}</b><span>${owned ? t('yourWarehouse') : `${ICONS.coin}${fmt(wh.price)}`}</span></button>`;
    }).join('');
    pins.querySelectorAll('[data-wh]').forEach((b) => b.addEventListener('click', async () => {
      const wh = WAREHOUSES[+b.dataset.wh];
      if (save.warehouses.includes(wh.id)) {
        return toast(`${t('warehouse', { n: wh.id + 1 })} · ${t('rewardMult', { n: wh.rewardMult })}`);
      }
      if (!canAfford(wh.price)) return toast(t('notEnoughCoins'), 'bad');
      if (!(await confirmDialog(t('buyWarehouse', { n: wh.id + 1, p: fmt(wh.price) })))) return;
      if (buyWarehouse(wh.id)) {
        toast(t('bought'), 'good');
        onChange?.();
        draw();
      }
    }));
  };
  draw();
}

export function renderWarehouses(app) {
  screenEl().innerHTML = `<div class="page">${topBar(true)}<h2 class="page-title">${t('warehouses')}</h2>
    ${mapHtml()}</div>`;
  bindBack(app, 'hub');
  bindMap(screenEl(), () => {
    app.game.setOwnedWarehouses(save.warehouses);
    screenEl().querySelector('.coin-pill span').textContent = coinText(save.coins);
  });
}

// ---------- PROFILO ----------
export function renderProfile(app) {
  const need = xpForLevel(save.level);
  const user = getUser();
  const account = isLinked() ? t('linkedAs', { e: esc(user.email || user.new_email || '') }) : t('guest');
  screenEl().innerHTML = `
    <div class="page">
      ${topBar(true)}
      <h2 class="page-title">${t('profile')}</h2>
      <div class="profile-card">
        <div class="avatar">${ICONS.user}</div>
        <label class="field"><span>${t('playerName')}</span>
          <input type="text" maxlength="24" value="${esc(save.name)}" placeholder="Mulettista" data-name></label>
        <div class="xp"><div class="xp-head"><b>${t('level')} ${save.level}</b><span>${fmt(save.xp)} / ${fmt(need)} ${t('xp')}</span></div>
          <div class="bar big"><i style="width:${Math.min(100, (save.xp / need) * 100)}%"></i></div></div>
        <ul class="stats">
          <li><span>${t('coins')}</span><b>${fmt(save.coins)}</b></li>
          <li><span>${t('contractsDone')}</span><b>${fmt(save.stats.contracts)}</b></li>
          <li><span>${t('palletsMoved')}</span><b>${fmt(save.stats.pallets)}</b></li>
          <li><span>${t('totalEarned')}</span><b>${fmt(save.stats.earned)}</b></li>
          <li><span>${t('garage')}</span><b>${Object.values(save.vehicles).reduce((a, b) => a + b, 0)}</b></li>
          <li><span>${t('workers')}</span><b>${save.workers.length} / ${WAREHOUSES.reduce((a, w) => a + workerSlots(w.id), 0)}</b></li>
          <li><span>${t('warehouses')}</span><b>${save.warehouses.length} / ${WAREHOUSES.length}</b></li>
        </ul>
        <div class="account">${account} · <small>${isOnline() ? t('cloudOk') : t('cloudOffline')}</small></div>
        ${isLinked() ? `<button class="pill-btn grey" data-logout>${t('logout')}</button>` : `<button class="pill-btn blue" data-login>${t('login')}</button>`}
      </div>
    </div>`;
  bindBack(app);
  const input = screenEl().querySelector('[data-name]');
  input.addEventListener('change', () => {
    save.name = input.value.trim().slice(0, 24);
    persist();
  });
  screenEl().querySelector('[data-login]')?.addEventListener('click', () => openLogin(app));
  screenEl().querySelector('[data-logout]')?.addEventListener('click', async () => {
    await logout();
    app.go('home');
  });
}

// ---------- IMPOSTAZIONI ----------
export function openSettings(app, { inGame = false, onClose } = {}) {
  const s = save.settings;
  const seg = (key, options) => `<div class="segmented" data-key="${key}">
      ${options.map(([v, label]) => `<button class="${s[key] === v ? 'on' : ''}" data-val="${v}">${label}</button>`).join('')}
    </div>`;
  const { el, close } = openModal(`
    <h2 class="modal-title">${inGame ? t('pause') : t('settings')}</h2>
    <div class="setting"><span>${t('view')}</span>${seg('view', [['first', t('firstPerson')], ['third', t('thirdPerson')]])}</div>
    <div class="setting"><span>${t('steering')}</span>${seg('steering', [['arrows', t('arrows')], ['wheel', t('wheel')], ['gyro', t('gyro')]])}</div>
    <label class="setting check ${s.steering === 'gyro' ? '' : 'hidden'}" data-invert><span>${t('invertGyro')}</span>
      <input type="checkbox" ${s.invertGyro ? 'checked' : ''}></label>
    <div class="setting"><span>${t('sensitivity')} <b data-sens-val>${s.sensitivity.toFixed(1)}</b></span>
      <input type="range" min="0.4" max="2" step="0.1" value="${s.sensitivity}" data-sens></div>
    <div class="setting"><span>${t('graphics')}</span>${seg('quality', [['low', t('low')], ['medium', t('medium')], ['high', t('high')]])}</div>
    <div class="setting"><span>${t('sfxVolume')} <b data-vol-val="sfxVolume">${Math.round((s.sfxVolume ?? 0.8) * 100)}%</b></span>
      <input type="range" min="0" max="1" step="0.05" value="${s.sfxVolume ?? 0.8}" data-vol="sfxVolume"></div>
    <div class="setting"><span>${t('musicVolume')} <b data-vol-val="musicVolume">${Math.round((s.musicVolume ?? 0.5) * 100)}%</b></span>
      <input type="range" min="0" max="1" step="0.05" value="${s.musicVolume ?? 0.5}" data-vol="musicVolume"></div>
    <label class="setting check" data-mirrors><span>${t('mirrors')}</span>
      <input type="checkbox" ${s.mirrors !== false ? 'checked' : ''}></label>
    ${dev.on ? `<button class="pill-btn purple" data-dev>${ICONS.gear}${t('devMenu')}</button>` : ''}
    ${inGame
    ? `<div class="row-btns"><button class="pill-btn red" data-exit>${t('exitMission')}</button><button class="pill-btn green" data-resume>${t('resume')}</button></div>`
    : `<button class="link-btn" data-reset>${t('resetProgress')}</button>`}
  `, { onClose, className: 'settings' });

  const apply = () => {
    persist();
    app.game.setSettings(save.settings);
  };
  el.querySelectorAll('.segmented').forEach((g) => g.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const key = g.dataset.key;
    if (key === 'steering' && b.dataset.val === 'gyro' && !(await Controls.requestGyroPermission())) {
      toast('Gyro ✕', 'bad');
      return;
    }
    s[key] = b.dataset.val;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    el.querySelector('[data-invert]').classList.toggle('hidden', s.steering !== 'gyro');
    apply();
  })));
  el.querySelector('[data-mirrors] input').addEventListener('change', (e) => {
    s.mirrors = e.target.checked;
    apply();
  });
  el.querySelector('[data-invert] input').addEventListener('change', (e) => {
    s.invertGyro = e.target.checked;
    apply();
  });
  el.querySelectorAll('[data-vol]').forEach((r) => r.addEventListener('input', () => {
    s[r.dataset.vol] = +r.value;
    el.querySelector(`[data-vol-val="${r.dataset.vol}"]`).textContent = `${Math.round(+r.value * 100)}%`;
    apply();
  }));
  const sens = el.querySelector('[data-sens]');
  sens.addEventListener('input', () => {
    s.sensitivity = +sens.value;
    el.querySelector('[data-sens-val]').textContent = s.sensitivity.toFixed(1);
    apply();
  });
  el.querySelector('[data-resume]')?.addEventListener('click', close);
  el.querySelector('[data-dev]')?.addEventListener('click', () => openDevMenu(app, inGame, close));
  el.querySelector('[data-exit]')?.addEventListener('click', () => {
    close();
    app.exitMission();
  });
  el.querySelector('[data-reset]')?.addEventListener('click', async () => {
    if (await confirmDialog(t('confirmReset'))) {
      resetSave();
      app.game.setOwnedWarehouses(save.warehouses);
      close();
      app.go('home');
    }
  });
}

// ---------- MENU SVILUPPATORE ----------
// Solo per gli account abilitati nel database (vedi checkDeveloper).
function openDevMenu(app, inGame, closeSettings) {
  const g = app.game;
  const speeds = [1, 2, 4];
  const { el, close } = openModal(`
    <h2 class="modal-title">${t('devMenu')}</h2>
    <p class="dev-version">${t('version')} ${APP_VERSION} · ${IS_NATIVE ? 'Android' : 'Web'} · ${BUILD_DATE} UTC</p>
    <div class="setting dev-row"><span>${t('playerLevel')}</span>
      <input type="number" min="1" max="999" value="${save.level}" data-lvl></div>
    <div class="setting dev-row"><span>${t('contractLevel', { n: '' }).trim()}</span>
      <input type="number" min="1" max="9999" value="${save.contractLevel}" data-clvl></div>
    <button class="pill-btn blue small" data-apply>${t('apply')}</button>
    <div class="setting"><span>${t('workersTime')}</span>
      <div class="segmented">${[1, 8, 24].map((h) => `<button data-hours="${h}">+${h} h</button>`).join('')}</div></div>
    <label class="setting check"><span>${t('perfOverlay')}</span><input type="checkbox" data-perf ${g.perfEl ? 'checked' : ''}></label>
    ${['sky', 'shadows'].map((k) => `<label class="setting check"><span>${t('devToggle_' + k)}</span>
      <input type="checkbox" data-toggle="${k}" ${(g.devToggles?.[k] ?? true) ? 'checked' : ''}></label>`).join('')}
    <div class="setting"><span>${t('devTime')}</span>
      <div class="segmented wrap">${['', ...TIMES].map((x) => `<button class="${(dev.time || '') === x ? 'on' : ''}" data-ftime="${x}">${x ? t('t_' + x) : t('devRandom')}</button>`).join('')}</div></div>
    <div class="setting"><span>${t('devWeather')}</span>
      <div class="segmented wrap">${['', ...WEATHERS].map((x) => `<button class="${(dev.weather || '') === x ? 'on' : ''}" data-fweather="${x}">${x ? t('w_' + x) : t('devRandom')}</button>`).join('')}</div></div>
    <div class="setting"><span>${t('timeSpeed')}</span>
      <div class="segmented">${speeds.map((x) => `<button class="${(g.timeScale || 1) === x ? 'on' : ''}" data-speed="${x}">×${x}</button>`).join('')}</div></div>
    ${inGame ? `
    <div class="setting"><span>${t('teleport')}</span>
      <div class="segmented wrap">${WAREHOUSES.map((w) => `<button data-tp="${w.id}">${w.id + 1}</button>`).join('')}</div></div>
    ${g.mission.contract?.type !== 'free' ? `<button class="pill-btn green" data-complete>${t('completeContract')}</button>` : ''}` : ''}
  `, { className: 'small' });
  el.querySelector('[data-apply]').addEventListener('click', () => {
    save.level = Math.max(1, Math.floor(+el.querySelector('[data-lvl]').value || 1));
    save.contractLevel = Math.max(1, Math.floor(+el.querySelector('[data-clvl]').value || 1));
    save.xp = 0;
    persist();
    toast(`${t('level')} ${save.level} · ${t('contractLevel', { n: save.contractLevel })}`, 'good');
  });
  el.querySelectorAll('[data-hours]').forEach((b) => b.addEventListener('click', () => {
    save.workersPaidAt -= +b.dataset.hours * 3600000;
    const coins = accrueWorkers();
    toast(t('offlineEarned', { n: fmt(coins) }), 'good');
  }));
  el.querySelector('[data-perf]').addEventListener('change', (e) => g.setPerfOverlay(e.target.checked));
  el.querySelectorAll('[data-toggle]').forEach((c) => c.addEventListener('change', () => {
    const toggles = { sky: true, shadows: true, ...g.devToggles };
    toggles[c.dataset.toggle] = c.checked;
    g.setDevToggles(toggles);
  }));
  // orario/meteo forzati per i prossimi contratti (e subito, se in partita)
  const force = (key, attr) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    dev[key] = b.dataset[attr] || null;
    el.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
    if (inGame && g.mission.contract) {
      const c = g.mission.contract;
      if (dev.time) c.time = dev.time;
      if (dev.weather) c.weather = dev.weather;
      g.envFx.apply(c.time || 'day', c.weather || 'clear', g.envFx.rainLevel);
    }
  }));
  force('time', 'ftime');
  force('weather', 'fweather');
  el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    g.timeScale = +b.dataset.speed;
    el.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  el.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => {
    const wh = WAREHOUSES[+b.dataset.tp];
    const [x, z] = plotToWorld(wh, 9, 18);
    g.forklift.place(x, z, wh.side > 0 ? 0 : Math.PI);
    g.camPos = null;
    close();
    closeSettings();
  }));
  el.querySelector('[data-complete]')?.addEventListener('click', () => {
    g.mission.forceDone = true;
    close();
    closeSettings();
  });
}

// ---------- LINGUA ----------
export function openLanguage(app) {
  const { el, close } = openModal(`
    <h2 class="modal-title">${t('language')}</h2>
    <div class="lang-list">${LANGS.map((l) => `<button class="lang-btn ${l.id === getLang() ? 'on' : ''}" data-lang="${l.id}">
      <span class="flag">${l.flag}</span>${l.label}</button>`).join('')}</div>`, { className: 'small' });
  el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    save.settings.lang = b.dataset.lang;
    setLang(b.dataset.lang);
    app.game.world?.setSaleLabel(t('saleSign'));
    persist();
    close();
    app.go('home');
  }));
}

// ---------- LOGIN ----------
export function openLogin(app) {
  if (isLinked()) return app.go('profile');
  const { el } = openModal(`
    <h2 class="modal-title">${t('login')}</h2>
    <p class="modal-text">${t('loginInfo')}</p>
    <form class="login-form">
      <input type="email" required placeholder="${t('emailPlaceholder')}" autocomplete="email">
      <button class="pill-btn blue" type="submit">${t('sendLink')}</button>
    </form>
    <p class="modal-text small" data-msg></p>`, { className: 'small' });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el.querySelector('input').value.trim();
    const msg = el.querySelector('[data-msg]');
    try {
      await linkEmail(email);
      msg.textContent = t('linkSent');
    } catch (err) {
      msg.textContent = err.message || String(err);
    }
  });
}

// ---------- RISULTATO ----------
export function openResult(app, outcome, result, contract) {
  const ok = outcome === 'complete';
  const stars = ok ? [1, 2, 3].map((i) => (i <= result.stars ? ICONS.star : ICONS.starOff)).join('') : '';
  const row = (label, val, cls = '') => `<li class="${cls}"><span>${label}</span><b>${val}</b></li>`;
  const { el, close } = openModal(`
    <h2 class="modal-title ${ok ? 'good' : 'bad'}">${ok ? t('missionComplete') : t('missionFailed')}</h2>
    ${ok ? `<div class="stars">${stars}</div>
      <ul class="stats">
        ${row(t('reward'), fmt(result.base))}
        ${row(t('timeBonus'), `+${fmt(result.timeBonus)}`, 'good')}
        ${result.penalty ? row(`${t('penalty')} (${result.drops} ${t('drops').toLowerCase()})`, `-${fmt(result.penalty)}`, 'bad') : ''}
        ${result.bumpPenalty ? row(`${t('bumps')} (${result.bumps} · -${result.bumpPct}%)`, `-${fmt(result.bumpPenalty)}`, 'bad') : ''}
        ${row(t('total'), `${fmt(result.coins)} 🪙`, 'total')}
        ${row(t('xp'), `+${result.xp}`)}
      </ul>` : `<p class="modal-text">${t('timeUp')}</p>`}
    <div class="row-btns">
      ${ok ? '' : `<button class="pill-btn blue" data-retry>${t('retry')}</button>`}
      <button class="pill-btn green" data-continue>${t('continue')}</button>
    </div>`, { className: 'result', onClose: () => app.exitMission(ok ? 'contracts' : 'contracts') });
  el.querySelector('[data-continue]').addEventListener('click', close);
  el.querySelector('[data-retry]')?.addEventListener('click', () => {
    el.parentElement.remove();
    app.startMission(contract);
  });
}
