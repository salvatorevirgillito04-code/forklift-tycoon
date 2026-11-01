// Scenari di gioco (piazzale, interno, guida, operai, pioggia, neve, prima persona) per una o piu' versioni.
// Desktop, Chromium senza schermo + SwiftShader: gli FPS NON sono quelli del telefono; valgono draw call, triangoli,
// tempi della logica, memoria e GC. Uso: [SC=guida] node tools/perf/scenari.cjs A=5181 C=5173 [--out perf-out/scenari.json]
// SC (variabile d'ambiente, oppure argomento SC=nome) sceglie un solo scenario.
const { chromium } = require('playwright');
const VERS = Object.fromEntries(process.argv.slice(2).filter((a) => /^\w+=\d+$/.test(a)).map((a) => a.split('=')).map(([k, v]) => [k, +v]));
if (!Object.keys(VERS).length) VERS.C = 5173;
const ONLY = process.env.SC || (process.argv.find((a) => a.startsWith('SC=')) || '').slice(3);

const SCEN = [
  { id: 'piazzale', weather: 'clear', view: 'third', at: [9, 22] },
  { id: 'interno', weather: 'clear', view: 'third', at: [0, 44] },
  { id: 'guida', weather: 'clear', view: 'third', at: [9, 22], drive: true },
  { id: 'operai', weather: 'clear', view: 'third', at: [9, 22], workers: 4 },
  { id: 'pioggia', weather: 'rain', view: 'third', at: [9, 22] },
  { id: 'neve', weather: 'snow', view: 'third', at: [9, 22] },
  { id: 'primaPersona', weather: 'clear', view: 'first', at: [9, 22] },
];
(async () => {
  const res = {};
  for (const [ver, port] of Object.entries(VERS)) {
    const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
    const p = await b.newPage({ viewport: { width: 960, height: 540 } });
    // niente Supabase dalle prove: altrimenti ogni pagina creerebbe un utente anonimo e un salvataggio veri in produzione
    await p.route(/supabase\.co/, (r) => r.abort());
    p.on('pageerror', (e) => console.log(`[${ver} err]`, e.message));
    await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
    await p.waitForTimeout(2000);
    res[ver] = {};
    for (const sc of SCEN.filter((x) => !ONLY || x.id === ONLY)) {
      res[ver][sc.id] = await p.evaluate(async (sc) => {
        const app = window.__app, g = app.game;
        g.settings.view = sc.view;
        await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 1, weight: 600, pallets: 0, vehicle: 'd18', time: 'day', weather: sc.weather, timeLimit: null });
        g.settings.view = sc.view;
        g.adaptResolution = () => {};
        g.engine.setHardwareScalingLevel(1);
        if (sc.workers) {
          g.bots.setWorkers(Array.from({ length: sc.workers }, (_, i) => ({ id: 'p' + i, name: 'W' + i, avatar: 0, level: 3, warehouse: 0, vehicle: 'd18' })));
          await g.bots.prewarm(g.forklift);
        }
        const f = g.forklift;
        const W = g.mission.wh;
        f.place(W.cx + sc.at[0], W.side * sc.at[1], W.side > 0 ? 0 : Math.PI);
        if (sc.drive) {
          const base = g.controls.update.bind(g.controls);
          g.controls.update = (dt) => Object.assign(base(dt), { throttle: 0.7, steerAxis: 0.35, steerTarget: null });
        }
        // tempi: logica (step) e disegno (scene.render), per fotogramma
        const st = { step: [], render: [], frame: [], heap: [] };
        const oStep = g.step.bind(g), oRender = g.scene.render.bind(g.scene);
        let rec = false;
        g.step = (dt) => { const t = performance.now(); oStep(dt); if (rec) st.step.push(performance.now() - t); };
        g.scene.render = (...a) => { const t = performance.now(); oRender(...a); if (rec) st.render.push(performance.now() - t); };
        await new Promise((r) => setTimeout(r, 3000));
        // contatori Babylon: draw call e mesh attive (senza import: dai contatori interni del motore)
        const draws = [], meshes = [], tris = [];
        const obs = g.scene.onAfterRenderObservable.add(() => {
          if (!rec) return;
          draws.push((g.perf?.instr ?? g.instr)?.drawCallsCounter.current ?? NaN);
          meshes.push(g.scene.getActiveMeshes().length);
          tris.push(g.scene.getActiveIndices() / 3);
        });
        g.setPerfOverlay?.(true); // crea SceneInstrumentation (contatore draw call)
        const gc0 = performance.memory.usedJSHeapSize;
        rec = true;
        let last = performance.now(), gcs = 0, prevHeap = gc0, maxHeap = gc0;
        await new Promise((resolve) => {
          const t0 = performance.now();
          const loop = () => {
            const now = performance.now();
            st.frame.push(now - last); last = now;
            const h = performance.memory.usedJSHeapSize;
            if (h < prevHeap - 1e6) gcs++;
            prevHeap = h; maxHeap = Math.max(maxHeap, h);
            if (now - t0 > 8000) resolve(); else requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        rec = false;
        g.scene.onAfterRenderObservable.remove(obs);
        g.setPerfOverlay?.(false);
        const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
        const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
        const fr = st.frame.slice(1);
        const lowCount = Math.max(1, Math.floor(fr.length * 0.01));
        const worst1 = [...fr].sort((x, y) => y - x).slice(0, lowCount);
        const out = {
          fpsAvg: 1000 / avg(fr), fps1low: 1000 / avg(worst1), frameMsAvg: avg(fr), frameMsMax: Math.max(...fr), frames: fr.length,
          stepMs: avg(st.step), stepP95: pct(st.step, 0.95), renderMs: avg(st.render), renderP95: pct(st.render, 0.95),
          draws: avg(draws), meshes: avg(meshes), tris: avg(tris),
          heapMB: performance.memory.usedJSHeapSize / 1e6, heapMaxMB: maxHeap / 1e6, gcPer10s: gcs * 10 / 8,
          totalMeshes: g.scene.meshes.length, pos: `${f.x.toFixed(0)},${f.z.toFixed(0)}`, materials: g.scene.materials.length, textures: g.scene.textures.length,
        };
        g.step = oStep; g.scene.render = oRender;
        app.exitMission();
        await new Promise((r) => setTimeout(r, 800));
        return out;
      }, sc).catch((e) => ({ error: e.message }));
      console.log(ver, sc.id, JSON.stringify(res[ver][sc.id], (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
    }
    await b.close();
  }
  const o = process.argv.indexOf('--out');
  if (o > 0) {
    const path = require('path');
    require('fs').mkdirSync(path.dirname(process.argv[o + 1]), { recursive: true });
    require('fs').writeFileSync(process.argv[o + 1], JSON.stringify(res, null, 1));
  }
})();
