"""
In-memory metrics tracker.

Tracks per-session stats shown in the comparison panel.
Resets on backend restart — intentional (demo metrics, not production analytics).
"""

from dataclasses import dataclass, field
from collections import deque


@dataclass
class SessionMetrics:
    incidents_fed: int = 0
    runbooks_generated: int = 0
    total_nodes: int = 0
    total_edges: int = 0

    # Rolling averages (last 10 values)
    _cognee_response_times: deque = field(default_factory=lambda: deque(maxlen=10))
    _rag_response_times: deque = field(default_factory=lambda: deque(maxlen=10))

    def record_remember(self, nodes_added: int, edges_added: int):
        self.incidents_fed += 1
        self.total_nodes += nodes_added
        self.total_edges += edges_added

    def record_recall(self, cognee_ms: int):
        self.runbooks_generated += 1
        self._cognee_response_times.append(cognee_ms)

    def record_comparison(self, cognee_ms: int, rag_ms: int):
        self._cognee_response_times.append(cognee_ms)
        self._rag_response_times.append(rag_ms)

    def avg_cognee_ms(self) -> float:
        if not self._cognee_response_times:
            return 0.0
        return sum(self._cognee_response_times) / len(self._cognee_response_times)

    def avg_rag_ms(self) -> float:
        if not self._rag_response_times:
            return 0.0
        return sum(self._rag_response_times) / len(self._rag_response_times)

    def to_dict(self) -> dict:
        return {
            "incidents_fed": self.incidents_fed,
            "runbooks_generated": self.runbooks_generated,
            "total_nodes": self.total_nodes,
            "total_edges": self.total_edges,
            "avg_cognee_response_ms": round(self.avg_cognee_ms()),
            "avg_rag_response_ms": round(self.avg_rag_ms()),
        }


# Singleton
metrics = SessionMetrics()
