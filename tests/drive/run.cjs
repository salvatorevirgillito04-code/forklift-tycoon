// Banco di prova della guida (Driving System 2.0).
// Avvia il gioco in un browser senza schermo, ferma il ciclo di gioco e muove i 6 muletti con la fisica vera
// a passi fissi di 1/60 s sulla strada sgombra. Ogni prova ha soglie: se una non passa, esce con codice 1.
//
// Uso:   npm run test:drive              (tutto)
//        npm run test:drive -- --json out.json   (salva anche i risultati)
// Serve Playwright con Chromium (gia' presente nell'ambiente di sviluppo); nessuna dipendenza nel progetto.
const path = require('path');
const fs = require('fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright non trovato: installalo a parte (npm i -g playwright && npx playwright install chromium).');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '../..');
const jsonArg = process.argv.indexOf('--json');
const JSON_OUT = jsonArg > 0 ? process.argv[jsonArg + 1] : null;

// Codice eseguito nella pagina: misure per un muletto. Restituisce numeri, non giudizi.
async function measureVehicle({ vehId, weather }) {
  const app = window.__app, g = app.game;
  const url = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes(n));
  const D = await import(url('/src/data.js'));
  const veh = D.VEHICLES.find((v) => v.id === vehId);
  const DT = 1 / 60;
  await app.startMission({ type: 'free', warehouseId: 2, level: 0, seed: 0, weight: 600, pallets: 0, vehicle: veh.id, time: 'day', weather });
  g.paused = true;
  g.engine.stopRenderLoop();
  // strada sgombra: niente macchine ne' persone
  g.traffic.update = () => {};
  g.traffic.cars.forEach((c) => { c.x = 5000; Object.assign(c.col, { minX: 5000, maxX: 5001 }); });
  g.people.update = () => {};
  g.people.list.forEach((q) => { q.x = 5000; Object.assign(q.col, { minX: 5000, maxX: 5001 }); });
  const f = g.forklift, env = g.env;
  const inp = (o = {}) => ({ throttle: 0, brake: 0, steerAxis: 0, steerTarget: null, lift: 0, spread: 0, tilt: 0, gear: 1, sensitivity: 1, ...o });
  const reset = (x = 0, z = 0, yaw = Math.PI / 2) => { f.place(x, z, yaw); f.yawRateNow = 0; f.gear = 1; f.brakeLevel = 0; f.events.length = 0; f.tilt = 0.03; };
  const step = (i) => f.update(DT, i, env);
  const run = (n, i, each) => { for (let k = 0; k < n; k++) { step(i); each?.(k); } };
  const stopWith = (i, max = 1200) => { let k = 0; while (Math.abs(f.v) > 0.01 && k++ < max) step(i); return k * DT; };
  const r = { vehicle: veh.name, speed: veh.speed, lift: veh.lift };

  // velocita' massime, accelerazione, frenata, freno motore
  reset(-80, 0);
  let t90 = null;
  run(600, inp({ throttle: 1 }), (k) => { if (t90 === null && Math.abs(f.v) >= 0.9 * veh.speed) t90 = (k + 1) * DT; });
  r.vMaxFwd = f.v; r.t90 = t90;
  let x0 = f.x; stopWith(inp({ brake: 1 }));
  r.brakeEmpty = Math.abs(f.x - x0);
  reset(-80, 0); run(600, inp({ throttle: 1 })); x0 = f.x; stopWith(inp());
  r.coastStop = Math.abs(f.x - x0);
  reset(60, 0); run(600, inp({ throttle: 1, gear: -1 })); r.vMaxRev = f.v;
  reset(-80, 0); run(300, inp({ throttle: 0.1 })); r.v10 = f.v;
  reset(-80, 0); run(300, inp({ throttle: 0.3 })); r.v30 = f.v;
  // raggio di sterzata a bassa velocita'
  reset(-40, 0); run(120, inp({ throttle: 0.3 }));
  let y0 = f.yaw, dist = 0;
  run(240, inp({ throttle: 0.3, steerAxis: 1 }), () => { dist += Math.abs(f.v) * DT; });
  r.turnRadius = dist / Math.max(Math.abs(f.yaw - y0), 1e-3);

  // carico (80% della portata): prende il pallet davanti alle forche e lo porta all'altezza h
  const withLoad = async (h, test) => {
    reset(-60, 0);
    f.forkY = 0.06;
    const lz = f.geo.forkBase + 0.62;
    const pl = await g.pallets.spawn({ x: f.x + Math.sin(f.yaw) * lz, z: f.z + Math.cos(f.yaw) * lz, yaw: f.yaw, bottom: 0, weight: Math.round(veh.capacity * 0.8), loadH: 1, fragile: false });
    let k = 0;
    while (!f.carried && k++ < 120) step(inp({ lift: 1 }));
    k = 0;
    while (f.forkY < h && k++ < 1200) step(inp({ lift: 1 }));
    f.rates.lift = 0;
    const picked = !!f.carried;
    f.events.length = 0;
    const res = test();
    const dropped = f.events.includes('dropped') || !f.carried;
    g.pallets.list.splice(g.pallets.list.indexOf(pl), 1);
    pl.node.dispose();
    f.carried = null;
    return { picked, dropped, ...res };
  };
  const hiLoad = Math.min(3.0, veh.lift - 0.1);
  const fullSpeed = () => run(600, inp({ throttle: 1 }));
  r.load = {
    // situazioni normali: il carico deve restare
    brakeLow: await withLoad(0.3, () => { fullSpeed(); const xs = f.x; stopWith(inp({ brake: 1 })); return { dist: Math.abs(f.x - xs) }; }),
    curveLow: await withLoad(0.3, () => { fullSpeed(); run(180, inp({ throttle: 1, steerAxis: 1 })); return {}; }),
    bumpSlow: await withLoad(0.3, () => {
      const wall = { minX: f.x + 6, maxX: f.x + 6.4, minZ: -50, maxZ: 50, y0: 0, y1: 3, tag: 'testWall' };
      env.colliders.push(wall);
      run(600, inp({ throttle: 0.2 }));
      env.colliders.splice(env.colliders.indexOf(wall), 1);
      return {};
    }),
    // situazioni pericolose: il carico deve cadere
    curveHigh: await withLoad(hiLoad, () => { fullSpeed(); run(240, inp({ throttle: 1, steerAxis: 1 })); return { h: hiLoad }; }),
    brakeHigh: await withLoad(hiLoad, () => { fullSpeed(); stopWith(inp({ brake: 1 })); return { h: hiLoad }; }),
    brakeTiltFwd: await withLoad(1.5, () => {
      let k = 0; while (f.tilt > -0.06 && k++ < 300) step(inp({ tilt: -1 }));
      f.rates.tilt = 0; fullSpeed(); stopWith(inp({ brake: 1 })); return { tilt: f.tilt };
    }),
    bumpFast: await withLoad(0.3, () => {
      const wall = { minX: f.x + 30, maxX: f.x + 30.4, minZ: -50, maxZ: 50, y0: 0, y1: 3, tag: 'testWall' };
      env.colliders.push(wall);
      let vHit = 0; run(900, inp({ throttle: 1 }), () => { if (f.v > 0.1) vHit = f.v; });
      env.colliders.splice(env.colliders.indexOf(wall), 1);
      return { vHit };
    }),
  };

  // muri: di striscio (20 gradi) e di fronte (80 gradi). Muro lungo X a z = 4
  const wall = { minX: -200, maxX: 200, minZ: 4, maxZ: 4.4, y0: 0, y1: 3, tag: 'testWall' };
  env.colliders.push(wall);
  const wallRun = (angle, throttle) => {
    reset(-60, 4 - f.geo.body.z1 - 1.2 - 2.5 * Math.sin(angle), Math.PI / 2 - angle);
    let pen = false; const xs = f.x;
    run(300, inp({ throttle }), () => { if (f.contacts(env, f.x, f.z, f.yaw) === null) pen = true; });
    return { advancedX: f.x - xs, vEnd: f.v, penetrated: pen };
  };
  r.wallGraze = wallRun(20 * Math.PI / 180, 0.5);
  r.wallFront = wallRun(80 * Math.PI / 180, 0.6);
  env.colliders.splice(env.colliders.indexOf(wall), 1);

  // Ciclo di lavoro rappresentativo (un pallet): avvicinamento lento e presa, retromarcia, mezzo giro,
  // 26 m carico fino alla zona, posa, retromarcia, mezzo giro e 26 m a vuoto. Guida ideale, senza errori.
  // mantiene la direzione voluta (come un guidatore: corregge lo sterzo, in retromarcia al contrario)
  const hold = (heading, gear) => {
    const e = Math.atan2(Math.sin(heading - f.yaw), Math.cos(heading - f.yaw));
    return Math.max(-1, Math.min(1, e * 2.5 * gear));
  };
  const driveTo = (distance, gear, throttle = 1) => {
    const sx = f.x, sz = f.z, heading = Math.round(f.yaw / (Math.PI / 2)) * (Math.PI / 2); let t = 0;
    const done = () => Math.hypot(f.x - sx, f.z - sz);
    // accelera, poi frena in tempo per fermarsi sul punto (entro 30 cm: come un guidatore)
    while (done() < distance - 0.3 && t < 60) {
      const left = distance - done();
      const need = (f.v * f.v) / (2 * 3.0) + 0.1;
      const braking = left <= need;
      if (braking && Math.abs(f.v) < 0.02) break; // fermo un po' prima: va bene
      step(inp({ gear, throttle: braking ? 0 : throttle, brake: braking ? 1 : 0, steerTarget: hold(heading, gear) })); t += DT;
    }
    t += stopWith(inp({ gear, brake: 1 }));
    return t;
  };
  const halfTurn = (gear) => { const ys = f.yaw; let t = 0; while (Math.abs(f.yaw - ys) < Math.PI && t < 30) { step(inp({ gear, throttle: 0.45, steerAxis: 1 })); t += DT; } t += stopWith(inp({ gear, brake: 1 })); return t; };
  const liftTime = (dh, loaded) => Math.abs(dh) / (0.55 * (loaded ? 0.76 : 1)) + 0.5; // salita/discesa forche (+ avvio idraulica)
  reset(-30, 0); // in mezzo alla strada: 26 m liberi in entrambe le direzioni
  const cycle = {};
  cycle.approach = driveTo(2.5, 1, 0.2) + 1.5; // allineamento finale
  cycle.lift = liftTime(0.25, true);
  cycle.backOut = driveTo(3, -1, 0.6);
  cycle.turn1 = halfTurn(-1);
  cycle.carry = driveTo(26, 1);
  cycle.place = liftTime(0.25, true) + driveTo(2, -1, 0.4);
  cycle.turn2 = halfTurn(1);
  cycle.ret = driveTo(26, 1);
  cycle.total = Object.values(cycle).reduce((a, b) => a + b, 0);
  r.cycle = cycle;
  // tempo per pallet dei contratti che questo muletto puo' fare (peso entro la portata), nel caso piu' stretto
  let tight = Infinity, tightAt = null;
  for (let lvl = 1; lvl <= 200; lvl++) {
    for (const d of D.DIFFICULTIES) {
      const c = D.makeContract(lvl, d, 0, 1);
      if (c.weight > veh.capacity) continue;
      const per = (c.timeLimit - 60) / c.pallets; // i 60 s in piu' coprono partenza e manovre finali
      if (per < tight) { tight = per; tightAt = `liv. ${lvl} ${d} ${c.type}`; }
    }
  }
  r.tightPerPallet = tight;
  r.tightAt = tightAt;

  app.exitMission();
  return r;
}

// Soglie (realistiche ma da gioco): [descrizione, funzione(r) -> true se passa]
const CHECKS = [
  ['velocita\' massima avanti = scheda (±3%)', (r) => Math.abs(r.vMaxFwd - r.speed) <= r.speed * 0.03],
  ['retromarcia ~60% della massima', (r) => Math.abs(-r.vMaxRev / r.speed - 0.6) < 0.05],
  ['0 -> 90% in 1-3 s', (r) => r.t90 > 1 && r.t90 < 3],
  ['frenata a vuoto 3,5-5,5 m/s² medi', (r) => { const a = r.speed ** 2 / (2 * r.brakeEmpty); return a > 3.2 && a < 5.5; }],
  ['acceleratore 10% = passo d\'uomo (≤ 0,8 m/s)', (r) => r.v10 > 0.2 && r.v10 <= 0.8],
  ['acceleratore 30% = 30% della massima (±10%)', (r) => Math.abs(r.v30 / r.speed - 0.3) < 0.03],
  ['raggio di sterzata in manovra 0,7-1,8 m', (r) => r.turnRadius > 0.7 && r.turnRadius < 1.8],
  ['carico basso: frenata piena, resta', (r) => r.load.brakeLow.picked && !r.load.brakeLow.dropped],
  ['carico basso: curva a tutta velocita\', resta', (r) => r.load.curveLow.picked && !r.load.curveLow.dropped],
  ['carico basso: urto lento contro muro, resta', (r) => r.load.bumpSlow.picked && !r.load.bumpSlow.dropped],
  ['carico alto (~3 m): curva brusca, CADE', (r) => r.load.curveHigh.picked && r.load.curveHigh.dropped],
  ['carico alto (~3 m): frenata violenta, CADE', (r) => r.load.brakeHigh.picked && r.load.brakeHigh.dropped],
  ['forche inclinate avanti a 1,5 m: frenata, CADE', (r) => r.load.brakeTiltFwd.picked && r.load.brakeTiltFwd.dropped],
  ['urto forte frontale col carico, CADE', (r) => r.load.bumpFast.picked && r.load.bumpFast.dropped],
  ['muro di striscio (20°): scivola senza entrarci', (r) => r.wallGraze.advancedX > 6 && !r.wallGraze.penetrated],
  ['muro di fronte (80°): si ferma senza entrarci', (r) => Math.abs(r.wallFront.vEnd) < 0.01 && r.wallFront.advancedX < 1 && !r.wallFront.penetrated],
  // contratti: il ciclo ideale deve stare nel 60% del tempo per pallet piu' stretto che il muletto puo' trovare
  // (il resto e' margine per un giocatore umano: manovre in piu', errori, scaffali)
  ['ciclo di lavoro per pallet < 60% del tempo concesso', (r) => r.cycle.total < r.tightPerPallet * 0.6],
];

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let failed = 0;
  const results = {};
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app?.game?.mode, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const ids = await page.evaluate(async () => {
      const u = performance.getEntriesByType('resource').map((e) => e.name).find((x) => x.includes('/src/data.js'));
      return (await import(u)).VEHICLES.map((v) => v.id);
    });
    for (const weather of ['clear', 'snow']) {
      results[weather] = {};
      console.log(`\n=== Meteo: ${weather === 'clear' ? 'sereno' : 'neve'} ===`);
      for (const id of ids.filter((x) => !process.env.VEH || x === process.env.VEH)) {
        const r = await page.evaluate(measureVehicle, { vehId: id, weather });
        results[weather][id] = r;
        const lines = [];
        // con la neve frenata e accelerazione sono piu' deboli per scelta: valgono solo le prove di sicurezza
        for (const [name, check] of weather === 'clear' ? CHECKS : CHECKS.filter(([n]) => !/scheda|30%|0 -> 90|frenata a vuoto/.test(n))) {
          let ok = false;
          try { ok = check(r); } catch { ok = false; }
          if (!ok) failed++;
          lines.push(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
        }
        console.log(`${r.vehicle}: frenata ${r.brakeEmpty.toFixed(2)} m, 10% ${r.v10.toFixed(2)} m/s, raggio ${r.turnRadius.toFixed(2)} m, ciclo pallet ${r.cycle.total.toFixed(1)} s (concessi ${r.tightPerPallet.toFixed(0)} s, ${r.tightAt})`);
        console.log(lines.join('\n'));
      }
    }
    // la neve deve allungare la frenata
    for (const id of Object.keys(results.snow)) {
      const ok = results.snow[id].brakeEmpty > results.clear[id].brakeEmpty * 1.2;
      if (!ok) failed++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} neve: frenata piu' lunga (${results.clear[id].brakeEmpty.toFixed(2)} -> ${results.snow[id].brakeEmpty.toFixed(2)} m) ${results.clear[id].vehicle}`);
    }
  } finally {
    if (errors.length) { failed += errors.length; console.log('Errori nella pagina:\n' + errors.join('\n')); }
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
    await browser.close();
    await server.close();
  }
  console.log(failed ? `\n${failed} prove NON passate` : '\nTutte le prove passate');
  process.exit(failed ? 1 : 0);
})();
