import { t, fmt, LANGS, getLang, setLang } from '../i18n.js';
import { ICONS } from './icons.js';
import { $, esc, coinPill, openModal, confirmDialog, toast } from './ui.js';
import { save, persist, buyVehicle, buyWarehouse, resetSave } from '../state.js';
import { VEHICLES, WAREHOUSES, DIFFICULTIES, makeContract, vehicleById, xpForLevel } from '../data.js';
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
      ${app.installPrompt ? `<button class="pill-btn blue install-btn" data-act="install">${t('installApp')}</button>` : ''}
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
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    app.installPrompt = null;
    renderHome(app);
  });
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
        ${tile('workers', ICONS.workers, t('workers'), 'slate', true)}
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
let selectedWarehouse = 0;
export function renderContracts(app) {
  if (!save.warehouses.includes(selectedWarehouse)) selectedWarehouse = save.warehouses[0];
  const veh = vehicleById(save.activeVehicle);
  const lvl = save.contractLevel;
  const cards = DIFFICULTIES.map((d) => {
    const c = makeContract(lvl, d, selectedWarehouse);
    const tooHeavy = c.weight > veh.capacity;
    return `<div class="contract-card ${d}">
        <div class="contract-head">${t(d)}</div>
        <div class="contract-body">
          <div class="contract-type">${ICONS.truck}<b>${t(c.type)}</b>${c.fragile ? `<em>${t('fragile')}</em>` : ''}</div>
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
    app.startMission(makeContract(lvl, b.dataset.diff, selectedWarehouse));
  }));
}

// ---------- GARAGE ----------
export function renderGarage(app) {
  const maxOf = (k) => Math.max(...VEHICLES.map((v) => v[k]));
  const bar = (label, val, max, unit) => `<div class="stat"><span>${label}</span>
      <div class="bar"><i style="width:${Math.round((val / max) * 100)}%"></i></div><b>${unit}</b></div>`;
  const cards = VEHICLES.map((v) => {
    const owned = save.vehicles.includes(v.id);
    const active = save.activeVehicle === v.id;
    const btn = active
      ? `<button class="pill-btn grey" disabled>${t('equipped')}</button>`
      : owned
        ? `<button class="pill-btn blue" data-equip="${v.id}">${t('equip')}</button>`
        : `<button class="pill-btn ${save.coins >= v.price ? 'green' : 'grey'}" data-buy="${v.id}">${ICONS.coin}${fmt(v.price)}</button>`;
    return `<div class="vehicle-card ${active ? 'active' : ''}">
        <div class="vehicle-photo" style="--c:${v.color}">
          <img src="${import.meta.env.BASE_URL}garage/${v.photo}" alt="${esc(v.name)}" loading="lazy">
        </div>
        <div class="vehicle-info">
          <h3>${esc(v.name)} ${v.price === 0 ? `<small>${t('starter')}</small>` : ''}</h3>
          ${bar(t('capacity'), v.capacity, maxOf('capacity'), `${fmt(v.capacity)} kg`)}
          ${bar(t('liftHeight'), v.lift, maxOf('lift'), `${v.lift} m`)}
          ${bar(t('speed'), v.speed, maxOf('speed'), `${Math.round(v.speed * 3.6)} km/h`)}
        </div>
        <div class="vehicle-action">${owned ? `<span class="owned-tag">${t('owned')}</span>` : ''}${btn}</div>
      </div>`;
  }).join('');
  screenEl().innerHTML = `<div class="page">${topBar(true)}<h2 class="page-title">${t('garage')}</h2>
    <div class="vehicle-list">${cards}</div></div>`;
  bindBack(app, 'hub');
  screenEl().querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => {
    save.activeVehicle = b.dataset.equip;
    persist();
    renderGarage(app);
  }));
  screenEl().querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
    const v = vehicleById(b.dataset.buy);
    if (save.coins < v.price) return toast(t('notEnoughCoins'), 'bad');
    if (!(await confirmDialog(`${v.name}: ${t('buyFor', { n: fmt(v.price) })}?`))) return;
    if (buyVehicle(v.id)) toast(t('bought'), 'good');
    renderGarage(app);
  }));
}

// ---------- MAPPA / MAGAZZINI ----------
export function mapHtml() {
  return `<div class="map-wrap"><canvas class="map-canvas"></canvas><div class="map-pins"></div></div>`;
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
      const [x, y] = worldToMap(playerPos.x, playerPos.z, scale);
      ctx.fillStyle = '#35d07f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    pins.innerHTML = WAREHOUSES.map((wh) => {
      const owned = save.warehouses.includes(wh.id);
      const [x, z] = plotToWorld(wh, 0, PLOT.yard[0] + 8);
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
      if (save.coins < wh.price) return toast(t('notEnoughCoins'), 'bad');
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
    screenEl().querySelector('.coin-pill span').textContent = fmt(save.coins);
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
          <li><span>${t('garage')}</span><b>${save.vehicles.length} / ${VEHICLES.length}</b></li>
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
    <div class="setting"><span>${t('graphics')}</span>${seg('quality', [['low', t('low')], ['high', t('high')]])}</div>
    <label class="setting check" data-mirrors><span>${t('mirrors')}</span>
      <input type="checkbox" ${s.mirrors !== false ? 'checked' : ''}></label>
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
  const sens = el.querySelector('[data-sens]');
  sens.addEventListener('input', () => {
    s.sensitivity = +sens.value;
    el.querySelector('[data-sens-val]').textContent = s.sensitivity.toFixed(1);
    apply();
  });
  el.querySelector('[data-resume]')?.addEventListener('click', close);
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

// ---------- LINGUA ----------
export function openLanguage(app) {
  const { el, close } = openModal(`
    <h2 class="modal-title">${t('language')}</h2>
    <div class="lang-list">${LANGS.map((l) => `<button class="lang-btn ${l.id === getLang() ? 'on' : ''}" data-lang="${l.id}">
      <span class="flag">${l.flag}</span>${l.label}</button>`).join('')}</div>`, { className: 'small' });
  el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    save.settings.lang = b.dataset.lang;
    setLang(b.dataset.lang);
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
