// Misura deterministica: draw call e triangoli guardando in 8 direzioni da 3 punti (piazzale, strada, interno).
// Uso: node tools/perf/sweep.cjs A=5181 B=5182 C=5173   (nome=porta di un server di sviluppo; predefinito C=5173)
const { chromium } = require('playwright');
const VERS = Object.fromEntries(process.argv.slice(2).filter((a) => /^\w+=\d+$/.test(a)).map((a) => a.split('=')).map(([k, v]) => [k, +v]));
if (!Object.keys(VERS).length) VERS.C = 5173;

(async () => {
  const out = {};
  for (const [ver, port] of Object.entries(VERS)) {
    const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__app?.game?.world, null, { timeout: 120000 });
    await p.waitForTimeout(3000);
    out[ver] = await p.evaluate(async () => {
      const app = window.__app, g = app.game;
      await app.startMission({ type: 'free', warehouseId: 0, level: 0, seed: 1, weight: 600, pallets: 0, vehicle: 'd18', time: 'day', weather: 'clear', timeLimit: null });
      g.engine.setHardwareScalingLevel(1); g.adaptResolution = () => {};
      g.engine.stopRenderLoop();
      g.setPerfOverlay(true);
      const W = g.mission.wh, res = {};
      for (const [name, u, w] of [['piazzale', 9, 22], ['strada', 0, 2], ['interno', 0, 44]]) {
        let d = 0, t = 0, n = 0;
        for (let k = 0; k < 8; k++) {
          g.forklift.place(W.cx + u, W.side * w, k * Math.PI / 4);
          g.shadowGen.cull(g.forklift.x, g.forklift.z, 20);
          for (let f = 0; f < 4; f++) g.frame(); // la camera si assesta, lo specchietto si aggiorna
          for (let f = 0; f < 2; f++) { g.frame(); d += (g.perf?.instr ?? g.instr).drawCallsCounter.current; /* in g.perf dalla 1.1b, in g.instr prima */ t += g.scene.getActiveIndices() / 3; n++; }
        }
        res[name] = { draws: +(d / n).toFixed(0), trisK: +(t / n / 1000).toFixed(0) };
      }
      return res;
    });
    await b.close();
    console.log(ver, JSON.stringify(out[ver]));
  }
})();
