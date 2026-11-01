// Banco di misura della FLUIDITA' (scatti), scenario del collaudo Android: notte, neve, operai IA attivi,
// guida lungo la strada attraverso i lotti (gli operai vengono creati e parcheggiati man mano).
//
// Misura il lavoro JavaScript sul thread principale (quello che fa scattare il gioco sul telefono), in modo
// deterministico: percorso fisso, passi da 1/60 s, GPU svuotata tra un fotogramma e l'altro.
//  - lavoro JS per fotogramma: media, mediana, 99° percentile, massimo, fotogrammi > 16,7 / 33 / 50 ms
//  - '1% low solo JS': il limite che il codice impone agli FPS (la GPU del telefono si aggiunge sopra)
//  - logica, disegno, specchietto; allocazioni per fotogramma (campionamento V8) e GC
// NON misura la GPU (SwiftShader e' software): gli FPS veri si misurano sul telefono con il contatore.
//
// Uso: node tools/perf/fluidita.cjs [porta=5173] [--cpu 3] [--fotogrammi 900] [--meteo snow] [--ora night]
//          [--operai 6] [--varianti nomirror] [--out file.json]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const port = +(process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : 5173);
const opts = {
  cpu: +arg('cpu', 3), weather: arg('meteo', 'snow'), time: arg('ora', 'night'),
  workers: +arg('operai', 6), variants: arg('varianti', ''),
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const p = await b.newPage({ viewport: { width: 800, height: 360 } });
  p.on('pageerror', (e) => console.log('[errore pagina]', e.message));
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
  await p.waitForTimeout(2000);

  // contratto con operai nel salvataggio (come nel gioco vero: vengono preparati durante il caricamento)
  await p.evaluate(async (o) => {
    const url = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes(n));
    const S = await import(url('/src/state.js'));
    S.save.workers = Array.from({ length: o.workers }, (_, i) => ({ id: `bench${i}`, name: `Op ${i}`, avatar: i % 4, level: 3, warehouse: i % 4, vehicle: 'd18' }));
    const app = window.__app, g = app.game;
    await app.startMission({ type: 'load', warehouseId: 0, level: 8, seed: 3, weight: 700, pallets: 4, vehicle: 'd18', time: o.time, weather: o.weather, timeLimit: 1200 });
    g.adaptResolution = () => {};
    g.engine.setHardwareScalingLevel(4); // meno pixel: SwiftShader resta lento, ma il thread principale si misura meglio
    if (o.variants.includes('nomirror')) g.rearview.setEnabled(false);
    g.setPerfOverlay(true);
    // guida: dritto lungo la strada da un capo all'altro, poi indietro (passa davanti a tutti i lotti)
    const base = g.controls.update.bind(g.controls);
    g.controls.update = (dt) => {
      const f = g.forklift;
      const s = base(dt);
      const back = f.x > 95 ? -1 : f.x < -95 ? 1 : (g.__dir || 1);
      g.__dir = back;
      const want = back > 0 ? Math.PI / 2 : -Math.PI / 2;
      const e = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw));
      const ez = (3 - f.z) * 0.08 * back; // resta sulla corsia
      return Object.assign(s, { throttle: 1, steerTarget: Math.max(-1, Math.min(1, e * 2 + ez)), steerAxis: 0, gear: 1 });
    };
    g.forklift.place(-90, 3, Math.PI / 2);
    await new Promise((r) => setTimeout(r, 1500));
  }, opts);

  const cdp = await p.context().newCDPSession(p);
  if (opts.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu });
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });

  // Misura deterministica: il ciclo di gioco viene fermato e ogni fotogramma (passo da 1/60 s) e' eseguito dallo
  // script; tra un fotogramma e l'altro si aspetta che la GPU finisca, e si cronometra solo il lavoro JavaScript.
  // Stesso percorso e stessi tempi a ogni esecuzione: i confronti tra versioni sono affidabili.
  const r = await p.evaluate(async (o) => {
    const g = window.__app.game, eng = g.engine;
    eng.stopRenderLoop();
    const gl = eng._gl;
    const times = [], steps = [], renders = [], mirrors = [], events = [];
    let lastHeap = performance.memory.usedJSHeapSize, gcs = 0;
    const wrapStep = g.step.bind(g), wrapRender = g.scene.render.bind(g.scene);
    let st = 0, rt = 0;
    g.step = (dt) => { const t = performance.now(); wrapStep(dt); st += performance.now() - t; };
    g.scene.render = (...a) => { const t = performance.now(); wrapRender(...a); rt += performance.now() - t; };
    let mir = 0, mt = 0;
    const rtt = g.scene.customRenderTargets.find((x) => /rearview/i.test(x.name));
    rtt?.onBeforeRenderObservable.add(() => { mt = performance.now(); });
    rtt?.onAfterRenderObservable.add(() => { mir += performance.now() - mt; });
    const N = o.frames;
    for (let i = 0; i < N; i++) {
      st = 0; rt = 0; mir = 0;
      const t0 = performance.now();
      eng.beginFrame();
      eng._deltaTime = 1000 / 60; // passo fisso
      g.frame();
      eng.endFrame();
      const ms = performance.now() - t0;
      times.push(ms); steps.push(st); renders.push(rt); mirrors.push(mir);
      gl.finish(); // la GPU finisce qui, fuori dal tempo misurato
      const h = performance.memory.usedJSHeapSize;
      if (h < lastHeap - 1048576) { gcs++; events.push(`f${i} GC -${((lastHeap - h) / 1048576).toFixed(0)}MB`); }
      lastHeap = h;
      if (ms > 50) events.push(`f${i} ${ms.toFixed(0)}ms (logica ${st.toFixed(0)}, disegno ${rt.toFixed(0)}, specchio ${mir.toFixed(0)})`);
      if (i % 30 === 29) await new Promise((res) => setTimeout(res, 0)); // lascia lavorare il resto (caricamenti asincroni)
    }
    const sorted = [...times].sort((a, b) => a - b);
    const pct = (q) => sorted[Math.min(N - 1, Math.floor(N * q))];
    const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return {
      fotogrammi: N,
      jsMedio: avg(times), jsMediana: pct(0.5), js99: pct(0.99), jsMax: sorted[N - 1],
      jsOltre16: times.filter((x) => x > 16.7).length, jsOltre33: times.filter((x) => x > 33.3).length, jsOltre50: times.filter((x) => x > 50).length,
      fps1lowSoloJs: 1000 / avg(sorted.slice(-Math.max(1, Math.round(N / 100)))),
      logicaMedia: avg(steps), disegnoMedio: avg(renders), specchietto: avg(mirrors),
      gc: gcs, eventi: events.slice(0, 25),
      operai: g.bots.bots.size, parcheggiati: g.bots.parked.size, x: g.forklift.x,
    };
  }, { frames: +arg('fotogrammi', 900) });

  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  let total = 0;
  const walk = (n) => { total += n.selfSize; n.children.forEach(walk); };
  walk(profile.head);
  r.allocKBperFotogramma = total / Math.max(1, r.fotogrammi) / 1024;
  r.allocMB = total / 1048576;
  r.opzioni = opts;
  const round = (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v);
  console.log(JSON.stringify(r, round, 1));
  const o = arg('out');
  if (o) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, JSON.stringify(r, round, 1)); }
  await b.close();
})();
