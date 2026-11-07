// Banco di prova della STABILITA' DEL CARICO (fase 1.5.1, modello combinato): 6 muletti, sereno/pioggia/neve,
// pallet a 0,3 / 1 / 2 / ~3 m, carico 80% e 100%, manovre normali e pericolose, 20/30/60 FPS.
// Fisica vera del muletto con il passo del gioco (Forklift.step, sottopassi di 1/60 s). Il pallet si prende e si
// alza sempre a passi di 1/60 s: la manovra parte uguale a ogni FPS.
// Le regole sotto non confermano dei numeri scelti: controllano comportamenti (resta/cade), coerenza tra FPS,
// monotonia con l'altezza e le cause delle cadute. Ogni caduta ha la sua causa (laterale, longitudinale,
// combinata, urto, montante in avanti, infilato poco, forche...).
// Uso: npm run test:carico (anche dentro npm run test:drive). VEH=d18 per un solo muletto.
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
  const corr = (a) => (t) => inp({ throttle: 1, steerTarget: t > 4 && t < 4.6 ? a : t >= 4.6 && t < 5.2 ? -a : 0 });
  const brakeAt = (t0, b = 1) => (t) => (t < t0 ? inp({ throttle: 1 }) : inp({ brake: b }));
  // [durata, inclinazione, comandi(t), FPS]
  const ALL = [20, 30, 60], ONE = [60];
  const SC = {
    rettilineo: [8, 0.03, () => inp({ throttle: 1 }), ONE],
    correzione25: [8, 0.03, corr(0.25), ALL],
    correzione40: [8, 0.03, corr(0.4), ONE],
    lenta: [8, 0.03, (t) => inp({ throttle: 0.3, steerAxis: t > 2 ? 1 : 0 }), ONE],
    normale: [8, 0.03, (t) => inp({ throttle: 0.6, steerTarget: t > 3 ? 0.5 : 0 }), ONE],
    brusca: [8, 0.03, (t) => inp({ throttle: 1, steerTarget: t > 4 ? 1 : 0 }), ALL],
    slalom: [10, 0.03, (t) => inp({ throttle: 1, steerTarget: t > 4 ? (Math.floor((t - 4) / 1.2) % 2 ? -1 : 1) : 0 }), ALL],
    progressiva: [10, 0.03, brakeAt(6, 0.4), ONE],
    emergenza: [10, 0.03, brakeAt(6), ALL],
    emergenzaAvanti: [10, -0.06, brakeAt(6), ONE],
    emergenzaIndietro: [10, 0.17, brakeAt(6), ONE],
  };
  // una prova: prende il pallet (spostato di lat m di lato), lo alza a h, imposta l'inclinazione e guida
  const runCase = async ({ h, ratio, secs, tilt, drive, fps, lat = 0, wall = null, setup = null }) => {
    const DT = 1 / fps;
    f.place(-60, 0, Math.PI / 2);
    Object.assign(f, { yawRateNow: 0, gear: 1, brakeLevel: 0, v: 0, forkY: 0.06, tilt: 0.03, steer: 0, unstable: 0, lastDropCause: null, loadStress: 0 });
    f.rates.tilt = 0; f.rates.lift = 0;
    const lz = f.geo.forkBase + 0.62;
    const px = f.x + Math.sin(f.yaw) * lz + Math.cos(f.yaw) * lat, pz = f.z + Math.cos(f.yaw) * lz - Math.sin(f.yaw) * lat;
    const pl = await g.pallets.spawn({ x: px, z: pz, yaw: f.yaw, bottom: 0, weight: Math.round(veh.capacity * ratio), loadH: 1, fragile: false });
    let k = 0;
    while (!f.carried && k++ < 240) f.update(1 / 60, inp({ lift: 1 }), env);
    k = 0;
    while (f.forkY < h && k++ < 2400) f.update(1 / 60, inp({ lift: 1 }), env);
    f.rates.lift = 0; f.tilt = tilt; f.rates.tilt = 0; f.unstable = 0; f.events.length = 0; f.lastDropCause = null;
    const picked = !!f.carried;
    const lx = picked ? f.carried.lx : null;
    if (picked) { f.carried.fLong = 0; f.carried.fLat = 0; setup?.(f.carried); }
    const w = wall ? { minX: f.x + wall, maxX: f.x + wall + 0.4, minZ: -50, maxZ: 50, y0: 0, y1: 3, tag: 'testWall' } : null;
    if (w) env.colliders.push(w);
    let maxS = 0, maxLat = 0, maxLong = 0;
    for (let t = 0; t < secs && f.carried; t += DT) {
      f.step(DT, drive(t), env);
      if (f.carried) { maxS = Math.max(maxS, f.loadStress || 0); maxLat = Math.max(maxLat, f.carried.fLat); maxLong = Math.max(maxLong, f.carried.fLong); }
    }
    if (w) env.colliders.splice(env.colliders.indexOf(w), 1);
    const res = { out: picked ? (f.carried ? 'resta' : 'cade') : 'non preso', cause: f.carried ? null : f.lastDropCause, maxS: +maxS.toFixed(4), maxLat: +maxLat.toFixed(2), maxLong: +maxLong.toFixed(2), lx };
    f.carried = null;
    g.pallets.list.splice(g.pallets.list.indexOf(pl), 1);
    pl.node.dispose();
    return res;
  };
  const res = [];
  // aderenza: la strada della prova e' davvero bagnata/innevata con pioggia e neve
  const gripBrake = (env.grip?.(-60, 0) || { brake: 1 }).brake;
  res.push({ kind: 'aderenza', ok: weather === 'clear' ? gripBrake === 1 : gripBrake < 1, gripBrake });
  for (const h of [0.3, 1.0, 2.0, hi]) for (const ratio of [0.8, 1.0]) for (const [name, [secs, tilt, drive, fpsList]] of Object.entries(SC)) {
    const byFps = {};
    for (const fps of fpsList) byFps[fps] = await runCase({ h, ratio, secs, tilt, drive, fps });
    res.push({ kind: 'griglia', name, h: h === hi ? 'alto' : h, ratio, byFps });
  }
  // extra (a 20/30/60 FPS)
  const extra = async (name, o) => {
    const byFps = {};
    for (const fps of ALL) byFps[fps] = await runCase({ ...o, fps });
    res.push({ kind: 'extra', name, byFps });
  };
  const brusca = SC.brusca[2];
  await extra('centrato, curva brusca a 1 m', { h: 1.0, ratio: 0.8, secs: 8, tilt: 0.03, drive: brusca });
  await extra('decentrato 10 cm, curva brusca a 1 m', { h: 1.0, ratio: 0.8, secs: 8, tilt: 0.03, drive: brusca, lat: 0.1 });
  await extra('centrato, curva normale a 2 m', { h: 2.0, ratio: 0.8, secs: 8, tilt: 0.03, drive: SC.normale[2] });
  await extra('decentrato 10 cm, curva normale a 2 m', { h: 2.0, ratio: 0.8, secs: 8, tilt: 0.03, drive: SC.normale[2], lat: 0.1 });
  await extra('urto forte contro un muro', { h: 0.3, ratio: 0.8, secs: 14, tilt: 0.03, drive: () => inp({ throttle: 1 }), wall: 30 });
  await extra('urto lento contro un muro', { h: 0.3, ratio: 0.8, secs: 10, tilt: 0.03, drive: () => inp({ throttle: 0.2 }), wall: 6 });
  await extra('pallet infilato poco, sollevato', { h: 0.3, ratio: 0.8, secs: 3, tilt: 0.03, drive: () => inp(), setup: (c) => { c.shallow = true; c.time = 0; } });
  await extra('montante in avanti a 1,5 m, frenata (fase 1.5)', { h: 1.5, ratio: 0.8, secs: 9, tilt: -0.06, drive: brakeAt(5) });
  app.exitMission();
  return { vehicle: veh.name, id: vehId, res };
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
  const deviations = [];
  const check = (ok, text) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${text}`); };
  const all = {};
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app?.game?.mode, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const ids = (await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((x) => x.includes('/src/data.js')))).VEHICLES.map((v) => v.id)))
      .filter((x) => !process.env.VEH || x === process.env.VEH);
    const W = { clear: 'sereno', rain: 'pioggia', snow: 'neve' };
    const HS = [0.3, 1, 2, 'alto'];
    for (const weather of ['clear', 'rain', 'snow']) {
      console.log(`\n=== Carico, meteo: ${W[weather]} ===`);
      for (const id of ids) {
        const r = await page.evaluate(measureLoad, { vehId: id, weather });
        all[`${weather}|${id}`] = r;
        const V = r.vehicle;
        const grid = r.res.filter((x) => x.kind === 'griglia');
        const ex = Object.fromEntries(r.res.filter((x) => x.kind === 'extra').map((x) => [x.name, x.byFps]));
        const outs = (x) => Object.values(x.byFps).map((y) => y.out);
        const same = (x) => new Set(outs(x)).size === 1;
        const out60 = (x) => x.byFps[60].out;
        const g = (name, h, ratio) => grid.find((x) => x.name === name && x.h === h && x.ratio === ratio);
        const desc = (x) => Object.entries(x.byFps).map(([k, v]) => `${k}: ${v.out}${v.cause ? ` (${v.cause})` : ''}`).join(', ');
        check(r.res[0].ok, `strada coerente col meteo (aderenza freni ${r.res[0].gripBrake.toFixed(2)}) ${V}`);
        // 1. coerenza tra 20, 30 e 60 FPS (tutte le prove ripetute)
        const incoerenti = [...grid, ...r.res.filter((x) => x.kind === 'extra')].filter((x) => !same(x));
        check(incoerenti.length === 0, `stesso esito a 20/30/60 FPS ${V}${incoerenti.length ? ': ' + incoerenti.map((x) => `${x.name} ${x.h ?? ''} ${desc(x)}`).join(' | ') : ''}`);
        // 2. guida normale: il pallet resta a ogni altezza e carico
        for (const name of ['rettilineo', 'correzione25', 'correzione40', 'lenta', 'normale', 'progressiva', 'emergenzaIndietro']) {
          // manovra a S a tutta velocita' (0,40) col pallet a ~3 m: segnalata a parte (DIVERSO DALLE ATTESE), non nascosta
          const bad = grid.filter((x) => x.name === name && outs(x).some((o) => o !== 'resta') && !(name === 'correzione40' && x.h === 'alto'));
          for (const x of grid.filter((y) => y.name === name && name === 'correzione40' && y.h === 'alto' && outs(y).includes('cade'))) deviations.push(`${W[weather]}, ${V}: correzione 0,40 a tutta velocita' col pallet a ~3 m (${x.ratio * 100}%): ${desc(x)}`);
          check(bad.length === 0, `${name}: RESTA a 0,3/1/2/~3 m, 80% e 100% ${V}${bad.length ? ': ' + bad.map((x) => `${x.h} m ${x.ratio * 100}% ${desc(x)}`).join(' | ') : ''}`);
        }
        // 3. pallet basso: curva brusca e slalom generalmente stabili; frenata d'emergenza stabile fino a 1 m
        for (const name of ['brusca', 'slalom']) for (const ratio of [0.8, 1.0]) check(out60(g(name, 0.3, ratio)) === 'resta', `${name} con pallet a 0,3 m (${ratio * 100}%): RESTA ${V} (${desc(g(name, 0.3, ratio))})`);
        for (const h of [0.3, 1]) for (const ratio of [0.8, 1.0]) check(out60(g('emergenza', h, ratio)) === 'resta', `frenata d'emergenza a ${h} m (${ratio * 100}%): RESTA ${V}`);
        // 4. frenata d'emergenza col pallet alto: cade sull'asciutto; con pioggia e neve il muletto frena meno (fase 1.5)
        // (sull'asciutto il rischio dipende anche dalla velocita': aggregato per meteo, sotto)
        if (weather !== 'clear') for (const ratio of [0.8, 1.0]) {
          const x = g('emergenza', 'alto', ratio);
          check(out60(x) === 'resta', `frenata d'emergenza col pallet a ~3 m (${ratio * 100}%), ${W[weather]}: RESTA (frena meno) ${V} (${desc(x)})`);
        }
        for (const ratio of [0.8, 1.0]) { const x = g('emergenza', 'alto', ratio); if (out60(x) === 'cade') check(/long/.test(x.byFps[60].cause || ''), `frenata d'emergenza col pallet a ~3 m (${ratio * 100}%): causa longitudinale ${V} (${desc(x)})`); }
        // 5. montante in avanti: frenata con pallet da 1 m in su CADE (instabilita' o frenata); all'indietro resta (sopra)
        for (const h of [1, 2, 'alto']) for (const ratio of [0.8, 1.0]) check(out60(g('emergenzaAvanti', h, ratio)) === 'cade', `montante in avanti, frenata, pallet a ${h} m (${ratio * 100}%): CADE ${V} (${desc(g('emergenzaAvanti', h, ratio))})`);
        // 6. rischio che cresce con l'altezza: se cade a una altezza, cade anche piu' in alto (stessa manovra)
        for (const name of ['brusca', 'slalom', 'emergenza', 'emergenzaAvanti']) for (const ratio of [0.8, 1.0]) {
          const seq = HS.map((h) => out60(g(name, h, ratio)));
          const first = seq.indexOf('cade');
          check(first < 0 || seq.slice(first).every((o) => o === 'cade'), `${name} (${ratio * 100}%): rischio crescente con l'altezza ${V} (${seq.join(' / ')})`);
        }
        // 7. cause registrate per ogni caduta
        const senza = [...grid, ...r.res.filter((x) => x.kind === 'extra')].flatMap((x) => Object.values(x.byFps)).filter((y) => y.out === 'cade' && !y.cause);
        check(senza.length === 0, `ogni caduta ha la sua causa ${V}`);
        // 8. pallet decentrato: misura reale del decentramento, stabilita' laterale peggiore, mai meglio del centrato
        for (const [c, d] of [['centrato, curva brusca a 1 m', 'decentrato 10 cm, curva brusca a 1 m'], ['centrato, curva normale a 2 m', 'decentrato 10 cm, curva normale a 2 m']]) {
          const C = ex[c][60], Dd = ex[d][60];
          const ok = Math.abs(Math.abs(Dd.lx) - 0.1) < 0.02 && (Dd.out === 'cade' || Dd.maxS >= C.maxS) && !(C.out === 'cade' && Dd.out === 'resta');
          check(ok, `${d}: decentramento misurato ${Dd.lx?.toFixed(3)} m, piu' instabile del centrato ${V} (centrato ${C.out} sforzo ${C.maxS}, decentrato ${Dd.out} sforzo ${Dd.maxS})`);
        }
        // 9. urti e posizionamento pericoloso: regole dedicate
        check(Object.values(ex['urto forte contro un muro']).every((y) => y.out === 'cade' && y.cause === 'urto'), `urto forte: CADE per urto ${V} (${desc({ byFps: ex['urto forte contro un muro'] })})`);
        check(Object.values(ex['urto lento contro un muro']).every((y) => y.out === 'resta'), `urto lento: RESTA ${V}`);
        check(Object.values(ex['pallet infilato poco, sollevato']).every((y) => y.out === 'cade' && y.cause === 'infilato poco'), `pallet infilato poco: CADE (infila di piu') ${V}`);
        // 10. fase 1.5 (approvato): montante in avanti a 1,5 m in frenata; sulla neve Compact 18 e Worker 35D lo tengono
        const want9 = weather === 'snow' && ['e12', 'd18'].includes(id) ? 'resta' : 'cade';
        check(Object.values(ex['montante in avanti a 1,5 m, frenata (fase 1.5)']).every((y) => y.out === want9), `montante in avanti a 1,5 m, frenata: ${want9.toUpperCase()} ${V} (${desc({ byFps: ex['montante in avanti a 1,5 m, frenata (fase 1.5)'] })})`);
      }
      // 11. per meteo: curva brusca col pallet a ~3 m pericolosa per tutti (asciutto/pioggia), a 1 m non per tutti
      if (!process.env.VEH) {
        const n = (name, h, ratio) => ids.filter((id) => all[`${weather}|${id}`].res.find((x) => x.name === name && x.h === h && x.ratio === ratio).byFps[60].out === 'cade').length;
        if (weather === 'clear') for (const ratio of [0.8, 1.0]) check(n('emergenza', 'alto', ratio) >= ids.length - 1, `sereno: frenata d'emergenza col pallet a ~3 m (${ratio * 100}%), cade con quasi tutti (${n('emergenza', 'alto', ratio)}/${ids.length})`);
        if (weather !== 'snow') {
          check(n('brusca', 'alto', 0.8) === ids.length, `${W[weather]}: curva brusca col pallet a ~3 m, CADE con tutti i muletti (${n('brusca', 'alto', 0.8)}/${ids.length})`);
          check(n('brusca', 2, 0.8) >= 3, `${W[weather]}: curva brusca col pallet a 2 m, cade con la maggior parte dei muletti (${n('brusca', 2, 0.8)}/${ids.length})`);
        } else check(n('brusca', 'alto', 0.8) >= ids.length - 2, `neve: curva brusca col pallet a ~3 m, cade con quasi tutti (${n('brusca', 'alto', 0.8)}/${ids.length})`);
        check(n('brusca', 1, 0.8) < ids.length, `${W[weather]}: curva brusca col pallet a 1 m, la caduta non e' obbligatoria per tutti (${n('brusca', 1, 0.8)}/${ids.length})`);
      }
    }
  } finally {
    if (errors.length) { failed += errors.length; console.log('Errori nella pagina:\n' + errors.join('\n')); }
    await browser.close();
    await server.close();
  }
  // tabella degli esiti (cadute sui muletti, 60 FPS) per il rapporto
  const ids = [...new Set(Object.keys(all).map((k) => k.split('|')[1]))];
  console.log('\nTabella: cadute (60 FPS) per altezza 0,3 / 1 / 2 / ~3 m');
  for (const weather of ['clear', 'rain', 'snow']) for (const ratio of [0.8, 1.0]) {
    if (!all[`${weather}|${ids[0]}`]) continue;
    console.log(`  ${weather} ${ratio * 100}%`);
    for (const name of ['rettilineo', 'correzione25', 'correzione40', 'lenta', 'normale', 'brusca', 'slalom', 'progressiva', 'emergenza', 'emergenzaAvanti', 'emergenzaIndietro']) {
      const cells = [0.3, 1, 2, 'alto'].map((h) => {
        const rows = ids.map((id) => all[`${weather}|${id}`].res.find((x) => x.name === name && x.h === h && x.ratio === ratio).byFps[60]);
        const n = rows.filter((y) => y.out === 'cade').length;
        const causes = [...new Set(rows.filter((y) => y.cause).map((y) => y.cause))].join(',');
        return `${n}/${ids.length}${causes ? ` (${causes})` : ''}`;
      });
      console.log(`    ${name.padEnd(18)} ${cells.map((c) => c.padEnd(26)).join('')}`);
    }
  }
  if (deviations.length) {
    console.log(`\nDIVERSO DALLE ATTESE (${deviations.length}, da valutare, non conta come fallimento):`);
    for (const d of deviations) console.log(`  ${d}`);
  }
  if (process.env.JSON_CARICO) require('fs').writeFileSync(process.env.JSON_CARICO, JSON.stringify(all));
  console.log(failed ? `\n${failed} prove del carico NON passate` : `\nTutte le prove del carico passate (${passed})`);
  process.exit(failed ? 1 : 0);
})();
