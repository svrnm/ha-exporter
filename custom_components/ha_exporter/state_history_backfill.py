"""Mirror the recorder's history for Energy *power* (flow) entities to the buffer.

`StateCollector` only sees `state_changed` from subscribe time. The remote UI
replays `/states` for the live chart, so it needs the same history HA already
has in the recorder. This module pulls `get_significant_states` for
`power_entity_ids` and appends to the buffer before the live stream starts.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Final

from homeassistant.core import HomeAssistant, State
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .buffer import ExportBuffer
from .const import DOMAIN, STATE_HISTORY_CUTOFF_DAYS, STORAGE_KEY_STATE_BACKFILL, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

# Chunk the recorder so one transaction does not load weeks as a single list.
_FETCH_CHUNK_HOURS: Final = 6
# Re-fetch 1h before the last cursor to align with the statistics collector.
_OVERLAP = timedelta(hours=1)
_ATTR_STRIP: Final = frozenset(
    {
        "friendly_name",
        "icon",
        "entity_picture",
        "supported_features",
        "assumed_state",
        "attribution",
    }
)


def _compact_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in attrs.items() if k not in _ATTR_STRIP}


def _to_record(st: State) -> dict[str, Any]:
    return {
        "entity_id": st.entity_id,
        "state": st.state,
        "attributes": _compact_attrs(dict(st.attributes)),
        "last_updated": st.last_updated.isoformat(),
        "last_changed": st.last_changed.isoformat(),
    }


class StateHistoryBackfill:
    """Per-config-entry cursors: max `last_exported` (ISO) per power entity."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._store: Store[dict[str, Any]] = Store(
            hass,
            STORAGE_VERSION,
            f"{STORAGE_KEY_STATE_BACKFILL}.{entry_id}",
        )
        # entity_id -> max last_updated ISO we have pushed from *historical* fetch
        self._cursors: dict[str, str] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if not data:
            return
        c = data.get("cursors")
        if isinstance(c, dict):
            self._cursors = {k: v for k, v in c.items() if isinstance(v, str)}

    async def async_save(self) -> None:
        await self._store.async_save({"cursors": self._cursors})

    async def async_clear_cursors(self) -> None:
        self._cursors = {}
        await self._store.async_save({"cursors": {}})

    async def async_remove(self) -> None:
        self._cursors = {}
        await self._store.async_remove()

    async def async_hydrate_from_recorder(
        self,
        buffer: ExportBuffer,
        power_entity_ids: list[str],
    ) -> set[str]:
        """Pull recorder history, append to buffer, return eids to skip in StateCollector.start.

        The skip set is for entities where the *last* row in the batch matches
        the current state so the live `start()` priming would duplicate.
        """
        eids = [e for e in (power_entity_ids or []) if isinstance(e, str) and e]
        if not eids:
            return set()

        from homeassistant.components.recorder import get_instance  # type: ignore[import-not-found]
        from homeassistant.components.recorder.history import (  # type: ignore[import-not-found]
            get_significant_states,
        )

        now = dt_util.utcnow()
        max_age = now - timedelta(days=STATE_HISTORY_CUTOFF_DAYS)
        per_start: list[datetime] = []
        for eid in eids:
            cur = self._cursors.get(eid)
            if cur:
                try:
                    parsed = datetime.fromisoformat(cur)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                except ValueError:
                    s = max_age
                else:
                    s = max(parsed - _OVERLAP, max_age)
            else:
                s = max_age
            per_start.append(s)
        start = min(per_start) if per_start else max_age
        if start >= now:
            return set()

        resume: dict[str, datetime] = {}
        for eid in eids:
            raw = self._cursors.get(eid)
            if not raw:
                continue
            try:
                r = datetime.fromisoformat(raw)
                if r.tzinfo is None:
                    r = r.replace(tzinfo=timezone.utc)
                resume[eid] = r
            except ValueError:
                pass

        recorder = get_instance(self._hass)
        max_added = 0
        eid_max: dict[str, datetime] = {}

        chunk = timedelta(hours=_FETCH_CHUNK_HOURS)
        t0 = start
        while t0 < now:
            t1 = min(t0 + chunk, now)
            try:
                result = await recorder.async_add_executor_job(
                    _fetch_states,
                    self._hass,
                    t0,
                    t1,
                    eids,
                )
            except Exception:  # noqa: BLE001
                _LOGGER.exception(
                    "%s: recorder get_significant_states %s..%s failed",
                    DOMAIN,
                    t0,
                    t1,
                )
                break
            for eid, rows in result.items():
                if not rows:
                    continue
                for row in rows:
                    if not isinstance(row, State):
                        continue
                    st = row
                    if st.state in ("unknown", "unavailable", None):
                        continue
                    lu = st.last_updated
                    if lu.tzinfo is None:
                        lu = lu.replace(tzinfo=timezone.utc)
                    e2 = st.entity_id
                    cap = resume.get(e2)
                    if cap and lu <= cap:
                        continue
                    buffer.add_state(_to_record(st))
                    max_added += 1
                    n = eid_max.get(e2)
                    if n is None or lu > n:
                        eid_max[e2] = lu
            t0 = t1

        for e2, lu in eid_max.items():
            old = self._cursors.get(e2)
            if old:
                try:
                    o = datetime.fromisoformat(old)
                    if o.tzinfo is None:
                        o = o.replace(tzinfo=timezone.utc)
                except ValueError:
                    self._cursors[e2] = lu.isoformat()
                else:
                    self._cursors[e2] = (max(o, lu)).isoformat()
            else:
                self._cursors[e2] = lu.isoformat()
        if eid_max:
            await self.async_save()
            _LOGGER.info(
                "%s: state history from recorder: %d rows (power entities: %d)",
                DOMAIN,
                max_added,
                len(eids),
            )
        return _skip_prime(self._hass, eids, eid_max)


def _fetch_states(
    hass: HomeAssistant,
    t0: datetime,
    t1: datetime,
    eids: list[str],
) -> dict[str, list[State | dict[str, Any]]]:
    from homeassistant.components.recorder.history import (  # type: ignore[import-not-found]
        get_significant_states,
    )

    return get_significant_states(
        hass,
        t0,
        t1,
        eids,
        None,
        True,  # include_start_time_state
        False,  # significant_changes_only — we want all samples for the power line
        False,  # minimal_response
        False,  # no_attributes
        False,  # compressed_state_format
    )


def _skip_prime(
    hass: HomeAssistant,
    eids: list[str],
    eid_max: dict[str, datetime],
) -> set[str]:
    """Entities whose current state was already the last history row in this run."""
    skip: set[str] = set()
    for eid in eids:
        cur: State | None = hass.states.get(eid)
        if not cur or cur.state in ("unknown", "unavailable"):
            continue
        m = eid_max.get(eid)
        if not m:
            continue
        cu = cur.last_updated
        if cu.tzinfo is None:
            cu = cu.replace(tzinfo=timezone.utc)
        if m == cu:
            skip.add(eid)
    return skip
