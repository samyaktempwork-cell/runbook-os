"""WebSocket event bus — broadcasts typed JSON events to connected graph clients."""

import json
import asyncio
from fastapi import WebSocket
from schemas import EventType


class EventEmitter:
    """Manages all active WebSocket connections and broadcasts events to them."""

    def __init__(self):
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.add(ws)

    def disconnect(self, ws: WebSocket):
        self._connections.discard(ws)

    async def emit(self, ws: WebSocket, payload: dict):
        """Send event to a specific WebSocket. Silently drops if disconnected."""
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            self.disconnect(ws)

    async def broadcast(self, payload: dict):
        """Send event to ALL connected clients. Used for async background tasks."""
        dead: set[WebSocket] = set()
        for ws in self._connections:
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.add(ws)
        self._connections -= dead

    # ------------------------------------------------------------------
    # Typed emit helpers — one method per event type.
    # These enforce the contract defined in schemas.py EventType.
    # ------------------------------------------------------------------

    async def processing_start(self, incident_id: str):
        await self.broadcast({
            "event": EventType.PROCESSING_START,
            "incident_id": incident_id,
        })

    async def entity_found(self, node_id: str, label: str, node_type: str, confidence: float = 1.0):
        await self.broadcast({
            "event": EventType.ENTITY_FOUND,
            "node": {
                "id": node_id,
                "label": label,
                "type": node_type,
                "confidence": confidence,
                "incident_count": 1,
            },
        })
        await asyncio.sleep(0.25)  # stagger so frontend animates each node separately

    async def relationship_found(self, source: str, target: str, label: str, weight: float = 1.0):
        await self.broadcast({
            "event": EventType.RELATIONSHIP_FOUND,
            "edge": {
                "source": source,
                "target": target,
                "label": label,
                "weight": weight,
            },
        })
        await asyncio.sleep(0.2)

    async def remember_complete(self, nodes_added: int, edges_added: int):
        await self.broadcast({
            "event": EventType.REMEMBER_COMPLETE,
            "stats": {
                "nodes_added": nodes_added,
                "edges_added": edges_added,
            },
        })

    async def recall_start(self, query: str):
        await self.broadcast({
            "event": EventType.RECALL_START,
            "query": query,
        })

    async def traversal_step(self, node_id: str, confidence: float):
        await self.broadcast({
            "event": EventType.TRAVERSAL_STEP,
            "node": node_id,
            "confidence": confidence,
        })
        await asyncio.sleep(0.15)  # 150ms between each traversal step

    async def path_found(self, path: list[str]):
        await self.broadcast({
            "event": EventType.PATH_FOUND,
            "path": path,
        })

    async def runbook_step(self, step: int, text: str, confidence: float, command: str | None = None):
        await self.broadcast({
            "event": EventType.RUNBOOK_STEP,
            "step": step,
            "text": text,
            "command": command,
            "confidence": confidence,
        })
        await asyncio.sleep(0.3)  # 300ms between steps — gives streaming feel

    async def recall_complete(self, total_steps: int):
        await self.broadcast({
            "event": EventType.RECALL_COMPLETE,
            "total_steps": total_steps,
        })

    async def edge_updated(self, edge_id: str, weight: float, direction: str):
        await self.broadcast({
            "event": EventType.EDGE_UPDATED,
            "edge": edge_id,
            "weight": weight,
            "direction": direction,  # "up" | "down"
        })
        await asyncio.sleep(0.1)

    async def node_pulse(self, node_id: str, color: str):
        await self.broadcast({
            "event": EventType.NODE_PULSE,
            "node": node_id,
            "color": color,  # "green" | "red"
        })

    async def improve_complete(self):
        await self.broadcast({"event": EventType.IMPROVE_COMPLETE})

    async def forget_complete(self, incident_id: str):
        await self.broadcast({
            "event": EventType.FORGET_COMPLETE,
            "incident_id": incident_id,
        })

    async def error(self, message: str):
        await self.broadcast({
            "event": EventType.ERROR,
            "message": message,
        })


# Singleton — imported by main.py and cognee_service.py
emitter = EventEmitter()
