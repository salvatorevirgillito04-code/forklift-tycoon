// Profilo delle allocazioni (campionamento V8) durante 10 s di gioco: quali funzioni allocano di piu' (= lavoro per il GC).
// Uso: node tools/perf/allocazioni.cjs <meteo> [varianti] [porta]
//   es. node tools/perf/allocazioni.cjs clear nomirror 5181   (meteo: clear, rain, snow, fog)
//   varianti (anche unite con la virgola): nomirror, noshadow, nopeople, nolights; '' = nessuna
const { chromium } = require('playwright');
const weather = process.argv[2] || 'clear';
const variant = process.argv[3] || '';
const port = process.argv[4] || 5173;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  // niente Supabase dalle prove: altrimenti ogni pagina creerebbe un utente anonimo e un salvataggio veri in produzione
  await p.route(/supabase\.co/, (r) => r.abort());
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
  await p.waitForTimeout(2000);
  await p.evaluate(async ([weather, variant]) => {
    const app = window.__app, g = app.game;
    await app.startMission({ type: 'load', warehouseId: 0, level: 5, seed: 2, weight: 600, pallets: 3, vehicle: 'd18', time: 'day', weather, timeLimit: 900 });
    const base = g.controls.update.bind(g.controls);
    g.controls.update = (dt) => Object.assign(base(dt), { throttle: 0.5, steerAxis: 0.3, steerTarget: null });
    if (variant.includes('nomirror')) g.rearview.setEnabled(false);
    if (variant.includes('noshadow')) { g.applyQuality('low'); }
    if (variant.includes('nopeople')) { g.people.update = () => {}; g.people.list.forEach((q) => q.root.setEnabled(false)); }
    if (variant.includes('nolights')) { g.playerLights = false; }
    await new Promise((r) => setTimeout(r, 3000));
  }, [weather, variant]);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const frames0 = await p.evaluate(() => window.__app.game.engine.frameId);
  await p.waitForTimeout(10000);
  const frames1 = await p.evaluate(() => window.__app.game.engine.frameId);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const by = new Map();
  let total = 0;
  const walk = (n, stack) => {
    const f = n.callFrame;
    const name = `${f.functionName || '(anon)'} ${(f.url || '').split('/').slice(-2).join('/').replace(/\?.*/, '')}:${f.lineNumber + 1}`;
    const self = n.selfSize;
    total += self;
    // attribuisce al primo frame del codice del gioco (src/) risalendo la pila
    const st = [name, ...stack];
    const game = st.find((s) => s.includes('src/') || s.includes('/game/') || s.includes('/ui/'));
    const key = game || name;
    by.set(key, (by.get(key) || 0) + self);
    for (const c of n.children) walk(c, st);
  };
  walk(profile.head, []);
  // pile complete delle allocazioni piu' grandi in toString/_prepareEffect
  const chains = new Map();
  const walk2 = (n, stack) => {
    const f = n.callFrame;
    const nm = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().replace(/\?.*/, '')}:${f.lineNumber + 1}`;
    const st = [...stack, nm];
    if (/^(toString|_prepareEffect|PrepareDefinesForLight) /.test(nm) && n.selfSize) { const k = st.slice(-14).join('\n   <- '.replace('<-','')); chains.set(k, (chains.get(k) || 0) + n.selfSize); }
    for (const c of n.children) walk2(c, st);
  };
  walk2(profile.head, []);
  [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([k, v]) => console.log(`\n${(v / 1024).toFixed(0)} KB:\n   ${k}`));
  const fr = frames1 - frames0;
  console.log(`${weather} ${variant}: ${fr} fotogrammi, allocati ${(total / 1048576).toFixed(1)} MB = ${(total / fr / 1024).toFixed(0)} KB/fotogramma`);
  [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, v]) => console.log(`${(v / fr / 1024).toFixed(1).padStart(7)} KB/fot  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
  await b.close();
})();
