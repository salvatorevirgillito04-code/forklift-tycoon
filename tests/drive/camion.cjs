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
  const M = await import(url('/src/game/mission.js'));
  const DT = 1 / 60;
  const out = [];
  const check = (nome, ok, info = '') => out.push({ nome, ok: !!ok, info });
  const inp = (o = {}) => ({ throttle: 0, brake: 0, steerAxis: 0, steerTarget: null, lift: 0, spread: 0, tilt: 0, gear: 1, sensitivity: 1, ...o });

  // contratto con camion (carico dalla zona al camion), lotto 1; strada sgombra da auto e persone
  const start = async (vehicle = 'd18') => {
    await app.startMission({ type: 'load', warehouseId: 0, level: 3, seed: 2, weight: 600, pallets: 2, vehicle, time: 'day', weather: 'clear', timeLimit: 600 });
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

  // 17. camion non ancora comparso: il traffico non lo vede (un'auto ferma davanti al camion invisibile
  // bloccherebbe per sempre la comparsa). Area occupata da un ostacolo che il traffico non considera.
  {
    f.place(m.bedPose.x + 40, 40, 0); // lontano
    resetTruck();
    const bx = m.moveBoxAt(0, leg0);
    const blk = { minX: bx.minX, maxX: bx.minX + 0.5, minZ: bx.minZ, maxZ: bx.minZ + 0.5, y0: 0, y1: 1.7, tag: 'person' };
    env.colliders.push(blk);
    const car = g.traffic.cars[0], keep = { x: car.x, z: car.z, dir: car.dir, v: car.v };
    const horiz = bx.maxX - bx.minX > bx.maxZ - bx.minZ;
    Object.assign(car, { dir: 1, x: bx.minX - 10, z: (bx.minZ + bx.maxZ) / 2, v: car.vmax });
    const realUpdate = Object.getPrototypeOf(g.traffic).update;
    let vMin = Infinity, passed = false;
    for (let i = 0; i < 120; i++) {
      stepAll(1);
      realUpdate.call(g.traffic, DT, f, m.trafficObstacles());
      vMin = Math.min(vMin, car.v);
      if (car.x > bx.minX) passed = true;
    }
    const hiddenOk = m.drive.spawned === false && m.trafficObstacles().length === 0;
    env.colliders.splice(env.colliders.indexOf(blk), 1);
    Object.assign(car, keep);
    car.x = 5000; Object.assign(car.col, { minX: 5000, maxX: 5001, minZ: 5000, maxZ: 5001 });
    let t17 = 0;
    while (!m.drive.spawned && t17 < 60) { stepAll(1); t17++; }
    const seenAfter = m.drive.spawned && m.trafficObstacles().length === 1;
    check('17. camion non comparso: il traffico non lo vede e non si ferma; comparso: lo vede', horiz && hiddenOk && passed && vMin > 1 && seenAfter, `strada lungo x ${horiz}, v minima auto ${vMin.toFixed(1)} m/s, passata ${passed}, poi visto ${seenAfter}`);
  }

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
  const send = (b) => { const tr = b.truck; g.bots.truckToRoad(tr, 0); tr.spawnDelays = 0; tr.leaveDelays = 0; g.bots.placeTruck(b); };
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
  await workerTruckTests({ app, g, S, M, P, DT, inp, check, start });
  return out;

// ---------- Fase 1.4: camion degli operai con il muletto che guida davvero (Colossus, 7,2 m/s) ----------
// Funzioni reali del gioco: Forklift.step, WorkerBots.update (camion, comparsa, scomparsa), Traffic.update.
// Il lavoro degli operai (spostare i pallet) e' fermo: i camion si comandano a mano per avere casi ripetibili.
async function workerTruckTests({ app, g, S, M, P, DT, inp, check, start }) {
  await start('d80');
  const m = g.mission, arriveLegs = m.drive.legs, limit = m.timeLeft;
  const f = g.forklift, env = g.env, B = g.bots, Z = S.ZONE;
  if (window.__weak) Object.assign(M.YIELD, { margin: -1000 }); // il camion del contratto non da' piu' precedenza
  if (window.__weak) Object.assign(Z, { reactS: 0, speedMarginS: 0, brakeDec: 1e9, fadeS: 3 });
  B.setWorkers([0, 1].map((i) => ({ id: `t${i}`, name: 'x', avatar: 0, level: 3, warehouse: 0, vehicle: 'd18' })));
  B.pick = () => [];
  await B.spawn(B.workers[0]);
  await B.spawn(B.workers[1]);
  for (let i = 0; i < 20; i++) { g.scene.onAfterRenderObservable.notifyObservers(g.scene); await new Promise((r) => setTimeout(r, 5)); }
  await new Promise((r) => setTimeout(r, 300));
  B.work = () => {};
  const realTraffic = Object.getPrototypeOf(g.traffic).update;
  const allCars = g.traffic.cars;
  const bots = [...B.bots.values()].filter((b) => b.truck);
  const wb = bots[0], wt = wb.truck, other = bots[1];
  const vmax = f.veh ? f.veh.speed : 7.2;
  const atHome = (b) => { Object.assign(b.truck, { state: 'parked', offset: 0, phase: 'drive', fade: 1, solid: true, v: 0, wait: 0 }); B.placeTruck(b); };
  const toRoad = (b) => { B.truckToRoad(b.truck, 0); b.truck.spawnDelays = 0; b.truck.leaveDelays = 0; B.placeTruck(b); };
  const zoneOf = (b) => { const t = B.truckBoxes(b, -16); return { minX: Math.min(t.bed.minX, t.cab.minX), maxX: Math.max(t.bed.maxX, t.cab.maxX), minZ: Math.min(t.bed.minZ, t.cab.minZ), maxZ: Math.max(t.bed.maxZ, t.cab.maxZ) }; };
  const zb = zoneOf(wb);
  const zx = (zb.minX + zb.maxX) / 2;
  const truckNodes = () => g.scene.transformNodes.filter((n) => n.name === 'truck').length;
  const truckCols = () => env.colliders.filter((c) => c.tag === 'truck').length;
  const nodes0 = truckNodes(), cols0 = truckCols();
  const partsNow = () => f.partsAt(f.x, f.z, f.yaw);
  const depthIn = (c) => (c.y1 > 0 ? f.colliderDepth(partsNow(), c, P.aabbToRect(c)) : 0);
  // Il muletto poteva evitarlo? Al momento in cui il camion diventa solido: frenando dopo il tempo di reazione
  // (fermo in linea retta), il muletto non deve toccarlo. Altrimenti: collisione imprevedibile (violazione).
  const REACT = 1.5, DEC = 2.5;
  const unavoidable = (b) => {
    const rs = [b.truck.bedCol, b.truck.cabCol].map((c) => P.aabbToRect(c));
    const v = f.v, tEnd = REACT + Math.abs(v) / DEC;
    for (let t = 0; t <= tEnd + 1e-6; t += 0.05) {
      const s = t <= REACT ? v * t : v * REACT + Math.sign(v) * (Math.abs(v) * (t - REACT) - DEC * (t - REACT) ** 2 / 2);
      const x = f.x + Math.sin(f.yaw) * s, z = f.z + Math.cos(f.yaw) * s;
      const parts = [f.bodyRect(x, z, f.yaw), ...f.forkRects(x, z, f.yaw)];
      if (f.carried) { const cp = f.carriedPose(x, z, f.yaw); parts.push({ x: cp.x, z: cp.z, hw: 0.6, hd: 0.6, yaw: cp.yaw }); }
      if (parts.some((p) => rs.some((r) => P.rectsOverlap(p, r)))) return true;
    }
    return false;
  };
  // Simulazione: driver(t) -> comandi. Ritorna i problemi trovati.
  const sim = (dt, secs, driver, o = {}) => {
    const st = { viol: 0, violInfo: '', ghost: 0, pen: 0, invisSolid: 0, leaveRoad: 0, activations: 0, maxFade: 0, contact: false, maxCheckMs: 0, maxFrameMs: 0, sumFrameMs: 0, frames: 0 };
    const was = new Map(bots.map((b) => [b, b.truck.solid]));
    for (let t = 0; t < secs; t += dt) {
      const input = driver(t, st);
      if (input === null) break;
      f.step(dt, input, env);
      const t0 = performance.now();
      B.update(dt, f, o.cars || [], o.movers || []);
      const ms = performance.now() - t0;
      st.maxFrameMs = Math.max(st.maxFrameMs, ms); st.sumFrameMs += ms; st.frames++;
      if (o.traffic) realTraffic.call(g.traffic, dt, f, B.trafficObstacles([]));
      for (const b of bots) {
        const tr = b.truck, cols = [tr.bedCol, tr.cabCol];
        st.maxFade = Math.max(st.maxFade, b === wb ? tr.fade : 0);
        if (tr.solid && !was.get(b)) {
          st.activations++;
          if (unavoidable(b)) { st.viol++; st.violInfo ||= `t ${t.toFixed(2)} v ${f.v.toFixed(1)} x ${(f.x - zx).toFixed(1)} z ${f.z.toFixed(1)}`; }
        }
        was.set(b, tr.solid);
        if (tr.solid && tr.state === 'arriving' && tr.fade < 1) st.invisSolid++;
        if (!tr.solid && cols.some((c) => c.y1 > 0)) st.invisSolid++;
        // in uscita non entra mai nella carreggiata
        if (tr.state === 'leaving' && cols.some((c) => c.y1 > 0 && c.minZ < 7 && c.maxZ > -7)) st.leaveRoad++;
        const touching = cols.includes(f.blockedBy) || cols.some((c) => depthIn(c) > 0);
        if (touching) { st.contact = true; if (tr.fade < 0.99) st.ghost++; }
        if (cols.some((c) => depthIn(c) > 0.02)) st.pen++;
      }
    }
    return st;
  };
  const bad = (st) => st.viol + st.ghost + st.pen + st.invisSolid + st.leaveRoad;
  const say = (st) => `violazioni ${st.viol}${st.violInfo ? ` (${st.violInfo})` : ''}, urti con camion non del tutto visibile ${st.ghost}, compenetrazioni ${st.pen}, solido da invisibile ${st.invisSolid}, uscita sulla strada ${st.leaveRoad}`;
  const hold = (speed, gear = 1) => () => inp({ throttle: Math.min(1, Math.abs(speed) / vmax + 0.02), gear });
  const lanes = [-3.5, 3.5];
  const FPS = [20, 30, 60];
  const away = () => { f.place(zx + 200, 30, 0); f.v = 0; };

  // W1. fermo nel punto di comparsa (20 s): mai visibile, mai solido
  atHome(other);
  for (const fps of FPS) {
    toRoad(wb);
    f.place(zx, (zb.minZ + zb.maxZ) / 2, 0); f.v = 0;
    const st = sim(1 / fps, 20, () => inp());
    check(`W1. muletto fermo sul punto di comparsa, ${fps} FPS: il camion non compare`, st.maxFade === 0 && !wt.solid && bad(st) === 0 && wt.spawnDelays > 0, `visibilita' massima ${st.maxFade.toFixed(2)}, rinvii ${wt.spawnDelays}`);
  }

  // W2. avvicinamento lento (2 m/s) e rapido (7,2 m/s) sulle due corsie, da 6 a 45 m, a 20/30/60 FPS
  for (const fps of FPS) {
    let n = 0, fails = [], acts = 0;
    for (const speed of [2, vmax]) for (const lz of lanes) for (const d of [6, 12, 18, 22, 26, 32, 38, 45]) {
      toRoad(wb);
      f.place(zb.minX - d, lz, Math.PI / 2); f.v = speed;
      const st = sim(1 / fps, (d + 30) / speed, hold(speed));
      n++; acts += st.activations;
      if (bad(st)) fails.push(`${speed.toFixed(1)} m/s, corsia ${lz}, ${d} m: ${say(st)}`);
    }
    check(`W2. avvicinamento lento e rapido, ${fps} FPS (${n} casi): nessun camion inevitabile`, fails.length === 0 && acts > 0, `comparse ${acts}; ` + fails.slice(0, 3).join(' | '));
  }

  // W2b. il giocatore reagisce: frena 1,5 s dopo che il camion inizia a comparire davanti a lui (verifica dei
  // parametri: con reazione e frenata reali non lo tocca mai)
  for (const fps of FPS) {
    let fails = [];
    for (const lz of lanes) for (const d of [15, 20, 25, 30, 35, 40, 50, 60]) {
      toRoad(wb);
      f.place(zb.minX - d, lz, Math.PI / 2); f.v = vmax;
      let seenT = null;
      const st = sim(1 / fps, 14, (t) => {
        if (seenT === null && wt.fade > 0 && f.x < zb.maxX) seenT = t;
        return seenT !== null && t - seenT >= REACT ? inp({ brake: 1 }) : inp({ throttle: 1 });
      });
      if (st.contact || bad(st)) fails.push(`corsia ${lz}, ${d} m: contatto ${st.contact}, ${say(st)}`);
    }
    check(`W2b. il giocatore frena dopo 1,5 s dalla comparsa, ${fps} FPS: nessun contatto`, fails.length === 0, fails.slice(0, 3).join(' | '));
  }

  // W3. arrivo durante la dissolvenza: la comparsa si annulla, il camion non diventa solido
  for (const fps of FPS) {
    toRoad(wb); away();
    sim(1 / fps, 5, () => (wt.phase === 'fadeIn' && wt.fade > 0.3 ? null : inp()));
    const fade0 = wt.fade;
    f.place(zb.minX - 25, -3.5, Math.PI / 2); f.v = vmax;
    let aborted = false;
    const st = sim(1 / fps, 0.5, () => { aborted ||= wt.phase === 'abort' || wt.phase === 'hidden'; return hold(vmax)(); });
    check(`W3. arrivo durante la dissolvenza, ${fps} FPS: comparsa annullata, mai solido`, fade0 > 0.3 && aborted && !wt.solid && bad(st) === 0, `visibilita' ${fade0.toFixed(2)}, annullata ${aborted}, ${say(st)}`);
  }

  // W4. retromarcia verso il punto di comparsa
  for (const fps of FPS) {
    let fails = [];
    for (const d of [6, 12, 20, 30]) {
      toRoad(wb);
      f.place(zb.minX - d, -3.5, -Math.PI / 2); f.v = -3; // muso verso -x, va verso +x
      const st = sim(1 / fps, (d + 25) / 3, hold(3, -1));
      if (bad(st)) fails.push(`${d} m: ${say(st)}`);
    }
    check(`W4. retromarcia verso il punto di comparsa, ${fps} FPS`, fails.length === 0, fails.join(' | '));
  }

  // W5. camion in movimento dopo la comparsa: si ferma davanti al muletto e non lo attraversa; il muletto che gli
  // va contro di lato non entra
  {
    toRoad(wb); away();
    sim(DT, 6, () => (wt.phase === 'drive' && wt.offset > -12 ? null : inp()));
    const next = B.truckBoxes(wb, wt.offset + 3).bed;
    f.place((next.minX + next.maxX) / 2, wb.truck.dir.z < 0 ? next.maxZ + 0.6 : next.minZ - 0.6, 0); f.v = 0;
    const off0 = wt.offset;
    const st1 = sim(DT, 4, () => inp());
    const stopped = wt.offset - off0 < 3;
    f.place(zb.minX - 12, -3.5, Math.PI / 2); f.v = 0;
    const st2 = sim(DT, 6, () => inp({ throttle: 1 }));
    check('W5. camion in movimento: si ferma davanti al muletto, nessuna compenetrazione', stopped && st1.pen === 0 && st2.pen === 0 && bad(st1) + bad(st2) === 0, `avanzato ${(wt.offset - off0).toFixed(2)} m, ${say(st1)}; ${say(st2)}`);
  }

  // W6. muletto con pallet: il carico conta nella zona (pallet che sporge oltre le forche, verso il camion)
  {
    toRoad(wb);
    const pall = env.pallets.list[0];
    let dWith = null, dWithout = null;
    for (let d = 4; d <= 30; d += 0.05) {
      f.place(zb.minX - d, -3.5, Math.PI / 2); f.v = 0;
      f.carried = null;
      if (dWithout === null && B.truckSpawnClear(wb, f)) dWithout = d;
      f.carried = { p: pall, lx: 0, lz: f.geo.forkBase + f.forkRects()[0].hd * 2 - 0.6 + 0.5, relYaw: 0, off: 0 };
      if (dWith === null && B.truckSpawnClear(wb, f)) dWith = d;
    }
    f.carried = null;
    check('W6. muletto con pallet: serve piu\' spazio', dWith !== null && dWithout !== null && dWith > dWithout, `libero da ${dWithout?.toFixed(2)} m senza carico, ${dWith?.toFixed(2)} m con carico`);
  }

  // W7. due camion che compaiono insieme, con il muletto che passa davanti a uno dei due
  {
    toRoad(wb); toRoad(other);
    f.place(zb.minX - 30, -3.5, Math.PI / 2); f.v = vmax;
    const st = sim(DT, 12, hold(vmax));
    const cols = bots.flatMap((b) => [b.truck.bedCol, b.truck.cabCol]).filter((c) => c.y1 > 0);
    let overlap = false;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (Math.floor(i / 2) !== Math.floor(j / 2) && P.rectsOverlap(P.aabbToRect(cols[i]), P.aabbToRect(cols[j]))) overlap = true;
    check('W7. due camion insieme: compaiono entrambi, nessuna sovrapposizione, nessun camion inevitabile', bots.every((b) => b.truck.solid) && !overlap && bad(st) === 0, `stati ${bots.map((b) => `${b.truck.phase} ${b.truck.offset.toFixed(1)}`).join(', ')}, ${say(st)}`);
    atHome(other);
  }

  // W8. camion riutilizzato: ciclo completo (uscita, scomparsa, nuova comparsa, arrivo) e operaio nascosto/ripreso
  // con il camion sulla strada
  {
    atHome(wb); away();
    const mode0 = wb.mode;
    Object.assign(wt, { state: 'leaving', wait: 0 });
    const phases = new Set();
    sim(DT, 40, () => { phases.add(`${wt.state}:${wt.phase}`); return wt.state === 'parked' && phases.has('arriving:fadeIn') ? null : inp(); });
    const cycled = wt.state === 'parked' && phases.has('leaving:fadeOut') && phases.has('arriving:hidden') && wb.mode !== mode0;
    // operaio nascosto (lontano) col camion a meta' strada: torna nascosto fuori, riprende con la comparsa sicura
    Object.assign(wt, { state: 'arriving', phase: 'drive', offset: -10, fade: 1, solid: true });
    const id = [...B.bots.entries()].find(([, b]) => b === wb)[0];
    B.park(id); B.unpark(id);
    const reset = wt.phase === 'hidden' && !wt.solid && wt.offset === -16 && wt.cabCol.y1 < 0;
    check('W8. camion riutilizzato: ciclo completo e ripresa dell\'operaio senza comparsa improvvisa', cycled && reset && truckNodes() === nodes0 && truckCols() === cols0, `ciclo ${cycled}, ripreso nascosto ${reset}, camion ${truckNodes()}/${nodes0}, ingombri ${truckCols()}/${cols0}`);
  }

  // W9. attraversamenti ripetuti della zona (60 s, avanti e indietro) con i camion che vanno e vengono
  for (const fps of FPS) {
    toRoad(wb); atHome(other);
    f.place(zb.minX - 30, -3.5, Math.PI / 2); f.v = 0;
    let dir = 1, parkedT = null, cycles = 0, maxCheck = 0;
    const spawnClear0 = B.truckSpawnClear;
    B.truckSpawnClear = function (...a) { const t0 = performance.now(); const r = spawnClear0.apply(this, a); maxCheck = Math.max(maxCheck, performance.now() - t0); return r; };
    const st = sim(1 / fps, 60, (t) => {
      if (wt.state === 'parked') { parkedT ??= t; if (t - parkedT > 2) { Object.assign(wt, { state: 'leaving', wait: 0 }); parkedT = null; cycles++; } }
      if (dir > 0 && f.x > zb.maxX + 25) { dir = -1; f.place(f.x, f.z, -Math.PI / 2); f.v = 0; }
      if (dir < 0 && f.x < zb.minX - 25) { dir = 1; f.place(f.x, f.z, Math.PI / 2); f.v = 0; }
      return inp({ throttle: 0.7 });
    });
    B.truckSpawnClear = spawnClear0;
    check(`W9. attraversamenti ripetuti per 60 s, ${fps} FPS: nessun camion inevitabile, nessun attraversamento`, bad(st) === 0 && truckNodes() === nodes0 && truckCols() === cols0, `${say(st)}, comparse ${st.activations}, cicli ${cycles}, controllo piu' lento ${maxCheck.toFixed(3)} ms, aggiornamento operai medio ${(st.sumFrameMs / st.frames).toFixed(4)} ms, piu' lento ${st.maxFrameMs.toFixed(3)} ms`);
  }

  // D. scomparsa: mai invisibile e solido dove il giocatore puo' arrivare
  {
    // D1. muletto fermo accanto al camion fuori: resta visibile e solido
    const leave = () => { atHome(wb); Object.assign(wt, { state: 'leaving', wait: 0 }); };
    atHome(wb);
    const cab = wt.cabCol;
    f.place(cab.maxX + 3, (cab.minZ + cab.maxZ) / 2, -Math.PI / 2); f.v = 0; // accanto al camion, prima che riparta
    Object.assign(wt, { state: 'leaving', wait: 0 });
    let minFade = 1;
    const st1 = sim(DT, 10, () => { minFade = Math.min(minFade, wt.fade); return inp(); });
    check('D1. scomparsa con il muletto vicino: il camion resta visibile e solido', minFade > 0.95 && wt.solid && wt.state === 'leaving' && bad(st1) === 0, `visibilita' minima ${minFade.toFixed(2)}, solido ${wt.solid}, rinvii ${wt.leaveDelays}`);
    // D2. il muletto arriva mentre scompare: torna visibile, nessun urto con un camion quasi invisibile
    for (const fps of FPS) {
      away(); leave();
      sim(1 / fps, 3, () => (wt.fade < 0.6 ? null : inp()));
      const fade0 = wt.fade;
      f.place(zb.minX - 22, wt.home.z, Math.PI / 2); f.v = vmax; // nel piazzale, verso il fianco del camion
      let back = false;
      const st2 = sim(1 / fps, 8, () => { back ||= wt.fade > 0.99; return hold(vmax)(); });
      check(`D2. muletto in arrivo durante la scomparsa, ${fps} FPS: torna visibile, nessun urto con camion quasi invisibile`, fade0 < 0.6 && fade0 > 0 && back && bad(st2) === 0, `visibilita' ${fade0.toFixed(2)} -> ${wt.fade.toFixed(2)}, ${say(st2)}`);
    }
    // D3. muletto lontano: scompare e solo a visibilita' 0 perde l'ingombro
    away(); leave();
    let solidWhileGone = false, gone = false;
    sim(DT, 5, () => { if (wt.state === 'leaving' && !wt.solid) solidWhileGone = true; if (wt.state === 'arriving') gone = true; return gone ? null : inp(); });
    check('D3. muletto lontano: il camion scompare e perde l\'ingombro solo quando e\' sparito', gone && !solidWhileGone && wt.fade === 0 && wt.cabCol.y1 < 0, `sparito ${gone}`);
  }

  // T. traffico: le auto vedono i camion solidi, non li attraversano, non restano bloccate, non impediscono la comparsa
  {
    const car = allCars[0], vmax0 = car.vmax;
    g.traffic.cars = [car];
    const putCar = (x, dir) => {
      Object.assign(car, { x, dir, z: dir > 0 ? -3.5 : 3.5, vmax: 9, v: 9, blockT: 0, hornT: 0 }); // velocita' fissa: prova ripetibile
      // ingombro coerente con la posizione (nel gioco lo aggiorna il traffico insieme all'auto)
      Object.assign(car.col, { minX: dir > 0 ? x + car.rear : x - car.front, maxX: dir > 0 ? x + car.front : x - car.rear, minZ: car.z - car.hw, maxZ: car.z + car.hw });
    };
    // T1. camion che attraversa la strada (in arrivo): l'auto si ferma, poi riparte
    toRoad(wb); away();
    sim(DT, 3, () => (wt.solid ? null : inp()));
    putCar(zb.maxX + 40, -1); // corsia lato lotto: il camion la occupa piu' a lungo
    let carIn = false, minV = 99;
    const stT = sim(DT, 25, () => {
      const cc = car.col;
      if ([wt.bedCol, wt.cabCol].some((c) => c.y1 > 0 && P.rectsOverlap(P.aabbToRect(c), P.aabbToRect(cc)))) carIn = true;
      minV = Math.min(minV, car.v);
      return inp();
    }, { traffic: true, cars: [car] });
    check('T1. auto e camion che attraversa la strada: si ferma senza attraversarlo, poi riparte', !carIn && minV < 2 && car.v > 5 && wt.state === 'parked', `attraversato ${carIn}, v minima ${minV.toFixed(1)}, v finale ${car.v.toFixed(1)}, camion ${wt.state}`);
    // T2. auto in arrivo: la comparsa aspetta, poi avviene; l'auto non si ferma per un camion che non c'e'
    toRoad(wb); away();
    putCar(zb.minX - 25, 1);
    let carStopped = false, delayedByCar = false;
    sim(DT, 12, () => { if (car.v < 1) carStopped = true; if (wt.spawnBlockedBy === 'car') delayedByCar = true; return wt.solid ? null : inp(); }, { traffic: true, cars: [car] });
    check('T2. auto in arrivo: la comparsa aspetta l\'auto, l\'auto non si ferma per un camion invisibile', delayedByCar && !carStopped && wt.solid, `rinviata per l'auto ${delayedByCar}, auto ferma ${carStopped}, comparso ${wt.solid}`);
    g.traffic.cars = allCars;
    car.vmax = vmax0;
  }

  // W12. ciclo con il vero lavoro dell'operaio: niente da spostare -> chooseMove fa ripartire il camion, che scompare
  // al suo posto (mai sulla strada), poi ne arriva un altro con la comparsa sicura
  {
    const work0 = Object.getPrototypeOf(B).work;
    B.work = work0;
    atHome(wb); atHome(other); away();
    const dst = wb.mode === 'load' ? wb.bed : wb.ground;
    const caps = dst.map((q) => q.cap);
    dst.forEach((q) => { q.cap = q.stack.length; }); // destinazione piena: nulla da spostare
    const seq = [];
    // arrivato al suo posto: 'parked', oppure gia' ripartito nello stesso fotogramma (ancora nulla da spostare)
    const arrived = () => seq.includes('arriving:fadeIn') && (wt.state === 'parked' || (seq.includes('arriving:drive') && wt.state === 'leaving'));
    const st = sim(DT, 40, () => { const k = `${wt.state}:${wt.phase}`; if (seq[seq.length - 1] !== k) seq.push(k); return arrived() ? null : inp(); });
    dst.forEach((q, i) => { q.cap = caps[i]; });
    B.work = () => {};
    const ok = seq.includes('leaving:fadeOut') && seq.includes('arriving:hidden') && arrived() && bad(st) === 0;
    check('W12. ripartenza decisa dall\'operaio (chooseMove, nulla da spostare): scompare al suo posto, ne arriva un altro', ok, `${seq.join(' > ')}; ${say(st)}`);
  }

  // M1. camion del contratto in viaggio: i camion degli operai aspettano che arrivi o se ne vada
  {
    toRoad(wb); away();
    const mover = { minX: zb.minX - 60, maxX: zb.minX - 50, minZ: -4.7, maxZ: -2.3, y0: 0, y1: 4, tag: 'truck' };
    const st1 = sim(DT, 3, () => inp(), { movers: [mover] });
    const waited = !wt.solid && wt.fade === 0 && wt.spawnBlockedBy === 'camion contratto';
    const st2 = sim(DT, 3, () => (wt.solid ? null : inp()));
    check('M1. camion del contratto in viaggio: il camion dell\'operaio aspetta, poi compare', waited && wt.solid && bad(st1) + bad(st2) === 0, `aspettato ${waited}, comparso dopo ${wt.solid}`);
  }

  // ---------- C. camion del contratto e camion degli operai: precedenza, nessun attraversamento, nessun blocco ----------
  {
    const TF = 6 + 5, TR = -6 - 0.2, HW = 1.25 + 0.05; // come in mission.js (TRUCK 12 x 2,5)
    const cRect = () => { const Q = m.truckPose, mid = (TF + TR) / 2; return { x: Q.x + Math.cos(Q.yaw) * mid, z: Q.z - Math.sin(Q.yaw) * mid, hw: (TF - TR) / 2, hd: HW, yaw: Q.yaw }; };
    const ownCols = () => m.truckColliders || [];
    const arrive = () => {
      env.colliders = env.colliders.filter((c) => !ownCols().includes(c) && c !== m.moveCol);
      env.colliders.push(m.moveCol);
      m.finished = false; m.timeLeft = limit;
      m.drive = { mode: 'arrive', i: 0, s: 0, v: 13, legs: arriveLegs, spawned: false, retry: 0, spawnDelays: 0 };
      m.truck.setEnabled(false); m.moveCol.y1 = -1; m.placeTruck();
    };
    const leave = () => {
      env.colliders = env.colliders.filter((c) => !ownCols().includes(c));
      if (!env.colliders.includes(m.moveCol)) env.colliders.push(m.moveCol);
      m.finished = true; m.truck.setEnabled(true); m.moveCol.y1 = 4;
      m.drive = { mode: 'leave', i: 0, s: 0, v: 0, legs: m.leaveLegsFor() };
      m.placeTruck();
    };
    const cross = (b, off) => { Object.assign(b.truck, { state: 'arriving', phase: 'drive', offset: off, fade: 1, solid: true, v: 0, wait: 0 }); B.placeTruck(b); };
    const hidden = (b) => { B.truckToRoad(b.truck, 1e9); B.placeTruck(b); };
    // passo comune: muletto, operai (con le auto e il camion del contratto), traffico vero se richiesto, contratto
    const csim = (dt, secs, o = {}) => {
      const r = { t: 0, overlap: 0, carHit: 0, minV: Infinity, switches: 0, maxDec: 0, done: false, parkT: null, timeAtPark: null, costSum: 0, costMax: 0, n: 0 };
      let prevV = m.drive ? m.drive.v : 0, st = 0;
      for (let t = 0; t < secs; t += dt) {
        if (o.each) o.each(t, r);
        f.step(dt, inp(), env);
        const cars = o.cars || [];
        B.update(dt, f, cars, m.trafficObstacles());
        if (o.cars) realTraffic.call(g.traffic, dt, f, B.trafficObstacles(m.trafficObstacles()));
        const zones = B.truckZones();
        const t0 = performance.now();
        const hadDrive = !!m.drive;
        m.update(dt, f, cars, [], zones);
        const ms = performance.now() - t0;
        r.costSum += ms; r.costMax = Math.max(r.costMax, ms); r.n++;
        r.t = t + dt;
        if (hadDrive && !m.drive && r.parkT === null) { r.parkT = r.t; r.timeAtPark = m.timeLeft; }
        const d = m.drive;
        if (d && d.spawned !== false && m.moveCol.y1 > 0) {
          const cr = cRect();
          for (const b of bots) for (const c of [b.truck.bedCol, b.truck.cabCol]) if (c.y1 > 0 && P.rectsOverlap(cr, P.aabbToRect(c), o.gap ?? 1)) r.overlap++; // a meno di 1 m
          for (const car of cars) if (P.rectsOverlap(cr, P.aabbToRect(car.col))) r.carHit++;
          const leg = d.legs[d.i];
          if (leg && leg.path.len - d.s > 6 && !(d.mode === 'leave' && d.i === 0 && d.s < 3)) r.minV = Math.min(r.minV, d.v);
          const acc = (d.v - prevV) / dt;
          r.maxDec = Math.max(r.maxDec, -acc);
          const ns = acc > 0.5 ? 1 : acc < -0.5 ? -1 : st;
          if (ns !== st && st !== 0) r.switches++;
          st = ns;
          prevV = d.v;
        }
        for (const car of cars) for (const b of bots) for (const c of [b.truck.bedCol, b.truck.cabCol]) if (c.y1 > 0 && P.rectsOverlap(P.aabbToRect(c), P.aabbToRect(car.col))) r.carHit++;
        if (o.until && o.until(r)) { r.done = true; break; }
      }
      r.cost = r.costSum / Math.max(1, r.n);
      return r;
    };
    const allParked = () => bots.every((b) => b.truck.state === 'parked');
    const info = (r) => `sotto 1 m ${r.overlap}, v minima ${r.minV === Infinity ? '-' : r.minV.toFixed(2)}, frenata massima ${r.maxDec.toFixed(2)} m/s², cambi accelera/frena ${r.switches}, tempo ${r.t.toFixed(1)} s`;

    // riferimento: arrivo e partenza senza camion degli operai sulla strada (parcheggiati al loro posto)
    const base = {};
    for (const fps of FPS) {
      atHome(wb); atHome(other); away(); arrive();
      const ra = csim(1 / fps, 60, { until: () => !m.drive });
      leave();
      const rl = csim(1 / fps, 60, { until: () => !m.drive });
      hidden(wb); hidden(other); arrive();
      const ra0 = csim(1 / fps, 60, { until: () => !m.drive });
      leave();
      const rl0 = csim(1 / fps, 60, { until: () => !m.drive });
      base[fps] = ra;
      check(`C4. camion degli operai parcheggiati, ${fps} FPS: nessun falso ostacolo (stessi tempi senza operai)`, ra.done && rl.done && ra.overlap + rl.overlap === 0 && Math.abs(ra.t - ra0.t) < 1.5 / fps && Math.abs(rl.t - rl0.t) < 1.5 / fps,
        `arrivo ${ra.t.toFixed(2)} / ${ra0.t.toFixed(2)} s, partenza ${rl.t.toFixed(2)} / ${rl0.t.toFixed(2)} s`);
    }

    for (const fps of FPS) {
      const dt = 1 / fps;
      // C1. arrivo in rettilineo, camion dell'operaio a -20,1 m che attraversa la strada
      atHome(wb); cross(other, -16); away(); arrive();
      const r1 = csim(dt, 60, { until: () => !m.drive && allParked() });
      check(`C1. arrivo con un camion dell'operaio che attraversa, ${fps} FPS: rallenta e si ferma (o procede a passo d'uomo dietro di lui) senza toccarlo, riparte, parcheggia; tempo del contratto intatto`,
        r1.done && r1.overlap === 0 && r1.minV < 2 && r1.timeAtPark === limit && r1.maxDec <= 3.5 + 1e-6 && r1.switches <= base[fps].switches + 2,
        `${info(r1)}, tempo al parcheggio ${r1.timeAtPark}/${limit}, cambi senza operai ${base[fps].switches}, costo medio ${r1.cost.toFixed(4)} ms, massimo ${r1.costMax.toFixed(3)} ms`);
      // C2. cambio corsia e retromarcia, camion dell'operaio a +20,1 m che attraversa: gia' in strada quando il camion
      // del contratto parte (nel gioco un camion degli operai non compare mentre il camion del contratto viaggia)
      atHome(wb); atHome(other); away(); arrive();
      cross(wb, -16);
      const r2 = csim(dt, 60, { until: () => !m.drive && allParked() });
      check(`C2. cambio corsia e retromarcia con un camion dell'operaio che entra, ${fps} FPS`, r2.done && r2.overlap === 0 && r2.minV < 2 && r2.maxDec <= 3.5 + 1e-6, info(r2));
      // C3. partenza del camion del contratto con un camion dell'operaio che attraversa
      atHome(wb); atHome(other); away(); arrive();
      csim(dt, 60, { until: () => !m.drive });
      cross(wb, -16); leave();
      const r3 = csim(dt, 60, { until: () => !m.drive && allParked() });
      check(`C3. partenza con un camion dell'operaio che attraversa, ${fps} FPS`, r3.done && r3.overlap === 0 && r3.minV < 0.5 && r3.maxDec <= 3.5 + 1e-6, info(r3));
      // E1. la strada si libera mentre il camion del contratto frena: riparte senza fermarsi
      // (camion dell'operaio a +20,1 m, oltre lo spazio di frenata dal punto di comparsa del camion del contratto)
      atHome(wb); atHome(other); away(); arrive();
      csim(dt, 30, { until: () => m.drive && m.drive.spawned !== false });
      cross(wb, -16);
      csim(dt, 30, { until: () => m.drive && m.drive.i === 0 && m.drive.v < 9 && m.drive.v > 4 });
      const vBrake = m.drive ? m.drive.v : 0;
      atHome(wb); // il camion dell'operaio e' arrivato: zona libera
      let minAfter = Infinity;
      const r4 = csim(dt, 60, { each: () => { if (m.drive && m.drive.i === 0) minAfter = Math.min(minAfter, m.drive.v); }, until: () => !m.drive });
      check(`E1. la strada si libera mentre frena, ${fps} FPS: riparte senza fermarsi`, vBrake > 4 && minAfter > 2 && r4.done && r4.overlap === 0, `frenava a ${vBrake.toFixed(1)} m/s, minima dopo ${minAfter.toFixed(1)} m/s`);
    }

    // C10. partenza a fine contratto con il gioco in pausa (schermata del risultato: operai e auto fermi): il camion del
    // contratto aspetta davanti al camion dell'operaio fermo, senza attraversarlo; alla ripresa tutti ripartono
    {
      atHome(wb); atHome(other); away(); arrive();
      csim(DT, 60, { until: () => !m.drive });
      cross(wb, -12); leave();
      let near = 0;
      for (let t = 0; t < 30; t += DT) {
        m.driveTruck(DT, null, g.traffic.cars, [], B.truckZones()); // come game.js in pausa: solo il camion del contratto
        const Q = m.truckPose, mid = (TF + TR) / 2, cr = { x: Q.x + Math.cos(Q.yaw) * mid, z: Q.z - Math.sin(Q.yaw) * mid, hw: (TF - TR) / 2, hd: HW, yaw: Q.yaw };
        if ([wt.bedCol, wt.cabCol].some((c) => P.rectsOverlap(cr, P.aabbToRect(c), 1))) near++;
      }
      const waiting = !!m.drive && m.drive.v < 0.1;
      const rB = csim(DT, 60, { until: () => !m.drive && allParked() });
      check('C10. partenza col gioco in pausa: aspetta il camion dell\'operaio fermo, alla ripresa tutti ripartono', waiting && near === 0 && rB.done && rB.overlap === 0, `in attesa ${waiting}, sotto 1 m ${near}; poi ${info(rB)}`);
    }

    // C5. camion dell'operaio fermato dal giocatore: il camion del contratto aspetta; il giocatore si sposta: tutti ripartono
    {
      atHome(wb); atHome(other); away(); arrive();
      csim(DT, 60, { until: () => !m.drive });
      cross(wb, -12);
      const nb = B.truckBoxes(wb, -9).bed;
      f.place((nb.minX + nb.maxX) / 2, wt.dir.z < 0 ? nb.maxZ + 0.6 : nb.minZ - 0.6, 0); f.v = 0; // davanti al camion, nel piazzale
      leave();
      const rA = csim(DT, 8);
      const waitWorker = wt.state === 'arriving' && wt.offset < -8, waitContract = !!m.drive && m.drive.v < 0.5;
      away();
      const rB = csim(DT, 60, { until: () => !m.drive && allParked() });
      check('C5. camion dell\'operaio fermato dal giocatore: il contratto aspetta, poi tutti ripartono', waitWorker && waitContract && rB.done && rA.overlap + rB.overlap === 0, `operaio fermo ${waitWorker}, contratto in attesa ${waitContract}; poi ${info(rB)}`);
    }

    // C6. auto in coda dietro al camion del contratto e auto davanti al camion dell'operaio: nessun attraversamento, tutti ripartono
    {
      const c1 = allCars[0], c2 = allCars[1], keep = [c1, c2].map((c) => ({ x: c.x, z: c.z, dir: c.dir, v: c.v, vmax: c.vmax }));
      const put = (car, x, dir) => { Object.assign(car, { x, dir, z: dir > 0 ? -3.5 : 3.5, vmax: 9, v: 9, blockT: 0, hornT: 0 }); Object.assign(car.col, { minX: dir > 0 ? x + car.rear : x - car.front, maxX: dir > 0 ? x + car.front : x - car.rear, minZ: car.z - car.hw, maxZ: car.z + car.hw }); };
      g.traffic.cars = [c1, c2];
      atHome(wb); cross(other, -16); away(); arrive();
      put(c1, m.moveBoxAt(0).minX - 25, 1); // dietro al camion del contratto
      put(c2, zx + 60, -1); // corsia opposta, verso i camion degli operai
      const r6 = csim(DT, 60, { cars: [c1, c2], until: () => !m.drive && allParked() });
      const moving = csim(DT, 4, { cars: [c1, c2] });
      const ok = r6.done && r6.overlap === 0 && r6.carHit + moving.carHit === 0 && c1.v > 3 && c2.v > 3;
      check('C6. auto in coda e camion degli operai: nessun attraversamento, tutti ripartono', ok, `${info(r6)}, urti auto ${r6.carHit + moving.carHit}, auto ${c1.v.toFixed(1)} / ${c2.v.toFixed(1)} m/s`);
      [c1, c2].forEach((c, i) => Object.assign(c, keep[i]));
      g.traffic.cars = allCars;
    }

    // C8. collegamento nel ciclo di gioco vero (game.step): mentre il camion del contratto viaggia nessun camion degli operai compare
    {
      atHome(other); toRoad(wb); away(); arrive();
      // (un camion che stava gia' comparendo si annulla al controllo successivo, entro 0,1 s: mai solido)
      let maxFade = 0, solidSeen = false, blockedSeen = false, travelled = false;
      for (let t = 0; t < 4; t += DT) {
        g.step(DT);
        if (m.drive && m.moveCol.y1 > 0) { travelled = true; maxFade = Math.max(maxFade, wt.fade); solidSeen ||= wt.solid; blockedSeen ||= wt.spawnBlockedBy === 'camion contratto'; }
      }
      check('C8. nel ciclo di gioco vero: nessun camion degli operai compare mentre il camion del contratto viaggia', travelled && !solidSeen && maxFade < 0.2 && blockedSeen, `viaggiava ${travelled}, solido ${solidSeen}, visibilita' massima ${maxFade.toFixed(2)}, rinvio per il contratto ${blockedSeen}`);
      csim(DT, 60, { until: () => !m.drive && allParked() });
    }

    // C9. combinazioni: due camion degli operai in zone vicine, in punti diversi, arrivo e partenza; nessun blocco tra IA
    for (const fps of FPS) {
      let n = 0, fails = [];
      const offs = [-16, -10, -4, 0];
      for (const mode of fps === 60 ? ['arrivo', 'partenza'] : ['arrivo']) for (const oa of offs) for (const ob of offs) {
        atHome(wb); atHome(other); away();
        if (mode === 'partenza') { arrive(); csim(1 / fps, 60, { until: () => !m.drive }); }
        oa < 0 ? cross(wb, oa) : atHome(wb);
        ob < 0 ? cross(other, ob) : atHome(other);
        mode === 'arrivo' ? arrive() : leave();
        const r = csim(1 / fps, 60, { until: () => !m.drive && allParked() });
        n++;
        if (!r.done || r.overlap) fails.push(`${mode} ${oa}/${ob}: finito ${r.done}, ${info(r)}`);
      }
      check(`C9. combinazioni (${n}), ${fps} FPS: tutti arrivano, nessun attraversamento, nessun blocco`, fails.length === 0, fails.slice(0, 3).join(' | '));
    }
    atHome(wb); atHome(other); arrive(); // come all'inizio: camion del contratto in attesa di comparire
  }

  // W10. nessuna duplicazione o perdita di veicoli dopo tutte le prove
  check('W10. nessun camion duplicato o perso, ingombri invariati', truckNodes() === nodes0 && truckCols() === cols0 && B.bots.size === 2, `camion ${truckNodes()}/${nodes0}, ingombri ${truckCols()}/${cols0}`);

  // W11. dopo un contratto: operai ricreati, i camion parcheggiati sono solidi e bloccano il muletto
  app.exitMission();
  await start('d80');
  const proto = Object.getPrototypeOf(B);
  B.pick = proto.pick; B.work = proto.work;
  B.setWorkers([0, 1].map((i) => ({ id: `t${i}`, name: 'x', avatar: 0, level: 3, warehouse: 0, vehicle: 'd18' })));
  g.forklift.place(zx, 30, 0);
  await B.prewarm(g.forklift);
  for (let i = 0; i < 20; i++) { g.scene.onAfterRenderObservable.notifyObservers(g.scene); await new Promise((r) => setTimeout(r, 5)); }
  const tb = [...B.bots.values()].filter((b) => b.truck);
  // stato reale dopo la ricreazione (senza forzarlo): ingombro presente e coerente con solid
  const coherent = tb.every((b) => [b.truck.bedCol, b.truck.cabCol].every((c) => g.env.colliders.includes(c) && (c.y1 > 0) === b.truck.solid));
  tb.forEach(atHome);
  const f2 = g.forklift, bed = tb[0]?.truck.bedCol;
  const blocks = bed && g.env.colliders.includes(bed) && f2.collides(g.env, (bed.minX + bed.maxX) / 2, (bed.minZ + bed.maxZ) / 2, 0);
  check('W11. dopo un contratto: operai ricreati, camion parcheggiati solidi', tb.length === 2 && coherent && blocks, `camion ${tb.length}, ingombri coerenti ${coherent}, al suo posto blocca il muletto ${!!blocks}`);
  app.exitMission();
}
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
    if (process.env.TEST_WEAK) await page.evaluate(() => { window.__weak = true; }); // solo per dimostrare che le prove sanno fallire
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
