import { loadCloudSave, writeCloudSave } from './cloud.js';
import { detectLang } from './i18n.js';
import { VEHICLES, WAREHOUSES, xpForLevel } from './data.js';

const KEY = 'forklift-tycoon-save-v1';

const defaults = () => ({
  version: 1,
  name: '',
  coins: 500,
  xp: 0,
  level: 1,
  contractLevel: 1,
  stats: { contracts: 0, pallets: 0, earned: 0 },
  vehicles: ['e12'],
  activeVehicle: 'e12',
  warehouses: [0],
  settings: { lang: detectLang(), view: 'third', sensitivity: 1, steering: 'arrows', invertGyro: false, quality: 'high' },
  savedAt: 0,
});

function merge(base, data) {
  return { ...base, ...data, stats: { ...base.stats, ...data?.stats }, settings: { ...base.settings, ...data?.settings } };
}

export let save = defaults();

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
  if (save.coins < amount) return false;
  save.coins -= amount;
  persist();
  return true;
}

export function buyVehicle(id) {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v || save.vehicles.includes(id) || !spend(v.price)) return false;
  save.vehicles.push(id);
  save.activeVehicle = id;
  persist();
  return true;
}

export function buyWarehouse(id) {
  const w = WAREHOUSES[id];
  if (!w || save.warehouses.includes(id) || !spend(w.price)) return false;
  save.warehouses.push(id);
  save.warehouses.sort((a, b) => a - b);
  persist();
  return true;
}

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
