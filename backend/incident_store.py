"""JSON persistence for incident metadata (id, text, timestamp, resolved status)."""

import os
import json
import asyncio
import aiofiles
from pathlib import Path
from datetime import datetime, timezone
from schemas import IncidentRecord, StepOutcome

# Docker: /app/data (mounted volume). Local dev: repo_root/data
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
INCIDENTS_FILE = DATA_DIR / "incidents.json"
SEED_FILE = DATA_DIR / "seed_incidents.json"

_lock = asyncio.Lock()


async def _read_all() -> list[dict]:
    if not INCIDENTS_FILE.exists():
        return []
    async with aiofiles.open(INCIDENTS_FILE, "r") as f:
        content = await f.read()
    return json.loads(content) if content.strip() else []


async def _write_all(records: list[dict]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(INCIDENTS_FILE, "w") as f:
        await f.write(json.dumps(records, indent=2))


async def save(incident_id: str, text: str, source_url: str | None = None, source_repo: str | None = None, cognee_data_id: str | None = None) -> IncidentRecord:
    record = IncidentRecord(
        incident_id=incident_id,
        text=text,
        timestamp=datetime.now(timezone.utc).isoformat(),
        resolved=False,
        resolution_steps=[],
        source_url=source_url,
        source_repo=source_repo,
        cognee_data_id=cognee_data_id,
    )
    async with _lock:
        records = await _read_all()
        records.append(record.model_dump())
        await _write_all(records)
    return record


async def set_cognee_data_id(incident_id: str, data_id: str) -> bool:
    """Record the Cognee Cloud data item UUID for an incident (enables real FORGET)."""
    async with _lock:
        records = await _read_all()
        for r in records:
            if r["incident_id"] == incident_id:
                r["cognee_data_id"] = data_id
                await _write_all(records)
                return True
    return False


async def set_cognee_data_ids(mapping: dict[str, str]) -> int:
    """Bulk-record Cognee data IDs in a single read/write (used during seeding)."""
    if not mapping:
        return 0
    async with _lock:
        records = await _read_all()
        n = 0
        for r in records:
            did = mapping.get(r["incident_id"])
            if did:
                r["cognee_data_id"] = did
                n += 1
        await _write_all(records)
    return n


async def get_all() -> list[IncidentRecord]:
    records = await _read_all()
    return [IncidentRecord(**r) for r in records]


async def get(incident_id: str) -> IncidentRecord | None:
    records = await _read_all()
    for r in records:
        if r["incident_id"] == incident_id:
            return IncidentRecord(**r)
    return None


async def mark_resolved(incident_id: str, steps: list[StepOutcome]) -> bool:
    async with _lock:
        records = await _read_all()
        for r in records:
            if r["incident_id"] == incident_id:
                r["resolved"] = True
                r["resolution_steps"] = [s.model_dump() for s in steps]
                await _write_all(records)
                return True
    return False


async def delete(incident_id: str) -> bool:
    async with _lock:
        records = await _read_all()
        filtered = [r for r in records if r["incident_id"] != incident_id]
        if len(filtered) == len(records):
            return False
        await _write_all(filtered)
    return True


async def count() -> int:
    records = await _read_all()
    return len(records)


async def load_seed_incidents() -> list[dict]:
    """Read seed_incidents.json — used at startup to pre-populate Cognee for demo."""
    if not SEED_FILE.exists():
        return []
    async with aiofiles.open(SEED_FILE, "r") as f:
        content = await f.read()
    return json.loads(content) if content.strip() else []
