import * as Sentry from '@sentry/browser';
import './style.css';
import { SENTRY_DSN, APP_VERSION, IS_NATIVE } from './config.js';
import { setLang, t, fmt } from './i18n.js';
import { save, loadLocal, syncFromCloud, addRewards, persist, accrueWorkers, dev, applyEventReward, activePayBonus } from './state.js';
import { initAuth, onAuthChange, checkDeveloper, handleLoginUrl, isLinked } from './cloud.js';
import { eventDef, currentEventId, eventScore, marathonPoints, submitScore, claimPending, rewardFor, nameAllowed, PAINTS } from './events.js';
import { Game } from './game/game.js';
import { Controls } from './game/controls.js';
import { $, openModal, toast, coinText } from './ui/ui.js';
import { mapHtml, bindMap } from './ui/screens.js';
import * as S from './ui/screens.js';

Sentry.init({
  dsn: SENTRY_DSN,
  release: `forklift-tycoon@${APP_VERSION}`,
  environment: IS_NATIVE ? 'android' : import.meta.env.MODE,
  tracesSampleRate: 0.1,
  enabled: import.meta.env.PROD,
});

const SCREENS = {
  home: S.renderHome,
  hub: S.renderHub,
  contracts: S.renderContracts,
  garage: S.renderGarage,
  warehouses: S.renderWarehouses,
  profile: S.renderProfile,
  workers: S.renderWorkers,
  events: S.renderEvents,
};

const app = {
  game: null,
  current: 'home',

  go(name) {
    this.current = name;
    document.body.classList.remove('playing');
    $('#screen').style.display = '';
    SCREENS[name](this);
  },

  async startMission(contract) {
    // iPhone: il permesso del giroscopio va chiesto dentro il tocco, prima di qualsiasi attesa
    const gyro = save.settings.steering === 'gyro' ? Controls.requestGyroPermission() : null;
    $('#screen').style.display = 'none';
    $('#loading').classList.add('show');
    document.body.classList.add('playing');
    // In app installata (schermo intero) blocca l'orizzontale; nel browser puo' fallire senza problemi
    screen.orientation?.lock?.('landscape').catch(() => {});
    try {
      await gyro;
      await this.game.startMission(contract, {
        // gare degli eventi: stesso muletto per tutti; la vernice vinta va sul proprio muletto
        vehicleId: contract.vehicle || save.activeVehicle,
        paint: !contract.vehicle && save.paint ? PAINTS[save.paint] : null,
        owned: save.warehouses,
        workers: save.workers,
        hudRoot: $('#hud'),
        controlsRoot: $('#controls'),
        onResult: (outcome, result, c) => this.finishMission(outcome, result, c),
        onSettings: () => this.pauseWith((done) => S.openSettings(this, { inGame: true, onClose: done })),
        onMap: () => this.pauseWith((done) => this.openGameMap(done)),
        onCamera: () => {
          save.settings.view = save.settings.view === 'first' ? 'third' : 'first';
          persist();
          this.game.setSettings(save.settings);
        },
        coins: save.coins,
      });
    } catch (err) {
      Sentry.captureException(err);
      toast(String(err.message || err), 'bad');
      this.exitMission();
    } finally {
      $('#loading').classList.remove('show');
    }
  },

  pauseWith(open) {
    if (this.game.mode !== 'play') return;
    this.game.setPaused(true);
    open(() => {
      if (this.game.mode === 'play' && !this.game.mission.finished) this.game.setPaused(false);
    });
  },

  openGameMap(done) {
    const f = this.game.forklift;
    const { el } = openModal(`<h2 class="modal-title">${t('map')}</h2>${mapHtml()}`, { onClose: done, className: 'map' });
    bindMap(el, () => {
      this.game.setOwnedWarehouses(save.warehouses);
      this.game.hud?.setCoins(save.coins);
    }, { x: f.x, z: f.z, yaw: f.yaw });
  },

  finishMission(outcome, result, contract) {
    // Contratti nuovi nella finestra di scelta (anche se fallito)
    if (!contract.event) save.contractSeed = (save.contractSeed || 1) + 1;
    persist();
    if (outcome === 'complete' && contract.event) {
      // gara dell'evento: punteggio in classifica (il premio arriva a fine settimana)
      const m = this.game.mission;
      result.event = { kind: contract.event.kind, score: eventScore(contract.event.kind, { seconds: contract.timeLimit - m.timeLeft, drops: m.drops, bumps: m.bumps }) };
      result.event.pending = this.sendEventScore(contract.event.id, result.event.score);
    } else if (outcome === 'complete' && contract.type !== 'free') {
      const bonus = activePayBonus();
      if (bonus) {
        result.payBonus = Math.round(result.coins * bonus / 100);
        result.coins += result.payBonus;
      }
      this.addMarathon(contract, result.stars);
    }
    if (outcome === 'complete') {
      const levelUp = addRewards({
        coins: result.coins, xp: result.xp, pallets: contract.pallets, contractLevel: contract.level,
      });
      if (levelUp) setTimeout(() => toast(t('levelUp', { n: levelUp }), 'good'), 400);
    }
    Sentry.addBreadcrumb({ category: 'mission', message: `${outcome} lv${contract.level}` });
    S.openResult(this, outcome, result, contract);
  },

  // Invia un punteggio dell'evento in corso. Ritorna { ok, data } oppure { error }.
  async sendEventScore(id, score) {
    if (!isLinked()) return { error: 'not_member' };
    if (!nameAllowed(save.name)) return { error: 'bad_name' };
    const title = save.titles[save.title] ? S.titleText(save.titles[save.title]) : null;
    const res = await submitScore(id, score, save.name.trim(), title);
    return res?.error ? res : { ok: true, data: res };
  },

  // Maratona: ogni contratto normale completato aggiunge punti (inviati subito, o al prossimo se troppo ravvicinati)
  async addMarathon(contract, stars) {
    const def = eventDef();
    if (def.kind !== 'marathon' || !isLinked() || !nameAllowed(save.name)) return;
    const prev = save.marathonPending?.id === def.id ? save.marathonPending.points : 0;
    const points = Math.min(600, prev + marathonPoints(contract, stars));
    save.marathonPending = { id: def.id, points };
    persist();
    const res = await this.sendEventScore(def.id, points);
    if (res.ok) {
      save.marathonPending = null;
      persist();
      setTimeout(() => toast(t('evMarathonPts', { n: points }), 'good'), 1600);
    }
  },

  // Premi degli eventi finiti: ritirati una volta sola, poi mostrati
  async collectEventRewards() {
    const list = await claimPending();
    for (const c of list) {
      const r = rewardFor(c.id, c.tier);
      applyEventReward(r);
      S.openEventReward(this, c, r);
    }
    if (list.length && this.game.mode !== 'play' && !document.querySelector('.modal-backdrop')) this.go(this.current);
  },

  exitMission(target = 'hub') {
    $('#modal-root').innerHTML = '';
    this.game.stopMission();
    $('#hud').innerHTML = '';
    this.go(target);
  },
};

// Guadagni automatici degli operai (anche a gioco chiuso).
function payWorkers(offline) {
  const coins = accrueWorkers();
  if (!coins) return;
  if (offline && coins >= 10) toast(t('offlineEarned', { n: fmt(coins) }), 'good');
  app.game?.hud?.setCoins(save.coins);
  const pill = document.querySelector('#screen .coin-pill span');
  if (pill) pill.textContent = coinText(save.coins);
}

async function boot() {
  loadLocal();
  setLang(save.settings.lang);
  const game = new Game($('#scene'));
  app.game = game;
  if (import.meta.env.DEV) window.__app = app;
  $('#rotate p').textContent = t('rotateDevice');
  try {
    await game.init(save.settings);
    game.setOwnedWarehouses(save.warehouses);
  } catch (err) {
    Sentry.captureException(err);
    $('#loading').innerHTML = `<p>WebGL non disponibile: ${String(err.message || err)}</p>`;
    return;
  }
  $('#loading').classList.remove('show');
  app.go('home');
  payWorkers(true);
  setInterval(() => payWorkers(false), 10000);

  // Cloud in background: non blocca l'avvio
  onAuthChange(async (user) => {
    const wasDev = dev.on;
    dev.on = await checkDeveloper();
    if (dev.on && !wasDev) toast(t('devOn'), 'good');
    if (!user) return;
    await syncFromCloud();
    payWorkers(true);
    app.collectEventRewards();
    setLang(save.settings.lang);
    game.world?.setSaleLabel(t('saleSign'));
    game.setOwnedWarehouses(save.warehouses);
    if (game.mode !== 'play' && !document.querySelector('.modal-backdrop')) app.go(app.current);
  });
  await initAuth();
  if (IS_NATIVE) listenLoginLinks();
}

// App Android: il link di conferma dell'email riapre l'app e completa il login qui.
async function listenLoginLinks() {
  const { App } = await import('@capacitor/app');
  const open = async (url) => {
    const err = await handleLoginUrl(url);
    toast(err || t('loginDone'), err ? 'bad' : 'good');
  };
  App.addListener('appUrlOpen', ({ url }) => open(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) open(launch.url);
}

window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver')) return;
  console.error(e.error || e.message);
});

// PWA: service worker (solo build pubblicata) e prompt di installazione Android
if ('serviceWorker' in navigator && import.meta.env.PROD && !IS_NATIVE) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => Sentry.captureException(err));
  });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.installPrompt = e;
  if (app.current === 'home' && app.game?.mode !== 'play' && $('#screen').innerHTML) app.go('home');
});
window.addEventListener('appinstalled', () => {
  app.installPrompt = null;
  if (app.current === 'home') app.go('home');
});

boot();

