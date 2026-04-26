"""Collectors that feed the export buffer.

- `StateCollector` subscribes to state_changed events for user-selected
  entities and appends compact records to the buffer.
- `StatisticsCollector` runs on a periodic schedule and pulls long-term
  (hourly) AND short-term (5-minute) statistics for the
  Energy-dashboard-discovered entities.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Literal

from homeassistant.core import (
    CALLBACK_TYPE,
    Event,
    EventStateChangedData,
    HomeAssistant,
    State,
    callback,
)
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .buffer import ExportBuffer
from .const import DOMAIN, STORAGE_KEY_CURSORS, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

Period = Literal["hour", "5minute"]
_ALL_PERIODS: tuple[Period, ...] = ("hour", "5minute")
# HA's recorder retains short-term stats for ~10 days by default, so asking
# for more is pointless. We cap the 5-minute window at that.
_SHORT_TERM_MAX_HOURS = 10 * 24
# When we tick on a schedule, pull this much history per period to catch
# late-arriving data. Cursors still prevent re-exporting already-pushed
# points, so overlap is cheap.
_ROUTINE_LOOKBACK_HOURS = {"hour": 48, "5minute": 6}

# Attribute keys we never forward (noisy / redundant).
_ATTR_STRIP = frozenset(
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


class StateCollector:
    """Track state changes for a list of entities."""

    def __init__(
        self,
        hass: HomeAssistant,
        buffer: ExportBuffer,
        entity_ids: Iterable[str],
    ) -> None:
        self._hass = hass
        self._buffer = buffer
        self._entity_ids = list(entity_ids)
        self._unsub: CALLBACK_TYPE | None = None
        self._unsub_prime_retries: list[CALLBACK_TYPE] = []

    def _prime_snapshot(self, skip: set[str]) -> None:
        """Push a one-off state row for each entity that has a usable HA state."""
        for eid in self._entity_ids:
            if eid in skip:
                continue
            st = self._hass.states.get(eid)
            if st is None or st.state in ("unknown", "unavailable"):
                continue
            self._buffer.add_state(
                {
                    "entity_id": st.entity_id,
                    "state": st.state,
                    "attributes": _compact_attrs(dict(st.attributes)),
                    "last_updated": st.last_updated.isoformat(),
                    "last_changed": st.last_changed.isoformat(),
                }
            )

    @callback
    def start(self, skip_prime_for: set[str] | None = None) -> None:
        for cancel in self._unsub_prime_retries:
            cancel()
        self._unsub_prime_retries.clear()

        if not self._entity_ids:
            _LOGGER.debug("%s: no extra entities configured", DOMAIN)
            return
        skip: set[str] = skip_prime_for or set()
        # Prime the buffer with the current snapshot so constant / template
        # entities (e.g. tariff sensors) appear on the server even if they
        # never emit a state_changed after we subscribe. Skip eids that
        # `state_history_backfill` already provided at the same last_updated.
        self._prime_snapshot(skip)
        # Template / helper tariffs may still be `unknown` for a few seconds
        # after HA starts; re-prime without the backfill skip set so the server
        # eventually gets a numeric state even if the first attempt missed.
        for delay in (15.0, 60.0, 300.0):
            self._unsub_prime_retries.append(
                async_call_later(self._hass, delay, self._retry_prime_all)
            )
        self._unsub = async_track_state_change_event(
            self._hass, self._entity_ids, self._on_change
        )
        _LOGGER.debug(
            "%s: tracking %d state entities", DOMAIN, len(self._entity_ids)
        )

    @callback
    def _retry_prime_all(self, *_args: Any) -> None:
        if self._unsub is None:
            return
        self._prime_snapshot(set())

    @callback
    def stop(self) -> None:
        for cancel in self._unsub_prime_retries:
            cancel()
        self._unsub_prime_retries.clear()
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    @callback
    def _on_change(self, event: Event[EventStateChangedData]) -> None:
        new: State | None = event.data.get("new_state")
        if new is None or new.state in ("unknown", "unavailable"):
            return
        self._buffer.add_state(
            {
                "entity_id": new.entity_id,
                "state": new.state,
                "attributes": _compact_attrs(dict(new.attributes)),
                "last_updated": new.last_updated.isoformat(),
                "last_changed": new.last_changed.isoformat(),
            }
        )


class StatisticsCollector:
    """Pull hourly + 5-minute statistics for a fixed set of statistic ids.

    Cursors are kept per `(period, statistic_id)` so that a stat with no
    long-term bucket (hourly) still advances through the short-term bucket
    (5-minute) and vice-versa.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        buffer: ExportBuffer,
        entry_id: str,
        statistic_ids_provider: Callable[[], list[str]],
    ) -> None:
        self._hass = hass
        self._buffer = buffer
        self._provider = statistic_ids_provider
        self._unsub: CALLBACK_TYPE | None = None
        self._cursor_store: Store[dict[str, Any]] = Store(
            hass,
            STORAGE_VERSION,
            f"{STORAGE_KEY_CURSORS}.{entry_id}",
        )
        # period -> statistic_id -> last exported period start (ISO string).
        # Two levels so each granularity advances independently.
        self._cursors: dict[str, dict[str, str]] = {p: {} for p in _ALL_PERIODS}

    async def async_load(self) -> None:
        data = await self._cursor_store.async_load()
        if not data:
            return
        # Backwards-compat: older versions stored `{stat_id: iso}` directly
        # (one-level). Wrap it as `{"hour": data}` so the new code keeps
        # working without forcing users to re-backfill.
        if data and all(isinstance(v, str) for v in data.values()):
            self._cursors = {"hour": dict(data), "5minute": {}}
            return
        for p in _ALL_PERIODS:
            sub = data.get(p)
            self._cursors[p] = dict(sub) if isinstance(sub, dict) else {}

    async def async_save(self) -> None:
        await self._cursor_store.async_save(self._cursors)

    async def async_remove(self) -> None:
        await self._cursor_store.async_remove()

    def has_cursors(self) -> bool:
        """Return True if we've ever saved progress for any statistic id.

        Used to detect a first-run / post-wipe situation so we can trigger
        an initial hydrate without double-posting on every restart.
        """
        return any(self._cursors[p] for p in _ALL_PERIODS)

    async def async_clear_cursors(self) -> None:
        """Forget per-statistic cursors so the next collect re-exports.

        Called by `reset_remote` and by the `clear_cursors=true` variant of
        the `backfill` service.
        """
        self._cursors = {p: {} for p in _ALL_PERIODS}
        await self.async_save()

    @callback
    def start(self) -> None:
        # Tick every 5 minutes so we pick up short-term stats shortly after
        # HA's recorder writes them. Overlap with cursor-based dedup makes
        # this safe even if ticks are ragged.
        self._unsub = async_track_time_interval(
            self._hass, self._tick, timedelta(minutes=5)
        )

    @callback
    def stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    async def _tick(self, now: datetime) -> None:
        await self.async_collect()

    async def async_collect(self, *, backfill_hours: int | None = None) -> int:
        """Pull new statistics for every known period and add to the buffer.

        Returns the number of (stat_id, period) pairs for which points were
        appended.
        """
        stat_ids = list(self._provider())
        if not stat_ids:
            return 0

        total = 0
        for period in _ALL_PERIODS:
            total += await self._collect_period(
                stat_ids, period, backfill_hours=backfill_hours
            )
        return total

    async def _collect_period(
        self,
        stat_ids: list[str],
        period: Period,
        *,
        backfill_hours: int | None,
    ) -> int:
        # statistics_during_period is sync; push to executor to avoid blocking.
        from homeassistant.components.recorder.statistics import (  # type: ignore[import-not-found]
            statistics_during_period,
        )
        from homeassistant.components.recorder import get_instance  # type: ignore[import-not-found]

        recorder = get_instance(self._hass)
        now = dt_util.utcnow()
        # Align `end` to the period boundary so we don't pull a half-written
        # bucket that HA will still be mutating.
        if period == "hour":
            end = now.replace(minute=0, second=0, microsecond=0)
            step = timedelta(hours=1)
        else:  # "5minute"
            end = now.replace(
                minute=(now.minute // 5) * 5, second=0, microsecond=0
            )
            step = timedelta(minutes=5)

        cursors = self._cursors.setdefault(period, {})
        # Per-period first-run detection. This catches the upgrade path
        # where an install had hour cursors before 5-minute support was
        # added: top-level `has_cursors()` returns True (because of the
        # hour cursors), so `__init__.py` won't request a backfill — but
        # the 5-minute cursor map is still empty and would otherwise only
        # get the routine 6 h lookback. We instead hydrate the period to
        # its sensible max so historical data shows up immediately.
        period_first_run = backfill_hours is None and not cursors

        # Windowing: either user-requested backfill, the per-period
        # first-run hydrate, or the routine rolling-lookback. Short-term
        # stats are capped because HA only keeps 10 days of them.
        if backfill_hours is not None:
            window_hours = backfill_hours
        elif period_first_run:
            window_hours = (
                _SHORT_TERM_MAX_HOURS if period == "5minute" else 30 * 24
            )
        else:
            window_hours = _ROUTINE_LOOKBACK_HOURS[period]
        if period == "5minute":
            window_hours = min(window_hours, _SHORT_TERM_MAX_HOURS)
        default_start = end - timedelta(hours=window_hours)
        per_id_start: dict[str, datetime] = {}
        earliest = default_start
        for sid in stat_ids:
            cur = cursors.get(sid)
            if cur:
                try:
                    parsed = datetime.fromisoformat(cur)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    per_id_start[sid] = parsed + step
                except ValueError:
                    per_id_start[sid] = default_start
            else:
                per_id_start[sid] = default_start
            if per_id_start[sid] < earliest:
                earliest = per_id_start[sid]

        if backfill_hours is not None:
            earliest = default_start
            per_id_start = {sid: default_start for sid in stat_ids}

        if earliest >= end:
            return 0

        def _fetch(start: datetime, ids: list[str]) -> dict[str, list[dict[str, Any]]]:
            return statistics_during_period(
                self._hass,
                start,
                end,
                set(ids),
                period,
                None,
                {"sum", "state", "mean", "min", "max"},
            )

        try:
            result = await recorder.async_add_executor_job(
                _fetch, earliest, stat_ids
            )
        except Exception:  # noqa: BLE001
            _LOGGER.exception(
                "Failed to fetch %s statistics", period
            )
            return 0

        appended_for: set[str] = set()
        for sid, rows in result.items():
            start_filter = per_id_start.get(sid, default_start)
            points: list[dict[str, Any]] = []
            latest_start: datetime | None = None
            for row in rows:
                row_start = row.get("start")
                if isinstance(row_start, (int, float)):
                    row_start_dt = datetime.fromtimestamp(row_start, tz=timezone.utc)
                elif isinstance(row_start, datetime):
                    row_start_dt = (
                        row_start
                        if row_start.tzinfo
                        else row_start.replace(tzinfo=timezone.utc)
                    )
                else:
                    continue
                if row_start_dt < start_filter:
                    continue
                point: dict[str, Any] = {"start": row_start_dt.isoformat()}
                for key in ("sum", "state", "mean", "min", "max"):
                    if key in row and row[key] is not None:
                        point[key] = row[key]
                points.append(point)
                if latest_start is None or row_start_dt > latest_start:
                    latest_start = row_start_dt

            if not points:
                continue

            state = self._hass.states.get(sid)
            unit = (
                state.attributes.get("unit_of_measurement") if state else None
            )

            self._buffer.add_statistic(
                {
                    "statistic_id": sid,
                    "source": "recorder",
                    "period": period,
                    "unit_of_measurement": unit,
                    "points": points,
                }
            )
            appended_for.add(sid)
            if latest_start is not None:
                cursors[sid] = latest_start.isoformat()

        needs_save = bool(appended_for)
        if period_first_run:
            # Even stat_ids that returned no points get a sentinel cursor
            # pointing at the previous bucket. Without this we'd keep
            # re-issuing the 10-day fetch every tick for sensors that have
            # never produced statistics (e.g. PV when the inverter is
            # offline overnight).
            sentinel = (end - step).isoformat()
            for sid in stat_ids:
                if sid not in cursors:
                    cursors[sid] = sentinel
                    needs_save = True

        if needs_save:
            await self.async_save()

        return len(appended_for)
