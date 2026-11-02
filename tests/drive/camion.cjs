// Banco di prova dei CAMION: comparsa sicura (contratto e operai IA), collisioni, uscita dalle compenetrazioni.
// Avvia il gioco senza schermo, ferma il ciclo di gioco e muove muletto e camion a passi fissi di 1/60 s.
// Uso: npm run test:camion
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright non trovato.');
  process.exit(2);
}
const ROOT = path.resolve(__dirname, '../..');

// Codice eseguito nella pagina: ritorna [{ nome, ok, info }]
async function runTests() {
  const app = window.__app, g = app.game;
  const url = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes(n));
  const P = await import(url('/src/game/physics.js'));
  const S = await import(url('/src/game/spawnsafety.js'));
  const DT = 1 / 60;
  const out = [];
  const check = (nome, ok, info = '') => out.push({ nome, ok: !!ok, info });
  const inp = (o = {}) => ({ throttle: 0, brake: 0, steerAxis: 0, steerTarget: null, lift: 0, spread: 0, tilt: 0, gear: 1, sensitivity: 1, ...o });

  // contratto con camion (carico dalla zona al camion), lotto 1; strada sgombra da auto e persone
  const start = async () => {
    await app.startMission({ type: 'load', warehouseId: 0, level: 3, seed: 2, weight: 600, pallets: 2, vehicle: 'd18', time: 'day', weather: 'clear', timeLimit: 600 });
    g.paused = true;
    g.engine.stopRenderLoop();
    g.traffic.update = () => {};
    g.traffic.cars.forEach((c) => { c.x = 5000; Object.assign(c.col, { minX: 5000, maxX: 5001, minZ: 5000, maxZ: 5001 }); });
    g.people.update = () => {};
    g.people.list.forEach((q) => { q.x = 5000; Object.assign(q.col, { minX: 5000, maxX: 5001, minZ: 5000, maxZ: 5001 }); });
  };
  await start();
  const m = g.mission, f = g.forklift, env = g.env;
  const leg0 = m.drive.legs[0];
  const at = (s) => P.pointAt(leg0.path, s); // punto del percorso del camion a distanza s
  const stepAll = (n, input = inp()) => { for (let k = 0; k < n; k++) { f.step(DT, input, env); m.update(DT, f, [], []); } };
  const resetTruck = () => {
    Object.assign(m.drive, { mode: 'arrive', i: 0, s: 0, v: 13, spawned: false, retry: 0, spawnDelays: 0 });
    m.truck.setEnabled(false);
    m.moveCol.y1 = -1;
    m.placeTruck();
  };
  const truckCount = () => g.scene.transformNodes.filter((n) => n.name === 'truck').length;
  const trucks0 = truckCount();
  const rectInside = (a, c) => P.rectPenetration(a, P.aabbToRect(c));

  // 1-2. muletto davanti (nel primo tratto) e sopra il punto di comparsa: comparsa rinviata, nessun ostacolo
  let p0 = at(6);
  f.place(p0.x, p0.z, Math.PI / 2);
  resetTruck();
  stepAll(180);
  check('1. camion che tenta di comparire davanti al giocatore: rinviato', m.drive.spawned === false && m.moveCol.y1 < 0 && !m.truck.isEnabled(), `rinvii ${m.drive.spawnDelays}, motivo ${m.spawnBlockedBy}`);
  p0 = at(0);
  f.place(p0.x, p0.z, 0);
  resetTruck();
  const time0 = m.timeLeft;
  stepAll(60 * 60); // 60 s fermo sul punto di comparsa
  check('2. muletto fermo sopra il punto di comparsa (60 s): mai comparso', m.drive.spawned === false && m.moveCol.y1 < 0, `rinvii ${m.drive.spawnDelays}`);
  check('2b. rinvio prolungato: il tempo del contratto non corre', m.timeLeft === time0, `tempo ${time0} -> ${m.timeLeft}`);
  check('2c. rinvio: nessun camion duplicato', truckCount() === trucks0, `camion ${truckCount()}`);

  // 7 + 12. area occupata da un'auto: rinviato; area libera: compare entro 0,5 s e poi arriva al suo posto
  f.place(m.bedPose.x + 40, 40, 0); // lontano
  resetTruck();
  const car = { minX: p0.x - 1, maxX: p0.x + 3, minZ: p0.z - 1, maxZ: p0.z + 1, y0: 0, y1: 1.5, tag: 'car' };
  env.colliders.push(car);
  stepAll(90);
  const blockedByCar = m.drive.spawned === false && m.spawnBlockedBy === 'car';
  env.colliders.splice(env.colliders.indexOf(car), 1);
  let tSpawn = 0;
  while (!m.drive.spawned && tSpawn < 120) { stepAll(1); tSpawn++; }
  check('7. area occupata da un\'auto: rinvio, poi comparsa appena libera (<= 0,5 s)', blockedByCar && m.drive.spawned && tSpawn <= 31, `auto: ${blockedByCar}, comparso dopo ${(tSpawn / 60).toFixed(2)} s`);
  // dissolvenza e ingombro: alla comparsa l'ingombro e' attivo, la visibilita' parte da 0 e cresce
  const v0 = m.truckFade;
  stepAll(30);
  check('11. dissolvenza e ingombro: ingombro attivo solo da comparso, visibilita\' che cresce', m.moveCol.y1 > 0 && m.truck.isEnabled() && v0 < 0.2 && m.truckFade > v0, `visibilita' ${v0?.toFixed(2)} -> ${m.truckFade?.toFixed(2)}`);
  let tPark = 0;
  while (m.drive && tPark < 60 * 60) { stepAll(1); tPark++; }
  check('13. contratto dopo un rinvio prolungato: il camion arriva e si ferma al suo posto, il tempo parte da allora', !m.drive && m.truckPose && !m.truckPose.moving && m.timeLeft === time0, `parcheggiato in ${(tPark / 60).toFixed(1)} s, tempo ${m.timeLeft}`);

  // 3. carico trasportato: il pallet sulle forche conta nell'ingombro del muletto
  const box = m.moveBoxAt(0, leg0);
  const boxes = [box];
  const pall = env.pallets.list[0];
  let dWith = null, dWithout = null;
  for (let d = 4; d <= 16; d += 0.01) {
    // muletto a est del camion, forche verso il camion (ovest); il pallet sporge 0,5 m oltre le punte
    f.place(box.maxX + d, (box.minZ + box.maxZ) / 2, -Math.PI / 2);
    f.carried = null;
    if (dWithout === null && S.spawnClear(boxes, { player: f, env, ignore: [m.moveCol, ...m.truckColliders] }).ok) dWithout = d;
    f.carried = { p: pall, lx: 0, lz: f.geo.forkBase + f.forkRects()[0].hd * 2 - 0.6 + 0.5, relYaw: 0, off: 0 };
    if (dWith === null && S.spawnClear(boxes, { player: f, env, ignore: [m.moveCol, ...m.truckColliders] }).ok) dWith = d;
  }
  f.carried = null;
  check('3. comparsa con il giocatore che trasporta un pallet: il carico aumenta la distanza richiesta', dWith !== null && dWithout !== null && dWith > dWithout, `libero da ${dWithout} m senza carico, ${dWith} m con carico`);

  // 10. giocatore in rapido avvicinamento: fermo a 14 m va bene, a 5 m/s verso il camion no
  f.place(box.minX - 14, (box.minZ + box.maxZ) / 2, Math.PI / 2);
  f.v = 0;
  const still = S.spawnClear(boxes, { player: f, env, ignore: [m.moveCol, ...m.truckColliders] }).ok;
  f.v = 5;
  const fast = S.spawnClear(boxes, { player: f, env, ignore: [m.moveCol, ...m.truckColliders] }).ok;
  f.v = 0;
  check('10. giocatore in rapido avvicinamento: comparsa rinviata (fermo alla stessa distanza: consentita)', still && !fast, `fermo: ${still}, a 5 m/s: ${fast}`);

  // 4-6. collisioni con il camion fermo al suo posto (pianale: x da bx-6 a bx+6, z = bz +- 1,25)
  const bed = m.truckColliders[0];
  const bz = (bed.minZ + bed.maxZ) / 2;
  const sideZ = m.wh.side > 0 ? bed.minZ : bed.maxZ; // lato verso la strada
  const away = m.wh.side > 0 ? -1 : 1;
  const yawTo = away > 0 ? Math.PI : 0; // muso verso il camion
  const penetrated = () => env.colliders.filter((c) => c.tag === 'truck' && c.y1 > 0).some((c) => rectInside(f.bodyRect(), c) > 0.01);
  // 4. frontale a tutta velocita' con un pallet sulle forche basse: si ferma senza entrare; il carico cade
  f.place((bed.minX + bed.maxX) / 2, sideZ + away * 8, yawTo);
  f.forkY = 0.06;
  const lz = f.geo.forkBase + 0.62;
  const pl = await g.pallets.spawn({ x: f.x + Math.sin(f.yaw) * lz, z: f.z + Math.cos(f.yaw) * lz, yaw: f.yaw, bottom: 0, weight: 800, loadH: 1, fragile: false });
  let k = 0;
  while (!f.carried && k++ < 120) f.step(DT, inp({ lift: 1 }), env);
  while (f.forkY < 0.4 && k++ < 400) f.step(DT, inp({ lift: 1 }), env);
  f.rates.lift = 0;
  const picked = !!f.carried;
  f.events.length = 0;
  let pen4 = false;
  for (let i = 0; i < 240; i++) { f.step(DT, inp({ throttle: 1 }), env); pen4 ||= penetrated(); }
  const dropped = f.events.includes('dropped') || !f.carried;
  check('4. collisione frontale con il camion: si ferma senza entrarci, il carico cade', picked && Math.abs(f.v) < 0.01 && !pen4 && dropped, `preso ${picked}, v ${f.v.toFixed(2)}, dentro ${pen4}, caduto ${dropped}`);
  // 6. retromarcia dopo l'urto: si allontana
  const z4 = f.z;
  for (let i = 0; i < 120; i++) f.step(DT, inp({ throttle: 0.6, gear: -1 }), env);
  check('6. retromarcia dopo l\'urto: il muletto si allontana', Math.abs(f.z - z4) > 1, `spostato ${Math.abs(f.z - z4).toFixed(2)} m`);
  g.pallets.list.splice(g.pallets.list.indexOf(pl), 1);
  pl.node.dispose();
  f.carried = null;
  f.forkY = 0.05;
  // 5. laterale: arriva di striscio (25°) lungo il fianco del camion: non entra
  f.place(bed.minX - 3, sideZ + away * 2.2, Math.PI / 2 - away * 0.44);
  let pen5 = false;
  for (let i = 0; i < 240; i++) { f.step(DT, inp({ throttle: 0.5 }), env); pen5 ||= penetrated(); }
  check('5. collisione laterale con il camion: nessuna compenetrazione', !pen5, `x ${f.x.toFixed(1)}`);

  // 9. compenetrazione (muletto messo apposta dentro il pianale): non entra di piu', esce in retromarcia
  f.place((bed.minX + bed.maxX) / 2, sideZ - away * 0.5, yawTo); // 0,5 m dentro
  const depth0 = rectInside(f.bodyRect(), bed);
  let deeper = false;
  for (let i = 0; i < 120; i++) { f.step(DT, inp({ throttle: 1 }), env); if (rectInside(f.bodyRect(), bed) > depth0 + 1e-3) deeper = true; }
  let tOut = 0;
  const inBed = () => f.colliderDepth(f.partsAt(f.x, f.z, f.yaw), bed, P.aabbToRect(bed));
  while (inBed() > 0 && tOut < 180) { f.step(DT, inp({ throttle: 0.6, gear: -1 }), env); tOut++; }
  check('9. incastrato nel camion: mai piu\' a fondo, esce in retromarcia entro 3 s', depth0 > 0.3 && !deeper && inBed() === 0 && tOut < 180, `profondita' ${depth0.toFixed(2)} m, uscito in ${(tOut / 60).toFixed(2)} s`);
  // 9b. incastrato in un muro di traverso sul muso: in avanti non lo attraversa, in retromarcia esce
  // punto libero: il muletto e 3 m davanti non toccano nulla (niente barili, muri o recinzioni del quartiere)
  let spot = null;
  for (let gx = -60; gx <= 60 && !spot; gx += 3) for (let gz = -60; gz <= 60 && !spot; gz += 3) {
    const ok = [0, 1, 2, 3].every((k) => !f.collides(env, gx + k, gz, Math.PI / 2));
    if (ok) spot = [gx, gz];
  }
  f.place(spot[0], spot[1], Math.PI / 2); // verso +x
  const wall = { minX: f.x + 0.7, maxX: f.x + 1.0, minZ: f.z - 4, maxZ: f.z + 4, y0: 0, y1: 3, tag: 'testWall' };
  env.colliders.push(wall);
  const xW = f.x, d9 = f.colliderDepth(f.partsAt(f.x, f.z, f.yaw), wall, P.aabbToRect(wall));
  let crossW = false;
  for (let i = 0; i < 120; i++) { f.step(DT, inp({ throttle: 1 }), env); if (f.x > wall.maxX) crossW = true; }
  let tW = 0;
  while (f.colliderDepth(f.partsAt(f.x, f.z, f.yaw), wall, P.aabbToRect(wall)) > 0 && tW < 180) { f.step(DT, inp({ throttle: 0.6, gear: -1 }), env); tW++; }
  const outW = f.colliderDepth(f.partsAt(f.x, f.z, f.yaw), wall, P.aabbToRect(wall)) === 0;
  check('9b. incastrato in un muro: non lo attraversa, esce in retromarcia entro 3 s', d9 > 0 && !crossW && outW && tW < 180, `area ${d9.toFixed(2)} m², uscito in ${(tW / 60).toFixed(2)} s`);
  env.colliders.splice(env.colliders.indexOf(wall), 1);
  // 14. compenetrazione con piu' ostacoli: due muri che si stringono sul muletto; nessuno attraversato
  f.place(m.bedPose.x + 30, 50 * m.wh.side, 0);
  const wA = { minX: f.x - 3, maxX: f.x + 3, minZ: f.z - 1.6, maxZ: f.z - 0.9, y0: 0, y1: 3, tag: 'testWall' };
  const wB = { minX: f.x - 3, maxX: f.x + 3, minZ: f.z + 0.9, maxZ: f.z + 1.6, y0: 0, y1: 3, tag: 'testWall' };
  env.colliders.push(wA, wB);
  const dA0 = rectInside(f.bodyRect(), wA), dB0 = rectInside(f.bodyRect(), wB);
  let worse = false, crossed = false;
  for (const input of [inp({ throttle: 1 }), inp({ throttle: 1, gear: -1 }), inp({ throttle: 0.6, steerAxis: 1 })]) {
    for (let i = 0; i < 120; i++) {
      f.step(DT, input, env);
      const dA = rectInside(f.bodyRect(), wA), dB = rectInside(f.bodyRect(), wB);
      if (dA > Math.max(dA0, 0) + 1e-3 || dB > Math.max(dB0, 0) + 1e-3) worse = true;
      if (f.z < wA.minZ || f.z > wB.maxZ) crossed = true;
    }
  }
  env.colliders.splice(env.colliders.indexOf(wA), 1);
  env.colliders.splice(env.colliders.indexOf(wB), 1);
  check('14. compenetrazione con due ostacoli: nessuno peggiora, nessuno attraversato', (dA0 > 0 || dB0 > 0) && !worse && !crossed, `dentro ${dA0.toFixed(2)} / ${dB0.toFixed(2)} m`);

  // camion degli operai: comparsa sicura dalla strada (due operai con camion nello stesso lotto)
  g.bots.setWorkers([0, 1].map((i) => ({ id: `t${i}`, name: 'x', avatar: 0, level: 3, warehouse: 0, vehicle: 'd18' })));
  g.bots.pick = () => [];
  await g.bots.spawn(g.bots.workers[0]);
  await g.bots.spawn(g.bots.workers[1]);
  for (let i = 0; i < 20; i++) { g.scene.onAfterRenderObservable.notifyObservers(g.scene); await new Promise((r) => setTimeout(r, 5)); }
  await new Promise((r) => setTimeout(r, 300));
  const bots = [...g.bots.bots.values()].filter((b) => b.truck);
  const send = (b) => { const tr = b.truck; tr.state = 'arriving'; tr.offset = -16; tr.wait = 0; tr.v = 0; tr.spawnDelays = 0; g.bots.placeTruck(b); };
  bots.forEach(send);
  // 8. operaio: muletto fermo sul punto di comparsa del suo camion: rinviato, ingombro spento
  const b0 = bots[0];
  const box0 = g.bots.truckBoxes(b0, -16).cab;
  f.place((box0.minX + box0.maxX) / 2, (box0.minZ + box0.maxZ) / 2, 0);
  for (let i = 0; i < 120; i++) g.bots.driveTruck(b0, DT, f);
  check('8. camion di un operaio con il muletto sul punto di comparsa: rinviato, ingombro spento', b0.truck.offset <= -16 + 1e-3 && b0.truck.cabCol.y1 < 0 && b0.truck.spawnDelays > 0, `rinvii ${b0.truck.spawnDelays}, motivo ${b0.truck.spawnBlockedBy}`);
  // 15. due camion che compaiono insieme (muletto lontano): compaiono entrambi senza sovrapporsi
  f.place(m.bedPose.x + 30, 50 * m.wh.side, 0);
  bots.forEach(send);
  for (let i = 0; i < 600; i++) for (const b of bots) g.bots.driveTruck(b, DT, f);
  const cols = bots.flatMap((b) => [b.truck.bedCol, b.truck.cabCol]).filter((c) => c.y1 > 0);
  let overlap = false;
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    if (Math.floor(i / 2) !== Math.floor(j / 2) && P.rectsOverlap(P.aabbToRect(cols[i]), P.aabbToRect(cols[j]))) overlap = true;
  }
  check('15. due camion degli operai che compaiono insieme: nessuna sovrapposizione', bots.length === 2 && bots.every((b) => b.truck.offset > -16 + 1) && !overlap, `camion ${bots.length}, posizioni ${bots.map((b) => b.truck.offset.toFixed(1)).join(', ')}`);
  // 12. nessuna sovrapposizione tra il camion del contratto e quelli degli operai
  const ct = m.truckColliders.filter((c) => c.y1 > 0);
  const anyOverlap = ct.some((a) => cols.some((b) => P.rectsOverlap(P.aabbToRect(a), P.aabbToRect(b))));
  check('12. nessuna sovrapposizione tra il camion del contratto e quelli degli operai', !anyOverlap);
  // 16. fine del contratto: gli ingombri dei camion degli operai restano (prima sparivano tutti i 'truck')
  m.forceDone = true;
  f.carried = null;
  m.update(DT, f, [], []);
  const stillThere = cols.every((c) => env.colliders.includes(c));
  check('16. fine contratto: i camion degli operai restano solidi', stillThere);
  app.exitMission();
  return out;
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
  let failed = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app?.game?.mode, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const res = await page.evaluate(runTests);
    for (const r of res) {
      if (!r.ok) failed++;
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.nome}${r.info ? `  (${r.info})` : ''}`);
    }
  } finally {
    if (errors.length) { failed += errors.length; console.log('Errori nella pagina:\n' + errors.join('\n')); }
    await browser.close();
    await server.close();
  }
  console.log(failed ? `\n${failed} prove NON passate` : '\nTutte le prove dei camion passate');
  process.exit(failed ? 1 : 0);
})();
