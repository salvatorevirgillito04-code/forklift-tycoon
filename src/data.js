// Mezzi del garage, dal piu' debole al piu' potente.
// speed in m/s, capacity in kg, lift = altezza massima forche in m.
export const VEHICLES = [
  { id: 'e12', name: 'Compact E12', price: 0, capacity: 1200, lift: 3.0, speed: 4.0, accel: 2.2, color: '#f2b705' },
  { id: 'd18', name: 'Worker D18', price: 2500, capacity: 1800, lift: 3.8, speed: 4.8, accel: 2.6, color: '#e8701a' },
  { id: 'd25', name: 'Heavy D25', price: 8000, capacity: 2500, lift: 4.5, speed: 5.5, accel: 3.0, color: '#c8312b' },
  { id: 'd35', name: 'Pro D35', price: 20000, capacity: 3500, lift: 5.2, speed: 6.0, accel: 3.3, color: '#2d6cdf' },
  { id: 'd50', name: 'Titan D50', price: 50000, capacity: 5000, lift: 5.8, speed: 6.6, accel: 3.6, color: '#2f9e44' },
  { id: 'd80', name: 'Mega D80', price: 120000, capacity: 8000, lift: 6.5, speed: 7.2, accel: 4.0, color: '#2b2b2b' },
];

export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];

// Quartiere industriale: una strada principale lungo X (z=0), 5 lotti a nord e 5 a sud.
const PLOT_X = [-88, -44, 0, 44, 88];
const PRICES = [0, 3000, 8000, 18000, 35000, 60000, 100000, 160000, 250000, 400000];

export const WAREHOUSES = PRICES.map((price, i) => {
  const north = i % 2 === 0;
  const cx = PLOT_X[Math.floor(i / 2)];
  return {
    id: i,
    price,
    rewardMult: +(1 + i * 0.25).toFixed(2),
    cx,
    side: north ? 1 : -1, // 1 = lotto a nord (z positiva), porta rivolta a sud
  };
});

export const WORLD = { minX: -116, maxX: 116, minZ: -66, maxZ: 66, roadHalf: 7 };

// Generatore pseudo-casuale deterministico: lo stesso livello genera sempre gli stessi contratti.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFF = {
  easy: { mult: 1, pallets: 2, perLvl: 0.2, secPerPallet: 110, minSec: 70, maxTime: 300, weight: 0.45, fragile: false },
  normal: { mult: 1.6, pallets: 3, perLvl: 0.28, secPerPallet: 95, minSec: 60, maxTime: 360, weight: 0.65, fragile: false },
  hard: { mult: 2.5, pallets: 4, perLvl: 0.36, secPerPallet: 85, minSec: 50, maxTime: 420, weight: 0.85, fragile: true },
};

export const DIFFICULTIES = Object.keys(DIFF);

// Livelli infiniti: paga, numero di pallet e peso crescono con il livello.
export function makeContract(level, difficulty, warehouseId) {
  const d = DIFF[difficulty];
  const r = rng(level * 7919 + DIFFICULTIES.indexOf(difficulty) * 104729 + warehouseId * 31);
  const wh = WAREHOUSES[warehouseId];
  const pallets = Math.min(12, Math.floor(d.pallets + (level - 1) * d.perLvl));
  // Il peso cresce con il livello: ai livelli alti servono muletti piu' potenti.
  const baseWeight = 350 + level * 55;
  const weight = Math.round((baseWeight * (0.8 + d.weight * 0.6 + r() * 0.2)) / 10) * 10;
  // Tempo: piu' secondi per pallet, fino a 5/6/7 minuti (facile/normale/difficile)
  const perPallet = Math.max(d.minSec, d.secPerPallet - level * 0.5);
  const timeLimit = Math.round(Math.min(d.maxTime, pallets * perPallet + 60) / 5) * 5;
  const reward = Math.round(90 * Math.pow(1.13, level - 1) * d.mult * wh.rewardMult * (0.95 + r() * 0.1));
  const xp = Math.round((40 + level * 12) * d.mult);
  return {
    level,
    difficulty,
    warehouseId,
    type: r() < 0.5 ? 'load' : 'unload',
    pallets,
    weight,
    timeLimit,
    reward,
    xp,
    fragile: d.fragile,
    seed: Math.floor(r() * 1e9),
  };
}

export const xpForLevel = (lvl) => Math.round(120 * Math.pow(lvl, 1.45));
