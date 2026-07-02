#!/usr/bin/env bash
# RunbookOS — one-command local launcher (backend + frontend).
# Usage:  ./start.sh        then open http://localhost:3000
#         ./stop.sh         to stop both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_LOG="$ROOT/backend.log"
FRONTEND_LOG="$ROOT/frontend.log"

echo "==> RunbookOS launcher"

# --- checks -------------------------------------------------------------
[ -f .env ] || { echo "ERROR: .env not found in $ROOT (need COGNEE_CLOUD_BASE, COGNEE_API_KEY, GROQ_API_KEY)"; exit 1; }
VENV="venv"; [ -d "$VENV" ] || VENV=".venv"
[ -x "$VENV/bin/uvicorn" ] || { echo "ERROR: no venv with uvicorn. Run: python3 -m venv venv && venv/bin/pip install -r requirements.txt"; exit 1; }
[ -d frontend/node_modules ] || { echo "ERROR: frontend deps missing. Run: (cd frontend && npm install)"; exit 1; }

# --- free the ports (idempotent restart) --------------------------------
echo "==> Freeing ports 8000 / 3000 if in use"
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
sleep 1

# --- backend ------------------------------------------------------------
echo "==> Starting backend (FastAPI :8000) -> $BACKEND_LOG"
( cd backend && source "../$VENV/bin/activate" && nohup uvicorn main:app --host 0.0.0.0 --port 8000 > "$BACKEND_LOG" 2>&1 & )

echo -n "==> Waiting for backend health"
for i in $(seq 1 90); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then echo " — ready"; break; fi
  echo -n "."; sleep 2
  [ "$i" = "90" ] && { echo " TIMEOUT. See $BACKEND_LOG"; exit 1; }
done
curl -s http://localhost:8000/health; echo

# --- frontend -----------------------------------------------------------
echo "==> Starting frontend (Next.js :3000) -> $FRONTEND_LOG"
( cd frontend && nohup npm run dev > "$FRONTEND_LOG" 2>&1 & )

echo -n "==> Waiting for frontend"
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/ >/dev/null 2>&1; then echo " — ready"; break; fi
  echo -n "."; sleep 2
  [ "$i" = "60" ] && { echo " TIMEOUT. See $FRONTEND_LOG"; exit 1; }
done

echo ""
echo "  ✅ RunbookOS is up"
echo "     App:      http://localhost:3000"
echo "     API:      http://localhost:8000/health"
echo "     Logs:     $BACKEND_LOG  |  $FRONTEND_LOG"
echo "     Stop:     ./stop.sh"
