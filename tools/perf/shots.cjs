// Stesse inquadrature (piazzale e 3 viste fisse) per confrontare due versioni prima/dopo.
// Uso: node tools/perf/shots.cjs <porta> <etichetta> [meteo] [cartella]   -> <cartella>/<etichetta>-<meteo>-<vista>.png
const { chromium } = require('playwright');
const [port, tag, weather = 'clear', outDir = 'perf-out'] = process.argv.slice(2);
require('fs').mkdirSync(outDir, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
  await p.waitForTimeout(2000);
  await p.evaluate(async (weather) => {
    const app = window.__app, g = app.game;
    await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 1, weight: 600, pallets: 0, vehicle: 'd18', time: 'day', weather, timeLimit: null });
    g.engine.setHardwareScalingLevel(1); g.adaptResolution = () => {};
    document.querySelector('#hud').style.display = 'none'; document.querySelector('#controls').style.display = 'none';
  }, weather);
  const views = [
    ['yard', [9, 22, 0], null],
    ['cam1', null, { pos: [-30, 9, 5], tgt: [-60, 1, 45] }],
    ['cam2', null, { pos: [10, 25, -40], tgt: [-30, 0, 30] }],
    ['cam3', null, { pos: [-62, 4, 40], tgt: [-75, 1, 52] }],
  ];
  for (const [name, at, cam] of views) {
    await p.evaluate(async ({ at, cam }) => {
      const g = window.__app.game, W = g.mission.wh;
      g.__uc ||= g.updateCamera.bind(g);
      if (at) { g.updateCamera = g.__uc; g.forklift.place(W.cx + at[0], W.side * at[1], W.side > 0 ? 0 : Math.PI); }
      else {
        g.updateCamera = () => {};
        const V = g.camera.position.constructor;
        g.camera.position.set(...cam.pos); g.camera.setTarget(new V(...cam.tgt));
        g.shadowGen.cull(cam.tgt[0], cam.tgt[2], 20);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }, { at, cam });
    await p.screenshot({ path: `${outDir}/${tag}-${weather}-${name}.png` });
  }
  await b.close();
})();
