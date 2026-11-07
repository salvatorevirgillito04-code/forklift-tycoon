// Diagnostica delle prestazioni su Android (SOLO build di prova, VITE_TEST_BUILD=1: nella versione pubblica questo
// modulo non viene mai caricato).
//
// - Interruttori di isolamento (B-H): valgono solo per il contratto in corso, non vengono mai salvati e si
//   annullano all'uscita dal contratto.
// - Registratore: tempi di ogni fotogramma di gioco con logica, disegno, ombre, specchietto, tempo "fuori" e
//   eventi (GC, oggetti nuovi, shader, risoluzione). Al massimo REC_MAX_FRAMES fotogrammi.
// - Prova automatica: guida libera di notte con neve e operai di PROVA (non salvati), pilota automatico sullo
//   stesso percorso per ogni caso; prima di ogni misura qualche secondo di stabilizzazione non registrato.
// - Esportazione: riepilogo JSON negli appunti, oppure file completo (JSON con i fotogrammi in CSV) da condividere.
// Niente dati personali: solo tempi, impostazioni grafiche e caratteristiche tecniche del telefono.
import { REC_MAX_FRAMES } from './perfmonitor.js';
import { APP_VERSION, BUILD_DATE, IS_NATIVE } from '../config.js';

const OFF = { noMirror: false, noShadows: false, noSnow: false, hideBots: false, lowRes: false, lockRes: false, fpsCap: 0, light: false };
export const TOGGLE_INFO = {
  noMirror: 'B · Specchietto spento',
  noShadows: 'C · Ombre spente',
  noSnow: 'D · Particelle di neve/pioggia spente',
  hideBots: 'E · Operai invisibili (lavoro invariato)',
  lowRes: 'F · Risoluzione ridotta (×0,6)',
  lockRes: 'G · Risoluzione dinamica bloccata',
  light: 'Registratore leggero (solo tempi)',
};
// Profili di prova (solo in memoria: valgono per la sessione, anche nei contratti veri, e tornano "Originale"
// alla chiusura dell'app; le impostazioni dell'utente non cambiano). res = nitidezza fissa (1 = pixel dello schermo
// in punti CSS, 1.3 = 30% in piu'); null = risoluzione dinamica come oggi. Grafica, specchietto, neve, luci e
// operai restano quelli delle impostazioni.
export const PROFILES = {
  originale: { nome: 'Originale', cap: 0, res: null },
  f40: { nome: 'Fluidità 40', cap: 40, res: 1 },
  f60: { nome: 'Fluidità 60', cap: 60, res: 1 },
  f60hd: { nome: 'Fluidità 60 HD', cap: 60, res: 1.3 },
};
// confronto automatico: due giri in ordine opposto (il secondo compensa il riscaldamento del telefono)
const PROFILE_ORDER = ['originale', 'f40', 'f60', 'f60hd', 'f60hd', 'f60', 'f40', 'originale'];
const STAB_S = 5; // secondi di stabilizzazione prima di ogni misura (non registrati)
const MEASURE_S = 20; // secondi registrati per ogni caso
// operai di prova: solo in memoria per la durata della prova, mai nel salvataggio
const TEST_WORKERS = [0, 0, 1, 1, 2, 3].map((wh, i) => ({ id: `diag${i}`, name: `Prova ${i + 1}`, avatar: i % 4, level: 3, warehouse: wh, vehicle: 'd18' }));
const START = { x: -95, z: 3, yaw: Math.PI / 2 }; // inizio del percorso: strada davanti ai lotti, verso est

export class Diagnostics {
  constructor(app) {
    this.app = app;
    this.g = app.game;
    this.g.diag = this;
    this.toggles = { ...OFF };
    this.profile = 'originale'; // profilo di prova della sessione (mai salvato)
    this.manualFrames = []; // registrazioni manuali della sessione, sommate in un unico rapporto
    this.recording = false; // registrazione manuale in corso
    this.running = false; // prova automatica in corso
    this.report = null;
  }

  // qualcosa di diagnostico e' attivo: la nitidezza trovata dalla risoluzione dinamica non va ricordata
  get active() {
    return this.running || this.recording || this.profile !== 'originale' || Object.keys(OFF).some((k) => this.toggles[k] !== OFF[k]);
  }

  // limite fotogrammi in vigore: interruttore H, altrimenti quello del profilo
  fpsCap() {
    return this.toggles.fpsCap || PROFILES[this.profile].cap;
  }

  setProfile(id) {
    this.profile = PROFILES[id] ? id : 'originale';
    this.applyAll();
  }

  // ---------- interruttori ----------
  // Risoluzione dinamica ferma: bloccata (G), ridotta (F), e col limite fotogrammi (H: il confronto e' sulla
  // regolarita' a parita' di risoluzione; altrimenti a 30-40 FPS la risoluzione scenderebbe da sola)
  resolutionLocked() {
    return this.toggles.lockRes || this.toggles.lowRes || this.fpsCap() > 0 || PROFILES[this.profile].res !== null;
  }

  set(changes) {
    Object.assign(this.toggles, changes);
    this.applyAll();
  }

  // applica TUTTI gli interruttori allo stato del gioco (anche dopo un cambio di impostazioni, che li scavalcherebbe)
  applyAll() {
    const g = this.g, t = this.toggles;
    if (g.mode !== 'play') return;
    g.rearview?.setEnabled(!t.noMirror && g.settings.mirrors !== false);
    g.envFx?.setShadowsAllowed(!t.noShadows && g.shadowsOn);
    this.applyPrecip();
    if (!!g.bots.hidden !== t.hideBots) g.bots.setHidden(t.hideBots);
    // nitidezza: fissa del profilo, ridotta (F), oppure quella della risoluzione dinamica
    const res = PROFILES[this.profile].res;
    g.engine.setHardwareScalingLevel(1 / ((res ?? g.scale) * (t.lowRes ? 0.6 : 1)));
    if (g.perf) g.perf.light = t.light;
  }

  applyPrecip() {
    const e = this.g.envFx;
    if (!e) return;
    e.snow.mesh.setEnabled(!this.toggles.noSnow && e.weather === 'snow');
    e.rain.mesh.setEnabled(!this.toggles.noSnow && e.weather === 'rain');
  }

  // tutto come prima
  reset() {
    Object.assign(this.toggles, OFF);
    this.applyAll();
  }

  // fine del contratto (qualunque): interruttori annullati, registrazione manuale chiusa.
  // La prova automatica se ne accorge da sola (controlla di essere ancora nel suo contratto) e si ferma.
  onMissionEnd() {
    if (this.g.bots.hidden) this.g.bots.setHidden(false);
    this.g.engine.setHardwareScalingLevel(1 / this.g.scale); // menu alla nitidezza normale (il profilo torna in gioco)
    Object.assign(this.toggles, OFF);
    if (this.g.perf) this.g.perf.light = false;
    if (this.recording) this.finishManual();
  }

  // il gioco sta andando davvero (contratto in corso, non in pausa, app in primo piano)
  live() {
    const g = this.g;
    return g.mode === 'play' && !g.paused && !document.hidden;
  }

  // ---------- registratore manuale ----------
  // Registrazione di N secondi di gioco con gli interruttori scelti: prima 3 s di stabilizzazione non registrati.
  // Pausa o app in sottofondo: la registrazione si sospende (i tempi di gioco vero restano N secondi).
  recordFor(seconds, onDone) {
    if (this.running || this.recording) return false;
    const perf = this.g.ensurePerf();
    perf.light = this.toggles.light;
    perf.startRecording();
    perf.setPhase(null);
    this.recording = true;
    this.manualDone = onDone;
    this.manualLabel = `manuale·${PROFILES[this.profile].nome}${this.label() === 'A' ? '' : '·' + this.label()}`;
    let stab = 3, left = seconds;
    this.recTimer = setInterval(() => {
      if (!this.live()) { perf.setPhase(null); stab = Math.max(stab, 2); return; }
      if (stab > 0) { stab -= 0.25; if (stab <= 0) perf.setPhase(this.manualLabel); return; }
      left -= 0.25;
      if (left <= 0) this.finishManual();
    }, 250);
    return true;
  }

  finishManual() {
    clearInterval(this.recTimer);
    const perf = this.g.perf;
    const frames = perf ? perf.stopRecording() : [];
    const truncated = !!perf?.recFull;
    this.recording = false;
    if (perf) perf.light = false;
    if (!this.g.perfEl && perf) this.g.disposePerf(); // il contatore non era acceso: si spegne anche il misuratore
    // le registrazioni manuali della sessione si sommano (una per profilo, guidando davvero), fino al limite
    const keep = frames.filter((f) => f.phase); // solo i fotogrammi misurati (non stabilizzazione e pause)
    const room = REC_MAX_FRAMES - this.manualFrames.length;
    this.manualFrames.push(...keep.slice(0, Math.max(0, room)));
    this.manualInfo ||= {};
    if (room > 0 && keep.length) this.manualInfo[this.manualLabel] = this.renderInfo();
    this.report = buildReport(this.manualFrames, this.g, { modo: 'manuale', registrazioneTroncata: truncated || room < keep.length, casi: this.manualInfo, ultimoCaso: this.manualLabel });
    this.manualDone?.(this.report);
    this.manualDone = null;
  }

  clearManual() {
    this.manualFrames = [];
    this.manualInfo = {};
  }

  // risoluzione effettiva di disegno e impostazioni grafiche in questo momento (per il rapporto)
  renderInfo() {
    const g = this.g, e = g.engine;
    return {
      profilo: PROFILES[this.profile].nome, limiteFps: this.fpsCap() || null,
      disegno: `${e.getRenderWidth()}x${e.getRenderHeight()}`, nitidezza: Math.round(100 / e.getHardwareScalingLevel()) / 100,
      grafica: g.quality, ombre: !!g.sun?.shadowEnabled, specchietto: g.scene.customRenderTargets.some((x) => /rearview/i.test(x.name)),
    };
  }

  label() {
    const t = this.toggles, parts = [];
    for (const k of Object.keys(TOGGLE_INFO)) if (t[k]) parts.push(k === 'light' ? 'leggero' : TOGGLE_INFO[k].split(' · ')[0]);
    if (t.fpsCap) parts.push(`H${t.fpsCap}`);
    return parts.length ? parts.join('+') : 'A';
  }

  // ---------- prova automatica ----------
  // Fasi: [etichetta, interruttori, meteo/orario opzionali]
  phases() {
    return [
      ['A', {}],
      ['A-leggero', { light: true }],
      ['B', { noMirror: true }],
      ['D', { noSnow: true }],
      ['E', { hideBots: true }],
      ['F', { lowRes: true }],
      ['G', { lockRes: true }],
      ['H60', { fpsCap: 60 }],
      ['H40', { fpsCap: 40 }],
      ['H30', { fpsCap: 30 }],
      ['A-giorno', {}, { time: 'day', weather: 'clear' }],
      ['C-giorno', { noShadows: true }, { time: 'day', weather: 'clear' }],
    ];
  }

  // Attesa di N secondi di gioco vero. Ritorna false se la prova va fermata (interrotta, uscita dal contratto).
  // Durante pausa o app in sottofondo il tempo non conta e la fase non registra; alla ripresa si rifa' una
  // breve stabilizzazione (onPause/onResume).
  async waitLive(seconds, { onPause, onResume } = {}) {
    let left = seconds, paused = false;
    while (left > 0) {
      if (this.cancelled || !this.ownMission()) return false;
      await new Promise((res) => { this.wakeUp = res; this.waitTimer = setTimeout(res, 250); });
      if (this.cancelled || !this.ownMission()) return false;
      if (!this.live()) { if (!paused) { paused = true; onPause?.(); } continue; }
      if (paused) { paused = false; if ((await onResume?.()) === false) return false; continue; }
      // muletto fermo per piu' di 2 s (urto con qualcosa): rimesso sul percorso, contato nel rapporto
      const f = this.g.forklift;
      this.still = f && Math.abs(f.v) < 0.3 ? (this.still || 0) + 0.25 : 0;
      if (this.still >= 2) { this.still = 0; this.replaced = (this.replaced || 0) + 1; this.place(); }
      left -= 0.25;
    }
    return true;
  }

  ownMission() {
    return this.g.mode === 'play' && this.g.mission.contract === this.contract;
  }

  // onStatus(testo) durante la prova, onDone(report) alla fine (anche se interrotta: con le fasi fatte)
  // Confronto dei 4 profili: due giri in ordine opposto, stessi tempi della prova automatica
  profilePhases() {
    const seen = {};
    return PROFILE_ORDER.map((id) => { seen[id] = (seen[id] || 0) + 1; return [`${PROFILES[id].nome}#${seen[id]}`, {}, null, id]; });
  }

  async runAuto(onStatus, onDone, phaseList = null) {
    if (this.running || this.recording) return;
    const phasesToRun = phaseList || this.phases();
    const userProfile = this.profile;
    const app = this.app, g = this.g;
    this.cancelled = false;
    if (g.mode === 'play') app.exitMission();
    this.running = true;
    const all = [];
    const done = [];
    const interrupted = {};
    let perf = null, scale0 = g.scale, truncated = false;
    const setScale = () => {
      g.scale = scale0;
      g.engine.setHardwareScalingLevel(1 / scale0);
      g.lowCount = 0; g.highCount = 0; g.resTimer = 0;
      if (g.frameTimes) g.frameTimes.length = 0;
    };
    this.phaseScale = {};
    this.phaseInfo = {};
    try {
      onStatus?.('Avvio del contratto di prova (notte, neve, 6 operai di prova)…');
      // guida libera: non finisce mai e non da' ricompense; l'uscita non salva nulla
      await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 7, weight: 600, pallets: 0, time: 'night', weather: 'snow', timeLimit: null });
      if (g.mode !== 'play') throw new Error('contratto di prova non avviato');
      this.contract = g.mission.contract;
      scale0 = g.scale;
      g.bots.setWorkers(TEST_WORKERS); // solo in memoria: il salvataggio non cambia
      await g.bots.prewarm(g.forklift);
      // Auto e pedoni restano in movimento e disegnati, ma il muletto di prova li attraversa: senza, il pilota
      // automatico li urtava sulla corsia e restava fermo. Gli ingombri si rimettono a fine prova.
      this.ghostCols = g.env.colliders.filter((c) => c.tag === 'car' || c.tag === 'person');
      for (const c of this.ghostCols) g.env.colliders.splice(g.env.colliders.indexOf(c), 1);
      this.replaced = 0;
      this.installAutopilot();
      perf = g.ensurePerf();
      // giro di riscaldamento (non misurato): crea operai, shader e modelli lungo tutto il percorso
      onStatus?.('Giro di riscaldamento (non misurato)…');
      this.place();
      if (!(await this.waitLive(MEASURE_S + STAB_S))) throw new Error('stop');
      const phases = phasesToRun;
      for (const [i, [label, toggles, sky, profile]] of phases.entries()) {
        this.profile = profile || 'originale';
        this.reset();
        setScale();
        this.applyAll();
        if (sky && (g.envFx.time !== sky.time || g.envFx.weather !== sky.weather)) {
          g.envFx.apply(sky.time, sky.weather);
          this.applyAll();
        }
        this.set(toggles);
        this.place();
        const tag = `Caso ${label} (${i + 1}/${phases.length})`;
        onStatus?.(`${tag}: stabilizzazione…`);
        perf.light = !!toggles.light;
        perf.startRecording();
        perf.setPhase(null);
        if (!(await this.waitLive(STAB_S))) break;
        onStatus?.(`${tag}: misura ${MEASURE_S} s…`);
        perf.setPhase(label);
        const ok = await this.waitLive(MEASURE_S, {
          onPause: () => { perf.setPhase(null); interrupted[label] = (interrupted[label] || 0) + 1; onStatus?.(`${tag}: in pausa`); },
          onResume: async () => {
            onStatus?.(`${tag}: ripresa, stabilizzazione…`);
            if (!(await this.waitLive(3))) return false;
            perf.setPhase(label);
            onStatus?.(`${tag}: misura…`);
            return true;
          },
        });
        const rec = perf.stopRecording();
        if (ok) all.push(...rec); // caso interrotto a meta': escluso dal rapporto (non confrontabile)
        truncated ||= !!perf.recFull;
        this.phaseScale[label] = Math.round(100 / g.engine.getHardwareScalingLevel()) / 100;
        this.phaseInfo[label] = this.renderInfo();
        if (!ok) break;
        done.push(label);
      }
    } catch (err) {
      if (err.message !== 'stop') onStatus?.(`Errore: ${err.message || err}`);
    } finally {
      this.removeAutopilot();
      for (const c of this.ghostCols || []) if (!g.env.colliders.includes(c)) g.env.colliders.push(c);
      this.ghostCols = null;
      if (perf?.rec) perf.stopRecording();
      if (perf) perf.light = false;
      const own = this.ownMission();
      Object.assign(this.toggles, OFF);
      this.profile = userProfile; // il profilo scelto dall'utente torna quello di prima
      if (own) {
        setScale();
        app.exitMission(); // uscita dal SOLO contratto di prova: interruttori annullati, operai di prova rimossi
      } else if (g.mode === 'play') {
        this.applyAll(); // si e' passati a un contratto vero: nessun interruttore resta attivo
      }
      this.running = false;
      if (!g.perfEl) g.disposePerf();
      const expected = phasesToRun.map((p) => p[0]);
      this.report = buildReport(all, g, {
        modo: 'automatico', completa: done.length === expected.length,
        fasiPreviste: expected, fasiCompletate: done, interruzioni: interrupted,
        registrazioneTroncata: truncated, riposizionamenti: this.replaced,
        nitidezzaIniziale: Math.round(scale0 * 100) / 100, nitidezzaFineCaso: this.phaseScale, casi: this.phaseInfo,
        tipoProva: phaseList ? 'confronto profili' : 'isolamento',
        nota: 'Nei casi H e nei profili con limite il tempo "fuori" comprende l\'attesa del limite fotogrammi. Con limite, F, G o profilo Fluidita\' la risoluzione dinamica e\' ferma.',
      });
      onDone?.(this.report);
    }
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.waitTimer);
    this.wakeUp?.(); // sveglia subito l'attesa in corso: la prova si chiude e salva le fasi fatte
  }

  place() {
    this.g.forklift.place(START.x, START.z, START.yaw);
    this.g.lookYaw = 0;
    this.g.lookPitch = 0;
  }

  // Pilota automatico: va dritto lungo la strada a tutta velocita' (stesso percorso e stessa visuale in ogni caso)
  installAutopilot() {
    const c = this.g.controls;
    if (!c || c.diagBase) return;
    c.diagBase = c.update.bind(c);
    c.update = (dt) => {
      const s = c.diagBase(dt);
      const f = this.g.forklift;
      if (!f) return s;
      const e = Math.atan2(Math.sin(START.yaw - f.yaw), Math.cos(START.yaw - f.yaw));
      const lane = (START.z - f.z) * 0.08;
      return Object.assign(s, { throttle: 1, brake: 0, gear: 1, steerAxis: 0, steerTarget: Math.max(-1, Math.min(1, e * 2 + lane)) });
    };
  }

  removeAutopilot() {
    const c = this.g.controls;
    if (c?.diagBase) { c.update = c.diagBase; c.diagBase = null; }
  }

  // ---------- esportazione ----------
  summaryText() {
    if (!this.report) return '';
    const { fotogrammiCsv, ...summary } = this.report; // negli appunti solo il riepilogo (leggero da incollare)
    return JSON.stringify(summary);
  }

  async copy() {
    const text = this.summaryText();
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // ripiego: selezione di un campo di testo nascosto
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // File completo (riepilogo + tutti i fotogrammi in CSV): condivisione Android, oppure scaricamento nel browser.
  // Nella cache dell'app resta solo l'ultimo file (i precedenti si cancellano).
  async share() {
    if (!this.report) return false;
    const name = `forklift-diagnostica-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    const data = JSON.stringify(this.report);
    if (IS_NATIVE) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      try {
        const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache });
        for (const f of files) {
          const n = typeof f === 'string' ? f : f.name;
          if (n.startsWith('forklift-diagnostica-')) await Filesystem.deleteFile({ path: n, directory: Directory.Cache });
        }
      } catch { /* cache vuota o non leggibile: si prosegue */ }
      const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: 'Forklift Tycoon - diagnostica', text: 'Registrazione delle prestazioni', files: [uri] });
      return true;
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
}

// ---------- calcolo del rapporto ----------
const r1 = (x) => Math.round(x * 10) / 10;

// Frequenza dello schermo stimata dai tempi dei fotogrammi: il periodo (16,7 / 11,1 / 8,3 / 6,9 ms) di cui quasi
// tutti i fotogrammi sono un multiplo esatto; tra i periodi che spiegano i tempi ugualmente bene si sceglie il piu'
// lungo (i multipli di 16,7 ms sono anche multipli di 8,3). E' una STIMA: il rapporto riporta anche l'istogramma.
const PERIODS = [[60, 1000 / 60], [90, 1000 / 90], [120, 1000 / 120], [144, 1000 / 144]];
function refreshEstimate(dts) {
  const v = dts.filter((x) => x > 4 && x < 80);
  if (v.length < 30) return null;
  const score = (p) => v.filter((x) => { const k = Math.max(1, Math.round(x / p)); return Math.abs(x - k * p) < 1.3; }).length / v.length;
  const scores = PERIODS.map(([hz, p]) => [hz, score(p)]);
  const best = Math.max(...scores.map((s) => s[1]));
  // il periodo piu' lungo che spiega i tempi quasi come il migliore
  return scores.find(([, sc]) => sc >= best - 0.03)[0];
}

// istogramma grezzo dei tempi dei fotogrammi (ms, a gruppi di 2 ms fino a 60, poi 60+)
function histogram(dts) {
  const h = {};
  for (const x of dts) { const k = x >= 60 ? '60+' : String(Math.floor(x / 2) * 2); h[k] = (h[k] || 0) + 1; }
  return h;
}

function phaseStats(fr, vsyncMs) {
  const n = fr.length;
  if (n < 2) return null;
  const dts = fr.map((f) => f.dt);
  const total = dts.reduce((a, b) => a + b, 0);
  const asc = [...dts].sort((a, b) => a - b);
  const pct = (q) => asc[Math.min(n - 1, Math.floor(n * q))];
  const n1 = Math.max(1, Math.round(n / 100));
  const worst1 = asc.slice(-n1).reduce((a, b) => a + b, 0) / n1;
  const mean = total / n;
  const med = pct(0.5);
  const sd = Math.sqrt(dts.reduce((a, x) => a + (x - mean) ** 2, 0) / n);
  // Regolarita': quante volte il tempo cambia di molto da un fotogramma al successivo (saltellamento) e quanti
  // fotogrammi restano vicini alla mediana. Con lo schermo a 120 Hz: quanti giri di schermo dura ogni fotogramma.
  let jumps = 0;
  for (let i = 1; i < n; i++) if (Math.abs(dts[i] - dts[i - 1]) > Math.max(4, med * 0.25)) jumps++;
  const near = dts.filter((x) => Math.abs(x - med) <= Math.max(2, med * 0.15)).length;
  const vs = {};
  if (vsyncMs) for (const x of dts) { const k = Math.round(x / vsyncMs); const key = k >= 5 ? '5+' : String(Math.max(1, k)); vs[key] = (vs[key] || 0) + 1; }
  const avg = (k) => fr.reduce((a, f) => a + (f[k] || 0), 0) / n;
  const p99of = (k) => { const v = fr.map((f) => f[k] || 0).sort((a, b) => a - b); return v[Math.min(n - 1, Math.floor(n * 0.99))]; };
  const count = (re) => fr.filter((f) => f.causes?.some((c) => re.test(c))).length;
  return {
    fotogrammi: n, secondi: r1(total / 1000),
    fpsMedio: r1(n * 1000 / total), fps1Low: r1(1000 / worst1),
    msMedio: r1(mean), msMediana: r1(med), msP99: r1(pct(0.99)), msMax: r1(asc[n - 1]),
    msP50: r1(med), msP95: r1(pct(0.95)),
    oltre25ms: dts.filter((x) => x > 25).length, oltre33ms: dts.filter((x) => x > 33.3).length, oltre50ms: dts.filter((x) => x > 50).length,
    regolarita: {
      deviazioneMs: r1(sd),
      saltiTraFotogrammi: jumps, saltiPercento: r1(100 * jumps / (n - 1)),
      vicinoAllaMedianaPercento: r1(100 * near / n),
      giriDiSchermoPerFotogramma: vsyncMs ? vs : undefined,
    },
    cpuMs: {
      logica: r1(avg('step')), logicaP99: r1(p99of('step')),
      disegno: r1(avg('render')), disegnoP99: r1(p99of('render')),
      ombre: r1(avg('shadow')), specchietto: r1(avg('mirror')),
      fuori: r1(avg('gap')), fuoriP99: r1(p99of('gap')),
    },
    drawCall: fr[0].light ? null : Math.round(avg('draws')), // nella modalita' leggera non si contano
    eventi: { gc: count(/^GC/), oggettiNuovi: count(/^nuovi/), shader: count(/^shader/), risoluzione: count(/^risoluzione/) },
    leggero: !!fr[0].light,
    ...pacingStats(fr, vsyncMs),
  };
}

// Regolarita' rispetto allo schermo, passo di gioco, continuita' del movimento, sistemi, pallet, scatti segnalati.
// "vt" e' l'istante del fotogramma secondo il browser (inizio del fotogramma allineato al giro di schermo), non
// l'istante in cui l'immagine compare sul display (la WebView non lo fornisce).
function pacingStats(fr, vsyncMs) {
  const n = fr.length;
  const q = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return r1(a[Math.min(a.length - 1, Math.floor(a.length * p))]); };
  const cap = fr.find((f) => f.cap)?.cap || null;
  const target = cap ? 1000 / cap : vsyncMs; // durata attesa di un fotogramma
  const late = target ? fr.filter((f) => f.dt > target * 1.5).length : null;
  const vtd = [], mismatch = [];
  let jerkF = 0, jerkC = 0, moving = 0;
  for (let i = 1; i < n; i++) {
    const a = fr[i - 1], b = fr[i];
    if (a.vt == null || b.vt == null || b.t - a.t > 200) continue; // pausa o cambio di fase
    const dv = b.vt - a.vt;
    if (dv <= 0) continue;
    vtd.push(dv);
    if (b.sim != null) mismatch.push(Math.abs(b.sim - dv));
    // movimento: velocita' vista sullo schermo (spostamento / intervallo del browser) rispetto alla velocita' del muletto
    if (a.x != null && b.x != null && Math.abs(b.v) > 1) {
      moving++;
      const vs = Math.hypot(b.x - a.x, b.z - a.z) / (dv / 1000);
      if (Math.abs(vs / Math.abs(b.v) - 1) > 0.25) jerkF++;
      if (a.cx != null) { const vc = Math.hypot(b.cx - a.cx, b.cz - a.cz) / (dv / 1000); if (Math.abs(vc / Math.abs(b.v) - 1) > 0.25) jerkC++; }
    }
  }
  const vtGiri = {};
  if (vsyncMs) for (const x of vtd) { const k = Math.round(x / vsyncMs); const key = k >= 5 ? '5+' : String(Math.max(1, k)); vtGiri[key] = (vtGiri[key] || 0) + 1; }
  // sistemi della logica (tempo per fotogramma)
  const keys = [...new Set(fr.flatMap((f) => Object.keys(f.sub || {})))];
  const sistemi = {};
  for (const k of keys) {
    const v = fr.map((f) => f.sub?.[k] || 0);
    sistemi[k] = { medio: Math.round(1000 * v.reduce((x, y) => x + y, 0) / n) / 1000, p99: q(v, 0.99), max: r1(Math.max(...v)) };
  }
  // con e senza pallet
  const split = (sel) => { const d = fr.filter(sel).map((f) => f.dt); return d.length > 30 ? { fotogrammi: d.length, fpsMedio: r1(d.length * 1000 / d.reduce((x, y) => x + y, 0)), msP95: q(d, 0.95), msP99: q(d, 0.99) } : null; };
  // scatti segnalati dal giocatore: i fotogrammi vicini (1 s prima)
  const marks = fr.filter((f) => f.causes?.includes('SCATTO SEGNALATO')).map((f) => {
    const near = fr.filter((g) => g.t > f.t - 1000 && g.t <= f.t);
    const worst = near.reduce((m, g) => (g.dt > m.dt ? g : m), near[0] || f);
    return { t: Math.round(f.t - fr[0].t), peggioreMs: r1(worst.dt), logica: r1(worst.step), disegno: r1(worst.render), specchietto: r1(worst.mirror || 0), fuori: r1(worst.gap || 0), cause: worst.causes?.filter((c) => c !== 'SCATTO SEGNALATO').join(', ') || '' };
  });
  const scales = [];
  for (const f of fr) if (f.scale != null && (!scales.length || Math.abs(scales[scales.length - 1].nitidezza - f.scale) > 0.01)) scales.push({ t: Math.round(f.t - fr[0].t), nitidezza: r1(f.scale) });
  return {
    ritmo: {
      limiteFps: cap, attesoMs: target ? r1(target) : null,
      fotogrammiInRitardoPercento: late !== null ? r1(100 * late / n) : null, // oltre 1,5 volte la durata attesa
      giriSaltatiPerLimite: fr.reduce((s, f) => s + (f.skip || 0), 0),
      intervalliBrowserMs: { p50: q(vtd, 0.5), p95: q(vtd, 0.95), p99: q(vtd, 0.99), giriDiSchermo: vsyncMs ? vtGiri : undefined },
      passoDiGiocoControBrowserMs: { p50: q(mismatch, 0.5), p95: q(mismatch, 0.95), max: mismatch.length ? r1(Math.max(...mismatch)) : null, oltre4ms: mismatch.filter((x) => x > 4).length },
      movimentoIrregolarePercento: moving ? { muletto: r1(100 * jerkF / moving), camera: r1(100 * jerkC / moving), fotogrammiInMovimento: moving } : null,
    },
    sistemiMs: keys.length ? sistemi : undefined,
    pallet: { con: split((f) => f.pallet === 1), senza: split((f) => f.pallet === 0) },
    scattiSegnalati: marks.length ? marks : undefined,
    nitidezza: scales.length > 1 ? scales : scales[0]?.nitidezza,
  };
}

function deviceInfo(g) {
  const gl = g.engine._gl;
  let gpu = null;
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
  } catch { gpu = null; }
  // modello del telefono dal browser (es. "CPH2625"): informazione tecnica, non personale
  const model = (navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/) || [])[1] || null;
  return {
    android: (navigator.userAgent.match(/Android ([\d.]+)/) || [])[1] || null,
    modello: model, gpu,
    schermo: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
    canvas: `${g.engine.getRenderWidth()}x${g.engine.getRenderHeight()}`,
    memoriaGB: navigator.deviceMemory || null, core: navigator.hardwareConcurrency || null,
  };
}

export function buildReport(frames, g, meta = {}) {
  const dtsAll = frames.map((f) => f.dt);
  const hz = refreshEstimate(dtsAll);
  const vsyncMs = hz ? 1000 / hz : null;
  const byPhase = new Map();
  for (const f of frames) {
    if (!byPhase.has(f.phase)) byPhase.set(f.phase, []);
    byPhase.get(f.phase).push(f);
  }
  const fasi = {};
  for (const [label, fr] of byPhase) fasi[label] = phaseStats(fr, vsyncMs);
  // casi ripetuti (es. "Fluidità 60#1" e "#2"): anche il totale delle ripetizioni
  const groups = new Map();
  for (const f of frames) {
    if (!String(f.phase).includes('#')) continue;
    const k = String(f.phase).split('#')[0];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const perProfilo = {};
  for (const [k, fr] of groups) perProfilo[k] = phaseStats(fr, vsyncMs);
  // avvisi: limite non raggiunto (es. WebView a 60 Hz: "Fluidita' 40" diventa 30 FPS)
  const avvisi = [];
  for (const [label, info] of Object.entries(meta.casi || {})) {
    const st = fasi[label];
    if (info?.limiteFps && st && Math.abs(st.fpsMedio - info.limiteFps) > info.limiteFps * 0.1) {
      avvisi.push(`${label}: limite ${info.limiteFps} FPS ma ${st.fpsMedio} FPS medi (schermo stimato ${hz} Hz)`);
    }
  }
  // picchi peggiori (oltre 33 ms) con la loro causa
  const picchi = frames.filter((f) => f.dt > 33.3).sort((a, b) => b.dt - a.dt).slice(0, 40).map((f) => ({
    fase: f.phase, ms: r1(f.dt), logica: r1(f.step), disegno: r1(f.render), ombre: r1(f.shadow || 0), specchietto: r1(f.mirror || 0), fuori: r1(f.gap || 0), cause: f.causes?.join(', ') || '',
  }));
  const t0 = frames[0]?.t || 0;
  const r2 = (x) => (x == null ? '' : Math.round(x * 100) / 100);
  const csv = ['fase,t_ms,dt_ms,logica,disegno,ombre,specchietto,fuori,draw,vt_ms,passo_ms,sottopassi,giri_saltati,nitidezza,x,z,yaw,v,pallet,cam_x,cam_z,sistemi,cause',
    ...frames.map((f) => [f.phase, Math.round(f.t - t0), r1(f.dt), r1(f.step), r1(f.render), r1(f.shadow || 0), r1(f.mirror || 0), r1(f.gap || 0), f.draws ?? '',
      f.vt != null ? r1(f.vt - (frames[0].vt || 0)) : '', f.sim != null ? r1(f.sim) : '', f.n ?? '', f.skip ?? '', f.scale != null ? r2(f.scale) : '',
      r2(f.x), r2(f.z), f.yaw != null ? Math.round(f.yaw * 1000) / 1000 : '', r2(f.v), f.pallet ?? '', r2(f.cx), r2(f.cz),
      `"${Object.entries(f.sub || {}).map(([k, v]) => `${k}:${Math.round(v * 100) / 100}`).join(' ')}"`, `"${(f.causes || []).join('; ')}"`].join(','))].join('\n');
  return {
    tipo: 'forklift-diagnostica', versione: APP_VERSION, build: BUILD_DATE, data: new Date().toISOString().slice(0, 16),
    ...meta,
    limiteFotogrammi: REC_MAX_FRAMES, fotogrammiRegistrati: frames.length,
    schermoHzStimato: hz, fotogrammaMinimoMs: r1(Math.min(...dtsAll.filter((x) => x > 4), 999)), istogrammaMs: histogram(dtsAll),
    dispositivo: deviceInfo(g),
    grafica: { qualita: g.quality, nitidezza: r1(1 / g.engine.getHardwareScalingLevel()), ombre: !!g.shadowsOn, specchietto: g.settings.mirrors !== false },
    avvisi: avvisi.length ? avvisi : undefined,
    fasi, perProfilo: Object.keys(perProfilo).length ? perProfilo : undefined, picchi,
    fotogrammiCsv: csv,
  };
}
