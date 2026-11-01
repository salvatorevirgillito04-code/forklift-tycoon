// Quanto blocca il gioco la creazione di un operaio IA (muletto, pallet, camion, autista)?
// Crea N operai uno dopo l'altro col gioco in movimento e misura, dal profilatore CPU, il blocco continuo piu'
// lungo del thread principale (tratto senza pause) e il lavoro totale. CPU rallentata (--cpu) come un telefono.
// Uso: node tools/perf/operai.cjs [porta=5173] [--cpu 2] [--n 6] [--out file.json]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const port = +(process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : 5173);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 200 } });
  // niente Supabase dalle prove: altrimenti ogni pagina creerebbe un utente anonimo e un salvataggio veri in produzione
  await p.route(/supabase\.co/, (r) => r.abort());
  p.on('pageerror', (e) => console.log('[errore pagina]', e.message));
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
  await p.waitForTimeout(2000);
  await p.evaluate(async () => {
    const app = window.__app, g = app.game;
    await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 1, weight: 600, pallets: 0, vehicle: 'd18', time: 'night', weather: 'snow', timeLimit: null });
    g.engine.setHardwareScalingLevel(4);
    g.bots.pick = () => []; // nessuna scelta automatica: gli operai li crea la misura
    await new Promise((r) => setTimeout(r, 2000));
  });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: +arg('cpu', 2) });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const n = +arg('n', 6);
  const win = await p.evaluate(async (n) => {
    const g = window.__app.game, out = [];
    for (let i = 0; i < n; i++) {
      // ogni operaio in un lotto diverso e con un'area diversa (camion o scaffali), come nel gioco
      const w = { id: `misura${i}`, name: `Op${i}`, avatar: i % 4, level: 3, warehouse: i % 4, vehicle: 'd18' };
      g.bots.workers.push(w);
      const t0 = performance.now();
      await g.bots.spawn(w);
      out.push([t0, performance.now()]);
      await new Promise((r) => setTimeout(r, 600)); // pausa tra un operaio e l'altro
    }
    return { out, now: performance.now() };
  }, n);
  const cpu = (await cdp.send('Profiler.stop')).profile;
  const byId = new Map(cpu.nodes.map((x) => [x.id, x]));
  let t = cpu.startTime;
  const offset = cpu.endTime / 1000 - win.now;
  const res = win.out.map(([a, z]) => ({ a, z, max: 0, cur: 0, tot: 0 }));
  let last = cpu.startTime;
  for (let i = 0; i < cpu.samples.length; i++) {
    t += cpu.timeDeltas[i];
    const dt = (t - last) / 1000; last = t;
    const tp = t / 1000 - offset;
    const r = res.find((x) => tp >= x.a && tp <= x.z + 50);
    if (!r) continue;
    const name = byId.get(cpu.samples[i]).callFrame.functionName;
    if (name === '(idle)') { r.cur = 0; continue; }
    r.cur += dt; r.tot += dt; r.max = Math.max(r.max, r.cur);
  }
  const summary = {
    operai: n,
    bloccoPiuLungoMs: res.map((r) => +r.max.toFixed(0)),
    lavoroTotaleMs: res.map((r) => +r.tot.toFixed(0)),
    durataCostruzioneMs: res.map((r) => +(r.z - r.a).toFixed(0)),
  };
  summary.bloccoMassimo = Math.max(...summary.bloccoPiuLungoMs);
  console.log(JSON.stringify(summary, null, 1));
  const o = arg('out');
  if (o) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, JSON.stringify(summary, null, 1)); }
  await b.close();
})();
