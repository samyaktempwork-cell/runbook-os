#!/usr/bin/env bash
# RunbookOS — stop both servers.
echo "==> Stopping RunbookOS (ports 8000 / 3000)"
lsof -ti :8000 | xargs kill -9 2>/dev/null && echo "   backend stopped" || echo "   backend not running"
lsof -ti :3000 | xargs kill -9 2>/dev/null && echo "   frontend stopped" || echo "   frontend not running"
