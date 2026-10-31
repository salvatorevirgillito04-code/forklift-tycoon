import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';

// Misuratore delle prestazioni (menu sviluppatore e APK di prova). Solo misura: non cambia il gioco.
//
// Tutti i valori vengono dalla STESSA finestra: gli ultimi WINDOW_MS di gioco vero (contratto in corso, non in
// pausa, app in primo piano). Il tempo di un fotogramma e' l'intervallo reale tra l'inizio di un fotogramma e
// l'inizio del successivo (performance.now). Menu, caricamento, pausa e ritorno dallo sfondo non entrano:
// la finestra riparte da zero (prima entravano e un solo fotogramma di caricamento abbassava l'1% low).
//
//   FPS medio = fotogrammi / durata della finestra
//   minimo    = 1000 / fotogramma piu' lungo
//   1% low    = 1000 / media dell'1% dei fotogrammi piu' lunghi (almeno 1)
// Picco: fotogramma oltre SPIKE_MS o oltre 2,5 volte la mediana. Per ogni picco si registra cosa e' successo
// in quel fotogramma: logica, disegno (di cui ombre e specchietto), nuovi oggetti o materiali (caricamento),
// compilazione shader, pulizia della memoria (GC), cambio di risoluzione.
const WINDOW_MS = 10000;
const SPIKE_MS = 50;
const MAX_SPIKES = 40;

export class PerfMonitor {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.instr = new SceneInstrumentation(scene);
    this.instr.captureActiveMeshesEvaluationTime = true;
    this.frames = []; // { t, dt, step, render, shadow, mirror, gap, eval, draws, causes }
    this.spikes = [];
    this.prevStart = null;
    this.added = { mesh: 0, mat: 0, tex: 0 };
    this.obs = [
      scene.onNewMeshAddedObservable.add(() => { this.added.mesh++; }),
      scene.onNewMaterialAddedObservable.add(() => { this.added.mat++; }),
      scene.onNewTextureAddedObservable.add(() => { this.added.tex++; }),
    ];
    this.hooked = new WeakSet(); // mappe d'ombra e specchietto gia' cronometrati
    this.hookObs = [];
    this.events = new Set(); // eventi segnalati dal gioco in questo fotogramma (es. 'risoluzione')
    this.lastHeap = performance.memory?.usedJSHeapSize ?? null;
    this.lastEffects = this.effectCount();
  }

  dispose() {
    this.obs.forEach((o) => o.remove());
    this.hookObs.forEach(([obs, o]) => obs.remove(o));
    this.instr.dispose();
  }

  effectCount() {
    const e = this.engine._compiledEffects;
    return e ? Object.keys(e).length : 0;
  }

  // Cronometro sulle immagini disegnate a parte: mappa d'ombra del sole e specchietto (si aggancia a quelle nuove,
  // es. quando la qualita' grafica cambia il generatore di ombre)
  hookTargets() {
    const list = [...this.scene.customRenderTargets];
    for (const l of this.scene.lights) {
      const sm = l.getShadowGenerator?.()?.getShadowMap?.();
      if (sm) list.push(sm);
    }
    for (const rtt of list) {
      if (this.hooked.has(rtt)) continue;
      this.hooked.add(rtt);
      const kind = /rearview/i.test(rtt.name) ? 'mirror' : 'shadow';
      let t0 = 0;
      const a = rtt.onBeforeRenderObservable.add(() => { t0 = performance.now(); });
      const b = rtt.onAfterRenderObservable.add(() => { if (this.cur) this.cur[kind] += performance.now() - t0; });
      this.hookObs.push([rtt.onBeforeRenderObservable, a], [rtt.onAfterRenderObservable, b]);
    }
  }

  // la finestra riparte (inizio contratto, pausa, app tornata in primo piano)
  reset() {
    this.frames.length = 0;
    this.prevStart = null;
  }

  mark(event) {
    this.events.add(event);
  }

  // Eventi accumulati da un controllo all'altro (nuovi oggetti, shader compilati, memoria liberata, segnalazioni)
  collectCauses(into) {
    const heap = performance.memory?.usedJSHeapSize ?? null;
    const effects = this.effectCount();
    if (this.added.mesh || this.added.mat || this.added.tex) into.push(`nuovi oggetti ${this.added.mesh}/mat ${this.added.mat}/tex ${this.added.tex}`);
    if (effects > this.lastEffects) into.push(`shader +${effects - this.lastEffects}`);
    if (heap !== null && this.lastHeap !== null && heap < this.lastHeap - 1048576) into.push(`GC -${((this.lastHeap - heap) / 1048576).toFixed(1)} MB`);
    for (const e of this.events) into.push(e);
    this.added = { mesh: 0, mat: 0, tex: 0 };
    this.events.clear();
    this.lastHeap = heap;
    this.lastEffects = effects;
  }

  // Inizio fotogramma (playing = contratto in corso e non in pausa).
  // Il tempo dall'inizio del fotogramma precedente a ora (dt) appartiene al fotogramma precedente: lo si registra
  // adesso con i suoi dettagli, piu' il tempo passato FUORI dai fotogrammi (lavoro asincrono come la creazione
  // di operai e modelli, GC, il browser) e gli eventi successi in quell'intervallo.
  frameStart(playing) {
    const now = performance.now();
    if (!playing || document.hidden) {
      this.prevStart = null; // fuori dal gioco: non si misura e la prossima misura riparte pulita
      this.prevDetail = null;
      this.cur = null;
      return;
    }
    const prev = this.prevDetail;
    if (prev && this.prevStart !== null) {
      prev.gap = now - this.lastEnd;
      this.collectCauses(prev.causes);
      this.push(now, now - this.prevStart, prev);
    } else this.collectCauses([]); // eventi del caricamento: non contano
    this.prevDetail = null;
    this.cur = { step: 0, render: 0, shadow: 0, mirror: 0, causes: [] };
    if (!this.hookT || now - this.hookT > 1000) { this.hookT = now; this.hookTargets(); }
    this.prevStart = now;
  }

  addStep(ms) { if (this.cur) this.cur.step += ms; }

  addRender(ms) { if (this.cur) this.cur.render += ms; }

  // fine fotogramma: dettagli del lavoro fatto dentro il fotogramma
  frameEnd() {
    const c = this.cur;
    this.lastEnd = performance.now();
    if (!c) return;
    this.collectCauses(c.causes);
    c.eval = this.instr.activeMeshesEvaluationTimeCounter.current;
    c.draws = this.instr.drawCallsCounter.current;
    this.prevDetail = c;
    this.cur = null;
  }

  push(t, dt, d) {
    const f = { t, dt, ...d };
    this.frames.push(f);
    while (this.frames.length && this.frames[0].t < t - WINDOW_MS) this.frames.shift();
    const med = this.median();
    if (dt > SPIKE_MS || (med && dt > med * 2.5 && dt > 25)) {
      this.spikes.push(f);
      if (this.spikes.length > MAX_SPIKES) this.spikes.shift();
    }
  }

  median() {
    const n = this.frames.length;
    if (n < 10) return 0;
    // mediana approssimata sugli ultimi 60 fotogrammi (veloce, solo per riconoscere i picchi)
    const s = this.frames.slice(-60).map((f) => f.dt).sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  // statistiche della finestra (tutte sugli stessi fotogrammi)
  stats() {
    const fr = this.frames;
    if (fr.length < 2) return null;
    const dts = fr.map((f) => f.dt);
    const total = dts.reduce((a, b) => a + b, 0);
    const sorted = [...dts].sort((a, b) => b - a);
    const n1 = Math.max(1, Math.round(fr.length / 100));
    const worst1 = sorted.slice(0, n1).reduce((a, b) => a + b, 0) / n1;
    const avg = (k) => fr.reduce((a, f) => a + f[k], 0) / fr.length;
    const winStart = fr[0].t;
    return {
      seconds: total / 1000,
      frames: fr.length,
      fpsAvg: (fr.length * 1000) / total,
      fpsMin: 1000 / sorted[0],
      fps1Low: 1000 / worst1,
      msAvg: total / fr.length,
      msP99: sorted[Math.min(sorted.length - 1, Math.floor(fr.length / 100))],
      msMax: sorted[0],
      step: avg('step'),
      gap: avg('gap'),
      render: avg('render'),
      shadow: avg('shadow'),
      mirror: avg('mirror'),
      draws: avg('draws'),
      spikes: this.spikes.filter((s) => s.t >= winStart),
    };
  }
}
