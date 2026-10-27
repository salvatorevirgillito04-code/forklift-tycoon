// Mezzi del garage, dal piu' debole al piu' potente.
// speed in m/s, capacity in kg, lift = altezza massima forche in m.
// Ispirati a modelli reali (senza marchi): portata, alzata e velocita' restano quelle di gioco.
// scale = taglia del mezzo (l'ultimo e' ~1,5 volte il primo); style = dettagli del modello 3D.
export const VEHICLES = [
  { id: 'e12', name: 'Compact 18', price: 0, capacity: 1200, lift: 3.0, speed: 4.0, accel: 2.2, color: '#e2561c', scale: 1.0,
    photo: 'forklift-1.jpg', style: { trim: '#3a3d42', rim: '#2b2b2b', lpg: true },
    model: 'fk-e12.glb', eye: [0, 1.95, -0.95] }, // carrozzeria Tripo 3D dalla foto; eye = occhi del guidatore (taglia 1)
  { id: 'd18', name: 'Worker 35D', price: 2500, capacity: 1800, lift: 3.8, speed: 4.8, accel: 2.6, color: '#d71920', scale: 1.1,
    photo: 'forklift-2.jpg', style: { trim: '#3b3e43', rim: '#c9cdd2', exhaust: true },
    model: 'fk-d18.glb', eye: [0, 1.68, -0.88] },
  { id: 'd25', name: 'Heavy 60D', price: 8000, capacity: 2500, lift: 4.5, speed: 5.5, accel: 3.0, color: '#d8161b', scale: 1.2,
    photo: 'forklift-3.jpg', style: { trim: '#1e1f22', rim: '#1e1f22', exhaust: true, roundRear: true, dualFront: true, workLights: true },
    model: 'fk-d25.glb', eye: [0, 1.7, -0.55] },
  { id: 'd35', name: 'Titan XF100', price: 20000, capacity: 3500, lift: 5.2, speed: 6.0, accel: 3.3, color: '#e0321d', scale: 1.3,
    photo: 'forklift-4.jpg', style: { trim: '#141414', rim: '#e0321d', fork: '#e0321d' },
    model: 'fk-d35.glb', eye: [0, 1.45, -0.5] },
  { id: 'd50', name: 'Mega H120', price: 50000, capacity: 5000, lift: 5.8, speed: 6.6, accel: 3.6, color: '#d9202a', scale: 1.4,
    photo: 'forklift-5.jpg', style: { trim: '#151515', rim: '#d9202a', exhaust: true, roundRear: true, cab: 'closed' },
    model: 'fk-d50.glb', eye: [0, 1.78, -0.62] },
  { id: 'd80', name: 'Colossus 160', price: 120000, capacity: 8000, lift: 6.5, speed: 7.2, accel: 4.0, color: '#d9b23a', scale: 1.5,
    photo: 'forklift-6.jpg', style: { trim: '#1a1a1a', rim: '#e8e2c8', exhaust: true, cab: 'closed' },
    model: 'fk-d80.glb', eye: [0, 2.1, -0.8] },
];

// Il mezzo iniziale e' gratis solo la prima volta: le copie per gli operai si pagano.
export const unitPrice = (v, owned) => (owned ? v.price || 1000 : v.price);

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

// ---------- OPERAI ----------
// Posti per magazzino: 1 nei magazzini 1-3, 2 nei 4-6, 3 nei 7-9, 4 nel 10 (22 in totale).
export const workerSlots = (whId) => (whId >= 9 ? 4 : Math.floor(whId / 3) + 1);
export const WORKER_MAX_LEVEL = 10;

// Costo di assunzione: 500, poi +40% per ogni operaio gia' in squadra; i candidati esperti costano di piu'.
export const hireCost = (teamSize, level = 1) => Math.round((500 * Math.pow(1.4, teamSize) * (1 + 0.3 * (level - 1))) / 10) * 10;
export const trainCost = (level) => Math.round((300 * Math.pow(1.6, level - 1)) / 10) * 10;

// Guadagno lordo e stipendio all'ora.
export function workerIncome(worker) {
  const v = vehicleById(worker.vehicle);
  const wh = WAREHOUSES[worker.warehouse];
  const gross = (v.capacity / 10) * wh.rewardMult * (1 + 0.15 * (worker.level - 1));
  const salary = 40 + 15 * worker.level;
  return { gross: Math.round(gross), salary, net: Math.round(gross - salary) };
}

const FIRST = ['Marco', 'Giulia', 'Luca', 'Sara', 'Javier', 'Lucía', 'Tom', 'Emma', 'Paolo', 'Elena', 'Diego', 'Carmen',
  'Jack', 'Olivia', 'Andrea', 'Chiara', 'Pablo', 'Sofía', 'Sam', 'Grace', 'Davide', 'Marta', 'Raúl', 'Nina'];
const LAST = ['Rossi', 'Bianchi', 'García', 'López', 'Smith', 'Brown', 'Esposito', 'Romano', 'Martín', 'Ruiz',
  'Taylor', 'Wilson', 'Greco', 'Conti', 'Moreno', 'Navarro', 'Clark', 'Hall', 'Ferri', 'Costa'];
const SKIN = ['#f3d2b3', '#e8b892', '#c98e66', '#a86b45', '#7a4a2e', '#5b3820'];
const HAIR = ['#2b1d14', '#5a3a22', '#a5652c', '#d8b26a', '#1a1a1a', '#8c8c8c'];
const HELMET = ['#f2c200', '#ff7a1a', '#ffffff', '#2f80ed', '#35b06a', '#e04848'];

// Tre candidati per ogni "giro" di colloqui: stesso seed = stessi candidati.
export function makeCandidates(seed, count = 3) {
  const r = rng(seed * 2654435761);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return Array.from({ length: count }, (_, i) => {
    const level = 1 + Math.floor(r() * r() * 4); // spesso livello 1, a volte fino a 4
    return {
      id: `${seed}-${i}`,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      level,
      avatar: { skin: pick(SKIN), hair: pick(HAIR), helmet: pick(HELMET), beard: r() < 0.3, glasses: r() < 0.25 },
    };
  });
}
