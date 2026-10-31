#!/usr/bin/env bash
# Avvia una versione del gioco da confrontare (es. main o un altro ramo) su una porta, in una cartella separata.
# Uso:   tools/perf/confronto.sh <ramo-o-commit> <porta>        es. tools/perf/confronto.sh main 5181
# Ferma: tools/perf/confronto.sh --stop <porta>   (rimuove anche la cartella)
# Ogni versione ha la sua cache di Vite: con la cache condivisa i server si rompevano a vicenda (errore 504).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
BASE="${TMPDIR:-/tmp}/forklift-confronto"
if [ "${1:-}" = "--stop" ]; then
  PORT="$2"; DIR="$BASE/$PORT"
  for pid in $(ps -eo pid,args | grep "[v]ite.*--port $PORT" | awk '{print $1}'); do kill "$pid" 2>/dev/null || true; done
  [ -d "$DIR" ] && git -C "$ROOT" worktree remove --force "$DIR"
  echo "fermato $PORT"; exit 0
fi
REF="$1"; PORT="$2"; DIR="$BASE/$PORT"
mkdir -p "$BASE"
[ -d "$DIR" ] && git -C "$ROOT" worktree remove --force "$DIR"
git -C "$ROOT" worktree add --detach "$DIR" "$REF" >/dev/null
ln -s "$ROOT/node_modules" "$DIR/node_modules"
cat > "$DIR/vite.confronto.config.js" <<'CFG'
import base from './vite.config.js';
const cfg = typeof base === 'function' ? base({ command: 'serve', mode: 'development' }) : base;
export default { ...cfg, cacheDir: '.vite-confronto-cache' };
CFG
(cd "$DIR" && nohup npx vite --config vite.confronto.config.js --port "$PORT" --strictPort > "$DIR/vite.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
echo "$REF ($(git -C "$DIR" rev-parse --short HEAD)) su http://localhost:$PORT/  (log: $DIR/vite.log)"
