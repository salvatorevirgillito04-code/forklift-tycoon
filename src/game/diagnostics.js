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
    this.recording = false;
    this.report = null;
  }

  // ---------- interruttori ----------
  resolutionLocked() {
    return this.toggles.lockRes || this.toggles.lowRes;
  }

  set(changes) {
    const g = this.g, t = this.toggles, was = { ...t };
    Object.assign(t, changes);
    if (g.mode !== 'play') return;
    if (t.noMirror !== was.noMirror) g.rearview?.setEnabled(!t.noMirror && g.settings.mirrors !== false);
    if (t.noShadows !== was.noShadows) g.envFx?.setShadowsAllowed(!t.noShadows && g.shadowsOn);
    if (t.noSnow !== was.noSnow) this.applyPrecip();
    if (t.hideBots !== was.hideBots) g.bots.setHidden(t.hideBots);
    if (t.lowRes !== was.lowRes) g.engine.setHardwareScalingLevel(1 / (g.scale * (t.lowRes ? 0.6 : 1)));
    if (t.light !== was.light && g.perf) g.perf.light = t.light;
  }

  applyPrecip() {
    const e = this.g.envFx;
    if (!e) return;
    e.snow.mesh.setEnabled(!this.toggles.noSnow && e.weather === 'snow');
    e.rain.mesh.setEnabled(!this.toggles.noSnow && (e.weather === 'rain'));
  }

  // tutto come prima (uscita dal contratto o fine prova)
  reset() {
    if (this.g.mode === 'play') this.set({ ...OFF });
    else Object.assign(this.toggles, OFF);
    if (this.g.perf) this.g.perf.light = false;
  }

  // ---------- registratore ----------
  startRecording(label = 'manuale') {
    const perf = this.g.ensurePerf();
    perf.light = this.toggles.light;
    perf.startRecording();
    perf.recFull = false;
    perf.setPhase(label);
    this.recording = true;
    this.recStart = Date.now();
  }

  stopRecording() {
    const perf = this.g.perf;
    const frames = perf ? perf.stopRecording() : [];
    this.recording = false;
    if (perf) perf.light = false;
    if (!this.g.perfEl) this.g.disposePerf(); // il contatore non era acceso: si spegne anche il misuratore
    return frames;
  }

  // Registrazione manuale di N secondi di gioco (con gli interruttori scelti); onDone(report)
  recordFor(seconds, onDone) {
    this.startRecording(this.label());
    clearTimeout(this.recTimer);
    this.recTimer = setTimeout(() => {
      const frames = this.stopRecording();
      this.report = buildReport(frames, this.g, { modo: 'manuale', secondi: seconds });
      onDone?.(this.report);
    }, seconds * 1000);
  }

  label() {
    const t = this.toggles, parts = [];
    for (const k of Object.keys(TOGGLE_INFO)) if (t[k]) parts.push(TOGGLE_INFO[k].split(' · ')[0].replace('Registratore leggero (solo tempi)', 'leggero'));
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

  // onStatus(testo) durante la prova, onDone(report) alla fine
  async runAuto(onStatus, onDone) {
    const app = this.app, g = this.g;
    if (g.mode === 'play') app.exitMission();
    this.cancelled = false;
    onStatus?.('Avvio del contratto di prova (notte, neve, 6 operai di prova)…');
    // guida libera: non finisce mai e non da' ricompense; uscita senza salvataggio
    await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 7, weight: 600, pallets: 0, time: 'night', weather: 'snow', timeLimit: null, diagnostic: true });
    g.bots.setWorkers(TEST_WORKERS);
    await g.bots.prewarm(g.forklift);
    this.installAutopilot();
    const wait = (s) => new Promise((res) => { this.waitTimer = setTimeout(res, s * 1000); });
    const all = [];
    const perf = g.ensurePerf();
    try {
      // giro di riscaldamento (non misurato): crea operai, shader e modelli lungo tutto il percorso
      onStatus?.('Giro di riscaldamento (non misurato)…');
      this.place();
      await wait(MEASURE_S + STAB_S);
      const phases = this.phases();
      for (const [i, [label, toggles, sky]] of phases.entries()) {
        if (this.cancelled || g.mode !== 'play') break;
        this.reset();
        if (sky && (g.envFx.time !== sky.time || g.envFx.weather !== sky.weather)) {
          g.envFx.apply(sky.time, sky.weather);
          await wait(2);
        }
        this.set(toggles);
        this.place();
        onStatus?.(`Caso ${label} (${i + 1}/${phases.length}): stabilizzazione…`);
        perf.light = !!toggles.light;
        perf.startRecording();
        perf.setPhase(null);
        this.recording = true;
        await wait(STAB_S);
        onStatus?.(`Caso ${label} (${i + 1}/${phases.length}): misura ${MEASURE_S} s…`);
        perf.setPhase(label);
        await wait(MEASURE_S);
        all.push(...perf.stopRecording());
        this.recording = false;
      }
    } finally {
      this.removeAutopilot();
      this.recording = false;
      perf.light = false;
      const done = !this.cancelled;
      if (g.mode === 'play') app.exitMission(); // uscita: interruttori annullati, operai veri al loro posto
      if (!g.perfEl) g.disposePerf();
      this.report = buildReport(all, g, { modo: 'automatico', completa: done, fasi: this.phases().map((p) => p[0]) });
      onDone?.(this.report);
    }
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.waitTimer);
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

  // File completo (riepilogo + tutti i fotogrammi in CSV): condivisione Android, oppure scaricamento nel browser
  async share() {
    if (!this.report) return false;
    const name = `forklift-diagnostica-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    const data = JSON.stringify(this.report);
    if (IS_NATIVE) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
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

// Frequenza dello schermo stimata dai tempi dei fotogrammi: il piu' breve ricorrente (1° percentile; con il gioco
// sotto la frequenza dello schermo i fotogrammi durano 2-3 giri di schermo, ma i piu' brevi ne durano uno),
// arrotondato alla frequenza tipica piu' vicina. E' una stima: il rapporto riporta anche il tempo minimo.
function refreshEstimate(dts) {
  if (dts.length < 30) return null;
  const s = [...dts].filter((x) => x > 4).sort((a, b) => a - b);
  const p1 = s[Math.floor(s.length * 0.01)];
  const hz = 1000 / p1;
  return [60, 90, 120, 144].reduce((best, x) => (Math.abs(x - hz) < Math.abs(best - hz) ? x : best), 60);
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
    oltre33ms: dts.filter((x) => x > 33.3).length, oltre50ms: dts.filter((x) => x > 50).length,
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
    drawCall: Math.round(avg('draws')),
    eventi: { gc: count(/^GC/), oggettiNuovi: count(/^nuovi/), shader: count(/^shader/), risoluzione: count(/^risoluzione/) },
    leggero: !!fr[0].light,
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
  // picchi peggiori (oltre 33 ms) con la loro causa
  const picchi = frames.filter((f) => f.dt > 33.3).sort((a, b) => b.dt - a.dt).slice(0, 40).map((f) => ({
    fase: f.phase, ms: r1(f.dt), logica: r1(f.step), disegno: r1(f.render), ombre: r1(f.shadow || 0), specchietto: r1(f.mirror || 0), fuori: r1(f.gap || 0), cause: f.causes?.join(', ') || '',
  }));
  const t0 = frames[0]?.t || 0;
  const csv = ['fase,t_ms,dt_ms,logica,disegno,ombre,specchietto,fuori,draw,cause',
    ...frames.map((f) => [f.phase, Math.round(f.t - t0), r1(f.dt), r1(f.step), r1(f.render), r1(f.shadow || 0), r1(f.mirror || 0), r1(f.gap || 0), f.draws ?? '', `"${(f.causes || []).join('; ')}"`].join(','))].join('\n');
  return {
    tipo: 'forklift-diagnostica', versione: APP_VERSION, build: BUILD_DATE, data: new Date().toISOString().slice(0, 16),
    ...meta,
    limiteFotogrammi: REC_MAX_FRAMES, fotogrammiRegistrati: frames.length,
    schermoHzStimato: hz, fotogrammaMinimoMs: r1(Math.min(...dtsAll.filter((x) => x > 4), 999)),
    dispositivo: deviceInfo(g),
    grafica: { qualita: g.quality, nitidezza: r1(1 / g.engine.getHardwareScalingLevel()), ombre: !!g.shadowsOn, specchietto: g.settings.mirrors !== false },
    fasi, picchi,
    fotogrammiCsv: csv,
  };
}
