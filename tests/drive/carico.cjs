// Banco di prova della STABILITA' DEL CARICO: 6 muletti, asciutto/pioggia/neve, 20/30/60 FPS.
// Fisica vera del muletto con il passo del gioco (Forklift.step, che divide in sottopassi di 1/60 s).
// Ogni situazione ha un esito atteso: il pallet RESTA (guida normale) o CADE (situazione pericolosa).
// Il pallet si prende e si alza sempre a passi di 1/60 s, cosi' la manovra parte uguale a ogni FPS.
// Uso: npm run test:carico (anche dentro npm run test:drive)
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright non trovato.');
  process.exit(2);
}
const ROOT = path.resolve(__dirname, '../..');

async function measureLoad({ vehId, weather }) {
  const app = window.__app, g = app.game;
  const url = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes(n));
  const D = await import(url('/src/data.js'));
  const veh = D.VEHICLES.find((v) => v.id === vehId);
  await app.startMission({ type: 'free', warehouseId: 2, level: 0, seed: 0, weight: 600, pallets: 0, vehicle: veh.id, time: 'day', weather });
  g.paused = true;
  g.engine.stopRenderLoop();
  g.traffic.update = () => {};
  g.traffic.cars.forEach((c) => { c.x = 5000; Object.assign(c.col, { minX: 5000, maxX: 5001 }); });
  g.people.update = () => {};
  g.people.list.forEach((q) => { q.x = 5000; Object.assign(q.col, { minX: 5000, maxX: 5001 }); });
  const f = g.forklift, env = g.env;
  const inp = (o = {}) => ({ throttle: 0, brake: 0, steerAxis: 0, steerTarget: null, lift: 0, spread: 0, tilt: 0, gear: 1, sensitivity: 1, ...o });
  const hi = Math.min(3.0, veh.lift - 0.1);
  const brakeAt = (t0, b = 1) => (t) => (t < t0 ? inp({ throttle: 1 }) : inp({ brake: b }));
  // correzione di traiettoria accelerando: un colpo di sterzo e uno uguale al contrario (si resta sulla strada)
  const corr = (a) => (t) => inp({ throttle: 1, steerTarget: t > 4 && t < 4.6 ? a : t >= 4.6 && t < 5.2 ? -a : 0 });
  // [nome, altezza, inclinazione, carico/portata, durata, comandi(t), atteso: 'resta' | 'cade' | funzione(meteo), muro]
  const SC = [
    ['1. accelerazione normale (60%), pallet basso', 0.3, 0.03, 0.8, 8, () => inp({ throttle: 0.6 }), 'resta'],
    ['2. accelerazione a pieno gas, pallet basso', 0.3, 0.03, 0.8, 8, () => inp({ throttle: 1 }), 'resta'],
    ['3. velocita\' massima costante', 0.3, 0.03, 0.8, 10, (t) => inp({ throttle: 1 }), 'resta'],
    ['4. frenata progressiva', 0.3, 0.03, 0.8, 10, brakeAt(6, 0.4), 'resta'],
    ['5a. frenata d\'emergenza, pallet basso', 0.3, 0.03, 0.8, 10, brakeAt(6), 'resta'],
    // con pioggia e neve il muletto frena meno: la decelerazione non arriva alla soglia (approvato)
    ['5b. frenata d\'emergenza, pallet alto', hi, 0.03, 0.8, 10, brakeAt(6), (w) => (w === 'clear' ? 'cade' : 'resta')],
    ['6. curva lenta, pallet basso', 0.3, 0.03, 0.8, 8, (t) => inp({ throttle: 0.3, steerAxis: t > 2 ? 1 : 0 }), 'resta'],
    ['7. curva veloce, pallet basso', 0.3, 0.03, 0.8, 8, (t) => inp({ throttle: 1, steerAxis: t > 4 ? 1 : 0 }), 'resta'],
    ['8. curva brusca, pallet alto', hi, 0.03, 0.8, 8, (t) => inp({ throttle: 1, steerAxis: t > 4 ? 1 : 0 }), 'cade'],
    // sulla neve: caso aperto (vedi rapporto), si riporta l'esito senza giudicarlo
    ['9. montante in avanti a 1,5 m, frenata', 1.5, -0.06, 0.8, 9, brakeAt(5), (w) => (w === 'snow' ? 'aperto' : 'cade')],
    ['10. montante all\'indietro, carico 100%, frenata d\'emergenza', 0.3, 0.17, 1.0, 10, brakeAt(6), 'resta'],
    ['11. carico 100%: accelerazione, correzione, frenata progressiva', 0.3, 0.03, 1.0, 12, (t) => (t < 6 ? corr(0.25)(t) : inp({ brake: 0.4 })), 'resta'],
    ['12. urto forte contro un muro', 0.3, 0.03, 0.8, 14, () => inp({ throttle: 1 }), 'cade', true],
    ['14a. correzione di sterzo accelerando (0,25), carico 80%', 0.3, 0.03, 0.8, 7, corr(0.25), 'resta'],
    ['14b. correzione di sterzo accelerando (0,40), carico 80%', 0.3, 0.03, 0.8, 7, corr(0.4), 'resta'],
    ['14c. correzione di sterzo accelerando (0,25), carico 100%, montante dritto', 0.3, 0, 1.0, 7, corr(0.25), 'resta'],
    ['14d. correzione di sterzo accelerando (0,40), carico 100%, montante dritto', 0.3, 0, 1.0, 7, corr(0.4), 'resta'],
  ];
  const res = [];
  for (const [name, h, tilt, ratio, secs, drive, expect, wall] of SC) {
    const byFps = {};
    for (const fps of [20, 30, 60]) {
      const DT = 1 / fps;
      f.place(-60, 0, Math.PI / 2);
      Object.assign(f, { yawRateNow: 0, gear: 1, brakeLevel: 0, v: 0, forkY: 0.06, tilt: 0.03, steer: 0, unstable: 0 });
      f.rates.tilt = 0; f.rates.lift = 0;
      const lz = f.geo.forkBase + 0.62;
      const pl = await g.pallets.spawn({ x: f.x + Math.sin(f.yaw) * lz, z: f.z + Math.cos(f.yaw) * lz, yaw: f.yaw, bottom: 0, weight: Math.round(veh.capacity * ratio), loadH: 1, fragile: false });
      let k = 0;
      while (!f.carried && k++ < 240) f.update(1 / 60, inp({ lift: 1 }), env);
      k = 0;
      while (f.forkY < h && k++ < 2400) f.update(1 / 60, inp({ lift: 1 }), env);
      f.rates.lift = 0; f.tilt = tilt; f.rates.tilt = 0; f.unstable = 0;
      const picked = !!f.carried;
      f.events.length = 0;
      const w = wall ? { minX: f.x + 30, maxX: f.x + 30.4, minZ: -50, maxZ: 50, y0: 0, y1: 3, tag: 'testWall' } : null;
      if (w) env.colliders.push(w);
      let t = 0, prevV = 0, crash = false;
      for (; t < secs; t += DT) { f.step(DT, drive(t), env); if ((Math.abs(prevV) - Math.abs(f.v)) / DT > 20) crash = true; prevV = f.v; }
      if (w) env.colliders.splice(env.colliders.indexOf(w), 1);
      byFps[fps] = picked ? (f.carried ? 'resta' : 'cade') + (crash && !wall ? ' (urto imprevisto)' : '') : 'non preso';
      f.carried = null;
      g.pallets.list.splice(g.pallets.list.indexOf(pl), 1);
      pl.node.dispose();
    }
    res.push({ name, expect: typeof expect === 'function' ? expect(weather) : expect, byFps });
  }
  app.exitMission();
  return { vehicle: veh.name, res };
}

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
  await page.route(/supabase\.co/, (r) => r.abort()); // niente Supabase dalle prove
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let failed = 0, passed = 0;
  const open = [];
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app?.game?.mode, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const ids = await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((x) => x.includes('/src/data.js')))).VEHICLES.map((v) => v.id));
    for (const weather of ['clear', 'rain', 'snow']) {
      console.log(`\n=== Carico, meteo: ${{ clear: 'sereno', rain: 'pioggia', snow: 'neve' }[weather]} ===`);
      for (const id of ids) {
        const r = await page.evaluate(measureLoad, { vehId: id, weather });
        for (const x of r.res) {
          const vals = Object.values(x.byFps);
          const same = vals.every((v) => v === vals[0]);
          const fpsTxt = Object.entries(x.byFps).map(([k, v]) => `${k}: ${v}`).join(', ');
          if (x.expect === 'aperto') {
            open.push(`${r.vehicle}, ${weather}: ${x.name} (${fpsTxt})`);
            console.log(`APERTO ${x.name} ${r.vehicle}  (${fpsTxt}${same ? '' : ', DIVERSO TRA GLI FPS'})`);
            continue;
          }
          const ok = same && vals[0] === x.expect;
          ok ? passed++ : failed++;
          console.log(`${ok ? 'OK  ' : 'FAIL'} ${x.name}: ${x.expect.toUpperCase()} ${r.vehicle}  (${fpsTxt})`);
        }
      }
    }
  } finally {
    if (errors.length) { failed += errors.length; console.log('Errori nella pagina:\n' + errors.join('\n')); }
    await browser.close();
    await server.close();
  }
  console.log(`\nCarico: ${passed} prove passate, ${failed} non passate, ${open.length} APERTE (non risolte, da decidere):`);
  for (const o of open) console.log(`  APERTO ${o}`);
  console.log(failed ? `\n${failed} prove del carico NON passate` : '\nTutte le prove del carico passate (le APERTE restano da risolvere)');
  process.exit(failed ? 1 : 0);
})();
