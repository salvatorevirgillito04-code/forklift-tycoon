#!/usr/bin/env node
// Strumento di SVILUPPO per Tripo 3D (non fa parte del gioco: non viene incluso nel sito ne' nell'APK).
//
// La chiave si legge SOLO da qui, mai dal codice del gioco:
//   1. variabile d'ambiente TRIPO_API_KEY, oppure
//   2. file ~/.config/tripo/key (fuori dal progetto, mai in Git)
// La chiave non viene mai stampata ne' scritta su file.
//
// Comandi (nessuno consuma crediti):
//   node tools/tripo/tripo.mjs balance            saldo crediti (disponibili e bloccati)
//   node tools/tripo/tripo.mjs usage [n]          ultimi n consumi (crediti per task)
//   node tools/tripo/tripo.mjs task <task_id>     stato di un task gia' avviato
//   node tools/tripo/tripo.mjs estimate <voce...> stima del costo prima di chiedere l'approvazione
//
// Le generazioni (che consumano crediti) NON sono implementate: si aggiungono solo dopo aver verificato
// la pagina ufficiale dell'endpoint e con l'approvazione esplicita del proprietario del progetto.
//
// Endpoint verificati sulla documentazione ufficiale (developers.tripo3d.com, ottobre 2026):
//   base https://openapi.tripo3d.com/v3, intestazione "Authorization: Bearer <chiave>"
//   GET /account/balance -> { balance, frozen }     GET /account/usage     GET /tasks/{task_id}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://openapi.tripo3d.com/v3';

// Listino ufficiale (developers.tripo3d.com/en/pricing, ottobre 2026), in crediti.
// ATTENZIONE: i consumi reali di questo account sono stati piu' alti del listino (testo->3D 30-40, retarget 20):
// la stima usa il valore piu' alto tra listino e storico. Dopo una prova si controlla il costo vero con "usage".
const PRICES = {
  'text-to-3d': { list: 10, note: 'senza texture' },
  'text-to-3d+texture': { list: 20, seen: 40, note: 'texture standard' },
  'image-to-3d': { list: 20, note: 'senza texture' },
  'image-to-3d+texture': { list: 30, note: 'texture standard' },
  'multiview-to-3d+texture': { list: 30 },
  '+hd-texture': { list: 10 }, '+smart-low-poly': { list: 10 }, '+quad': { list: 5 }, '+hd-geometry': { list: 20 }, '+parts': { list: 20 },
  'texture': { list: 10 }, 'texture-hd': { list: 20 },
  'retopology-basic': { list: 10 }, 'retopology-smart': { list: 30 }, 'retopology-triangle': { list: 35 },
  'smart-uv': { list: 20 }, 'convert': { list: 5 }, 'convert-advanced': { list: 10 },
  'rig-check': { list: 0 }, 'rig': { list: 25, seen: 25 }, 'retarget': { list: 10, seen: 20, note: 'per animazione' },
};

function apiKey() {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY.trim();
  const f = path.join(os.homedir(), '.config', 'tripo', 'key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  console.error('Chiave non trovata: imposta TRIPO_API_KEY oppure crea ~/.config/tripo/key (fuori dal progetto).');
  process.exit(2);
}

async function get(p) {
  const res = await fetch(BASE + p, { headers: { Authorization: `Bearer ${apiKey()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // niente intestazioni nell'errore: non devono finire nei log
    console.error(`Errore ${res.status}: ${body?.message || body?.error || 'richiesta non riuscita'}`);
    process.exit(1);
  }
  return body?.data ?? body;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'balance') {
  const d = await get('/account/balance');
  console.log(`Crediti disponibili: ${d.balance} · bloccati (task in corso): ${d.frozen}`);
} else if (cmd === 'usage') {
  const d = await get(`/account/usage?limit=${Math.min(100, Math.max(1, +args[0] || 20))}`);
  for (const it of d.items || []) console.log(`${it.created_at}  ${String(it.type).padEnd(22)} ${String(it.credits_consumed).padStart(4)} crediti  ${it.status}  ${it.task_id}`);
} else if (cmd === 'task') {
  if (!/^[0-9a-f-]{36}$/i.test(args[0] || '')) { console.error('Uso: task <task_id>'); process.exit(1); }
  console.log(JSON.stringify(await get(`/tasks/${args[0]}`), null, 2));
} else if (cmd === 'estimate') {
  let low = 0, high = 0;
  for (const k of args) {
    const p = PRICES[k];
    if (!p) { console.error(`Voce sconosciuta: ${k}. Voci: ${Object.keys(PRICES).join(', ')}`); process.exit(1); }
    low += p.list; high += Math.max(p.list, p.seen || 0);
    console.log(`  ${k.padEnd(24)} listino ${p.list}${p.seen ? ` · gia' pagati ${p.seen}` : ''}${p.note ? ` (${p.note})` : ''}`);
  }
  console.log(`Stima: ${low}-${high} crediti. Prima di qualsiasi generazione serve l'approvazione esplicita.`);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).slice(0, 14).map((l) => l.slice(3)).join('\n'));
}
