// Eventi settimanali con classifica (lunedi' 00:00 - domenica 23:59, ora italiana).
// Il tipo della settimana gira: sfida a tempo -> maratona -> precisione (uguale nel database: event_kind).
// Nelle settimane di Halloween, Natale e Ferragosto l'evento ha un tema (orario, meteo e premi speciali).
import { supabase, isLinked } from './cloud.js';

export const EVENT_KINDS = ['time', 'marathon', 'precision'];
const EPOCH = Date.UTC(2026, 0, 5); // lunedi' 5 gennaio 2026: settimana 0 della rotazione
const DAY = 86400000;

// Data (anno, mese, giorno, giorno della settimana, ms dalla mezzanotte) nell'ora di Roma
function romeParts(now = Date.now()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const date = Date.UTC(+p.year, +p.month - 1, +p.day);
  const dow = (new Date(date).getUTCDay() + 6) % 7; // 0 = lunedi'
  return { date, dow, msInDay: ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 };
}

// Id ISO della settimana, come nel database: '2026-W44'
function isoWeekId(date) {
  const thursday = date + (3 - ((new Date(date).getUTCDay() + 6) % 7)) * DAY; // il giovedi' decide l'anno
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// lunedi' (data UTC a mezzanotte) di una settimana
function mondayOf(id) {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY;
}

export function currentEventId(now = Date.now()) {
  return isoWeekId(romeParts(now).date);
}

// millisecondi alla fine dell'evento in corso (domenica 23:59:59 ora italiana)
export function eventTimeLeft(now = Date.now()) {
  const { dow, msInDay } = romeParts(now);
  return (7 - dow) * DAY - msInDay;
}

const weekIndex = (id) => Math.round((mondayOf(id) - EPOCH) / (7 * DAY));

// Tema stagionale: la settimana contiene una data speciale
function themeOf(id) {
  const mon = mondayOf(id);
  const has = (m, d) => {
    for (const y of [new Date(mon).getUTCFullYear(), new Date(mon).getUTCFullYear() + 1]) {
      const t = Date.UTC(y, m, d);
      if (t >= mon && t < mon + 7 * DAY) return true;
    }
    return false;
  };
  if (has(9, 31)) return 'halloween';
  if (has(11, 20) || has(11, 25) || has(0, 1)) return 'christmas';
  if (has(7, 15)) return 'summer';
  return null;
}

// Orario e meteo del contratto dell'evento: a tema nelle settimane speciali, altrimenti a turno
const THEME_SKY = {
  halloween: { time: 'night', weather: 'fog' },
  christmas: { time: 'sunset', weather: 'snow' },
  summer: { time: 'day', weather: 'clear' },
};
const SKIES = [
  { time: 'day', weather: 'clear' }, { time: 'sunset', weather: 'rain' }, { time: 'night', weather: 'clear' },
  { time: 'dawn', weather: 'fog' }, { time: 'night', weather: 'snow' }, { time: 'day', weather: 'rain' },
];

// Muletto uguale per tutti nelle gare (vince la bravura, non il mezzo)
export const EVENT_VEHICLE = 'd18';

// Premi: monete fisse sempre, piu' un extra che cambia da evento a evento (trofeo e titolo sempre sul podio)
export const TIER_COINS = { gold: 100000, silver: 50000, bronze: 25000, top10: 10000, top50: 3000, participant: 1000 };
export const EXTRAS = ['title', 'paint', 'payBonus'];
const PAY_BONUS = { gold: 30, silver: 20, bronze: 10 };
export const PAINTS = {
  gold: '#d4a017', silver: '#c0c6cc', bronze: '#b0683a',
  halloween: '#ff7a00', christmas: '#c8102e', summer: '#19b5c9',
};

export function eventDef(id = currentEventId()) {
  const n = weekIndex(id);
  const kind = EVENT_KINDS[((n % 3) + 3) % 3];
  const theme = themeOf(id);
  const sky = theme ? THEME_SKY[theme] : SKIES[((n % SKIES.length) + SKIES.length) % SKIES.length];
  const extra = EXTRAS[((n % 3) + 3) % 3];
  const def = { id, kind, theme, extra, ...sky };
  if (kind === 'time') {
    // tutti nel primo magazzino (lo hanno tutti), stesso carico; il tipo cambia ogni settimana
    const types = ['load', 'unload', 'rack2zone', 'zone2rack'];
    def.contract = { type: types[n % types.length], pallets: 5, weight: 600 };
  } else if (kind === 'precision') {
    // scaffali alti, carico pesante e meteo difficile
    const types = ['zone2rack', 'truck2rack'];
    def.contract = { type: types[n % types.length], pallets: 4, weight: 1100 };
    if (!theme) Object.assign(def, n % 2 ? { time: 'night', weather: 'snow' } : { time: 'night', weather: 'rain' });
  }
  return def;
}

// Contratto da giocare per l'evento (sfida a tempo e precisione)
export function eventContract(def) {
  const c = def.contract;
  return {
    type: c.type, pallets: c.pallets, weight: c.weight, level: 5, difficulty: 'normal', warehouseId: 0,
    timeLimit: def.kind === 'time' ? 600 : 720, reward: 0, xp: 60, fragile: def.kind === 'precision',
    time: def.time, weather: def.weather, bonus: 1, seed: weekIndex(def.id) * 7 + 3,
    vehicle: EVENT_VEHICLE, event: { id: def.id, kind: def.kind },
  };
}

// Punteggio (piu' alto = meglio). Sfida a tempo: 600.000 meno i millisecondi (+10 s per pallet caduto, +5 s per urto).
// Precisione: 10.000 meno 10 punti al secondo, 1.500 per pallet caduto, 800 per urto.
export function eventScore(kind, { seconds, drops, bumps }) {
  if (kind === 'time') return Math.max(1, Math.round(600000 - (seconds + drops * 10 + bumps * 5) * 1000));
  return Math.max(1, Math.round(10000 - seconds * 10 - drops * 1500 - bumps * 800));
}

// Maratona: punti per ogni contratto completato durante la settimana (piu' difficile = di piu')
export function marathonPoints(contract, stars) {
  const base = { easy: 10, normal: 20, hard: 35 }[contract.difficulty] || 10;
  return Math.min(600, Math.round(base * (contract.bonus || 1) + (stars === 3 ? 5 : 0)));
}

// Come si mostra un punteggio: tempo (m:ss.d) per la sfida, punti per le altre
export function formatScore(kind, score) {
  if (kind !== 'time') return Math.round(score).toLocaleString();
  const ms = 600000 - score;
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Nomi in classifica: niente parolacce (controllo semplice)
const BAD = ['cazz', 'stronz', 'vaffan', 'merd', 'puttan', 'troia', 'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'puta', 'mierd', 'cabron', 'coño', 'pene', 'figa'];
export const nameAllowed = (name) => {
  const n = (name || '').trim().toLowerCase().replace(/[^a-zà-ú0-9]/g, '');
  return n.length >= 2 && !BAD.some((w) => n.includes(w));
};

// ---- server ----
export async function submitScore(id, score, name, title) {
  if (!isLinked()) return { error: 'not_member' };
  const { data, error } = await supabase.rpc('submit_event_score', { p_event: id, p_score: score, p_name: name, p_title: title || null });
  if (error) return { error: (error.message || '').match(/not_member|event_closed|bad_name|bad_score|too_fast/)?.[0] || 'network' };
  return data;
}

export async function loadLeaderboard(id, limit = 50) {
  const { data, error } = await supabase.rpc('event_leaderboard', { p_event: id, p_limit: limit });
  if (error) return null;
  return data;
}

// Premi degli eventi finiti non ancora ritirati: [{ id, rank, total, tier }]
export async function claimPending() {
  if (!isLinked()) return [];
  const { data: ids, error } = await supabase.rpc('pending_event_rewards');
  if (error || !ids?.length) return [];
  const out = [];
  for (const id of ids) {
    const { data } = await supabase.rpc('claim_event_reward', { p_event: id });
    if (data?.played) out.push({ id, ...data });
  }
  return out;
}

// Cosa si vince: monete e, sul podio, trofeo + l'extra dell'evento
export function rewardFor(id, tier) {
  const def = eventDef(id);
  const r = { coins: TIER_COINS[tier] || 0, tier };
  if (['gold', 'silver', 'bronze'].includes(tier)) {
    r.trophy = { event: id, tier, kind: def.kind, theme: def.theme };
    if (def.extra === 'title') r.title = { tier, kind: def.kind, theme: def.theme };
    if (def.extra === 'paint') r.paint = def.theme && tier === 'gold' ? def.theme : tier;
    if (def.extra === 'payBonus') r.payBonus = PAY_BONUS[tier];
  }
  return r;
}
