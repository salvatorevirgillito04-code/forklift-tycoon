import { loadCloudSave, writeCloudSave } from './cloud.js';
import { detectLang } from './i18n.js';
import { VEHICLES, WAREHOUSES, xpForLevel, unitPrice, workerSlots, hireCost, trainCost, workerIncome, WORKER_MAX_LEVEL } from './data.js';

const KEY = 'forklift-tycoon-save-v1';

const defaults = () => ({
  version: 1,
  name: '',
  coins: 500,
  xp: 0,
  level: 1,
  contractLevel: 1,
  contractSeed: 1, // contratti proposti: cambiano dopo ogni contratto giocato
  stats: { contracts: 0, pallets: 0, earned: 0, workerEarned: 0 },
  vehicles: { e12: 1 }, // id modello -> numero di muletti posseduti
  activeVehicle: 'e12',
  warehouses: [0],
  workers: [], // { id, name, avatar, level, warehouse, vehicle }
  candidateSeed: 1,
  workersPaidAt: 0, // ultimo accredito dei guadagni degli operai
  workerCarry: 0, // frazione di moneta non ancora accreditata
  // premi degli eventi
  trophies: [], // { event, tier, kind, theme }
  titles: [], // { tier, kind, theme }
  title: null, // indice del titolo mostrato in classifica
  paints: [], // vernici vinte (chiavi di PAINTS)
  paint: null, // vernice montata sul proprio muletto
  payBonus: null, // { pct, until } bonus paga temporaneo
  marathonPending: null, // { id, points } punti maratona non ancora inviati
  settings: { lang: detectLang(), view: 'third', sensitivity: 1, steering: 'arrows', invertGyro: false, quality: 'high', mirrors: true, sfxVolume: 0.8, musicVolume: 0.5 },
  savedAt: 0,
});

function merge(base, data) {
  const out = { ...base, ...data, stats: { ...base.stats, ...data?.stats }, settings: { ...base.settings, ...data?.settings } };
  // Vecchi salvataggi: lista di id (un esemplare per modello) -> conteggi
  if (Array.isArray(out.vehicles)) out.vehicles = Object.fromEntries(out.vehicles.map((id) => [id, 1]));
  return out;
}

export let save = defaults();

// Modalita' sviluppatore (non salvata: arriva dal login): monete infinite e menu segreto.
export const dev = { on: false };

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) save = merge(defaults(), JSON.parse(raw));
  } catch {
    save = defaults();
  }
  return save;
}

// Vince il salvataggio piu' recente tra locale e cloud.
export async function syncFromCloud() {
  const cloud = await loadCloudSave();
  if (cloud?.data && (cloud.data.savedAt || 0) > (save.savedAt || 0)) {
    const settings = save.settings;
    save = merge(defaults(), cloud.data);
    save.settings = settings;
    writeLocal();
  } else {
    await writeCloudSave(save);
  }
}

function writeLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch { /* storage pieno o bloccato */ }
}

let cloudTimer = null;
export function persist() {
  save.savedAt = Date.now();
  writeLocal();
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => writeCloudSave(save), 1500);
}

export function resetSave() {
  const settings = save.settings;
  save = defaults();
  save.settings = settings;
  persist();
}

export function spend(amount) {
  if (dev.on) return true;
  if (save.coins < amount) return false;
  save.coins -= amount;
  persist();
  return true;
}

export const ownedCount = (id) => save.vehicles[id] || 0;
export const assignedCount = (id) => save.workers.filter((w) => w.vehicle === id).length;
// Muletti liberi di un modello: quelli non usati dagli operai (uno resta sempre al giocatore se e' il suo mezzo).
export const freeUnits = (id, forWorker = false) =>
  ownedCount(id) - assignedCount(id) - (forWorker && save.activeVehicle === id ? 1 : 0);

// Il primo esemplare di un modello diventa il mezzo del giocatore; gli altri vanno agli operai.
export function buyVehicle(id) {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v || !spend(unitPrice(v, ownedCount(id)))) return false;
  const first = !ownedCount(id);
  save.vehicles[id] = ownedCount(id) + 1;
  if (first) save.activeVehicle = id;
  persist();
  return true;
}

export function equipVehicle(id) {
  if (freeUnits(id) < 1) return false;
  save.activeVehicle = id;
  persist();
  return true;
}

// ---------- OPERAI ----------
export const freeSlots = (whId) => workerSlots(whId) - save.workers.filter((w) => w.warehouse === whId).length;

export const canAfford = (amount) => dev.on || save.coins >= amount;

export function hireWorker(candidate, warehouse, vehicle) {
  if (!save.warehouses.includes(warehouse) || freeSlots(warehouse) < 1 || freeUnits(vehicle, true) < 1) return false;
  accrueWorkers();
  if (!spend(hireCost(save.workers.length, candidate.level))) return false;
  save.workers.push({ id: `w${Date.now().toString(36)}`, name: candidate.name, avatar: candidate.avatar, level: candidate.level, warehouse, vehicle });
  save.candidateSeed += 1;
  persist();
  return true;
}

export function trainWorker(id) {
  const w = save.workers.find((x) => x.id === id);
  if (!w || w.level >= WORKER_MAX_LEVEL) return false;
  accrueWorkers();
  if (!spend(trainCost(w.level))) return false;
  w.level += 1;
  persist();
  return true;
}

export function setWorkerVehicle(id, vehicle) {
  const w = save.workers.find((x) => x.id === id);
  if (!w || (w.vehicle !== vehicle && freeUnits(vehicle, true) < 1)) return false;
  accrueWorkers();
  w.vehicle = vehicle;
  persist();
  return true;
}

export function fireWorker(id) {
  accrueWorkers();
  save.workers = save.workers.filter((w) => w.id !== id);
  persist();
}

export const workersNetPerHour = () => save.workers.reduce((sum, w) => sum + workerIncome(w).net, 0);

// Accredita i guadagni maturati dall'ultimo accredito (anche a gioco chiuso, senza limite).
// Ritorna le monete accreditate.
export function accrueWorkers(now = Date.now()) {
  const last = save.workersPaidAt || now;
  save.workersPaidAt = now;
  if (!save.workers.length || now <= last) return 0;
  const total = save.workerCarry + (workersNetPerHour() * (now - last)) / 3600000;
  const coins = Math.floor(total);
  save.workerCarry = total - coins;
  if (coins > 0) {
    save.coins += coins;
    save.stats.workerEarned += coins;
  }
  persist();
  return coins;
}

export function buyWarehouse(id) {
  const w = WAREHOUSES[id];
  if (!w || save.warehouses.includes(id) || !spend(w.price)) return false;
  save.warehouses.push(id);
  save.warehouses.sort((a, b) => a - b);
  persist();
  return true;
}

// Premio di un evento finito (vedi events.js rewardFor): monete, trofeo, titolo, vernice, bonus paga
export function applyEventReward(r) {
  save.coins += r.coins;
  save.stats.earned += r.coins;
  if (r.trophy) save.trophies.push(r.trophy);
  if (r.title) {
    save.titles.push(r.title);
    save.title = save.titles.length - 1;
  }
  if (r.paint && !save.paints.includes(r.paint)) save.paints.push(r.paint);
  if (r.paint) save.paint = r.paint;
  if (r.payBonus) save.payBonus = { pct: r.payBonus, until: Date.now() + 7 * 86400000 };
  persist();
}

export const activePayBonus = () => (save.payBonus && save.payBonus.until > Date.now() ? save.payBonus.pct : 0);

// Ritorna il nuovo livello se il giocatore e' salito di livello.
export function addRewards({ coins, xp, pallets, contractLevel }) {
  save.coins += coins;
  save.xp += xp;
  save.stats.earned += coins;
  save.stats.pallets += pallets;
  save.stats.contracts += 1;
  if (contractLevel >= save.contractLevel) save.contractLevel = contractLevel + 1;
  let levelUp = null;
  while (save.xp >= xpForLevel(save.level)) {
    save.xp -= xpForLevel(save.level);
    save.level += 1;
    levelUp = save.level;
  }
  persist();
  return levelUp;
}
