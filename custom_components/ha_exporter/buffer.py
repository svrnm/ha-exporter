"""Persistent buffer for pending export payloads.

Keeps two lists in memory (statistics batches and state change records) and
mirrors them to disk via `helpers.storage.Store` so nothing is lost across
restarts or extended API outages.
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Any, Deque

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY_BUFFER, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

# Hard cap so a prolonged outage can't eat unlimited disk.
_MAX_STATES = 50_000
_MAX_STATISTICS = 50_000


class ExportBuffer:
    """In-memory deques with on-disk persistence."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass,
            STORAGE_VERSION,
            f"{STORAGE_KEY_BUFFER}.{entry_id}",
        )
        self._states: Deque[dict[str, Any]] = deque(maxlen=_MAX_STATES)
        self._statistics: Deque[dict[str, Any]] = deque(maxlen=_MAX_STATISTICS)
        self._lock = asyncio.Lock()
        self._dirty = False

    async def async_load(self) -> None:
        """Restore the buffer from disk on startup."""
        data = await self._store.async_load()
        if not data:
            return
        for rec in data.get("states", []):
            self._states.append(rec)
        for rec in data.get("statistics", []):
            self._statistics.append(rec)
        _LOGGER.debug(
            "%s: loaded %d states + %d stats from disk",
            DOMAIN,
            len(self._states),
            len(self._statistics),
        )

    def add_state(self, record: dict[str, Any]) -> None:
        self._states.append(record)
        self._dirty = True

    def add_statistic(self, record: dict[str, Any]) -> None:
        self._statistics.append(record)
        self._dirty = True

    def snapshot(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Return a copy of current contents for uploading.

        Callers should invoke `ack(n_states, n_stats)` after a successful push
        to drop the corresponding prefix.
        """
        return list(self._states), list(self._statistics)

    def ack(self, n_states: int, n_stats: int) -> None:
        """Drop the first N records of each queue (they were uploaded)."""
        for _ in range(min(n_states, len(self._states))):
            self._states.popleft()
        for _ in range(min(n_stats, len(self._statistics))):
            self._statistics.popleft()
        self._dirty = True

    def is_empty(self) -> bool:
        return not self._states and not self._statistics

    def size(self) -> tuple[int, int]:
        return len(self._states), len(self._statistics)

    async def async_flush(self, *, force: bool = False) -> None:
        """Persist the current buffer contents to disk."""
        if not force and not self._dirty:
            return
        async with self._lock:
            await self._store.async_save(
                {
                    "states": list(self._states),
                    "statistics": list(self._statistics),
                }
            )
            self._dirty = False

    async def async_remove(self) -> None:
        """Delete the on-disk buffer (called on integration uninstall)."""
        await self._store.async_remove()
