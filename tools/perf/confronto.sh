#!/usr/bin/env bash
# Avvia una versione del gioco da confrontare (es. main o un altro ramo) su una porta, in una cartella separata.
# Uso:   tools/perf/confronto.sh <ramo-o-commit> <porta>        es. tools/perf/confronto.sh main 5181
# Ferma: tools/perf/confronto.sh --stop <porta>   (rimuove anche la cartella)
# Ogni versione ha la sua cache di Vite: con la cache condivisa i server si rompevano a vicenda (errore 504).
# node_modules e' quello del ramo attuale: per rami molto vecchi con dipendenze diverse la versione puo' non partire.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
BASE="${TMPDIR:-/tmp}/forklift-confronto"
porta() { [[ "$1" =~ ^[0-9]{2,5}$ ]] || { echo "porta non valida: $1" >&2; exit 1; }; }
if [ "${1:-}" = "--stop" ]; then
  PORT="${2:-}"; porta "$PORT"; DIR="$BASE/$PORT"
  for pid in $(ps -eo pid,args | grep -E "[v]ite.*--port $PORT( |$)" | awk '{print $1}'); do kill "$pid" 2>/dev/null || true; done
  [ -d "$DIR" ] && git -C "$ROOT" worktree remove --force "$DIR"
  echo "fermato $PORT"; exit 0
fi
[ $# -ge 2 ] || { echo "uso: $0 <ramo-o-commit> <porta> | --stop <porta>" >&2; exit 1; }
REF="$1"; PORT="$2"; porta "$PORT"; DIR="$BASE/$PORT"
mkdir -p "$BASE"
[ -d "$DIR" ] && git -C "$ROOT" worktree remove --force "$DIR"
git -C "$ROOT" worktree add --detach "$DIR" "$REF" >/dev/null
ln -s "$ROOT/node_modules" "$DIR/node_modules"
cat > "$DIR/vite.confronto.config.js" <<'CFG'
import base from './vite.config.js';
const cfg = typeof base === 'function' ? base({ command: 'serve', mode: 'development' }) : base;
export default { ...cfg, cacheDir: '.vite-confronto-cache' };
CFG
# staccato dal terminale (setsid, ingresso e uscite su file): altrimenti chi legge l'uscita di questo script resta in attesa
setsid -f bash -c 'cd "$1" && exec npx vite --config vite.confronto.config.js --port "$2" --strictPort' _ "$DIR" "$PORT" < /dev/null > "$DIR/vite.log" 2>&1
for i in $(seq 1 30); do curl -s -m 5 -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
curl -s -m 10 -o /dev/null "http://localhost:$PORT/" || { echo "il server non risponde: vedi $DIR/vite.log" >&2; exit 1; }
echo "$REF ($(git -C "$DIR" rev-parse --short HEAD)) su http://localhost:$PORT/  (log: $DIR/vite.log)"
