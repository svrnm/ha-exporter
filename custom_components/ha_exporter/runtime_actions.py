"""Per-config-entry operations shared by services and dashboard entities."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DEFAULT_INITIAL_BACKFILL_DAYS, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _runtime(hass: HomeAssistant, entry_id: str) -> Any:
    return hass.data[DOMAIN][entry_id]


def resolve_backfill_hours(
    days: int | None, hours: int | None, *, default_hours: int = 24
) -> int:
    if days is not None and days > 0:
        return days * 24
    if hours is not None and hours > 0:
        return hours
    return default_hours


async def async_push_now(hass: HomeAssistant, entry_id: str) -> None:
    data = _runtime(hass, entry_id)
    added = 0
    try:
        added = await data.stats_collector.async_collect()
    except Exception:  # noqa: BLE001
        _LOGGER.exception("%s: stats collect during push_now failed", DOMAIN)
    s_before, st_before = data.buffer.size()
    _LOGGER.info(
        "%s: push_now: collected %d new statistic batches; "
        "buffer now holds %d states + %d statistic batches",
        DOMAIN,
        added,
        s_before,
        st_before,
    )
    if data.buffer.is_empty():
        await data.uploader.async_push()
        _LOGGER.info(
            "%s: push_now: buffer was empty; sent prefs/heartbeat if available",
            DOMAIN,
        )
        return
    await data.uploader.async_push_until_empty(max_iters=200)
    await data.uploader.async_push()
    s_after, st_after = data.buffer.size()
    _LOGGER.info(
        "%s: push_now: done; remaining buffer %d states + %d statistic batches",
        DOMAIN,
        s_after,
        st_after,
    )


async def async_backfill(
    hass: HomeAssistant,
    entry_id: str,
    *,
    backfill_hours: int,
    clear_cursors: bool,
) -> None:
    data = _runtime(hass, entry_id)
    if clear_cursors:
        await data.stats_collector.async_clear_cursors()
        if data.state_backfill is not None:
            await data.state_backfill.async_clear_cursors()
        _LOGGER.info(
            "%s: backfill: cleared statistic and state-backfill cursors", DOMAIN
        )
    added = 0
    try:
        added = await data.stats_collector.async_collect(
            backfill_hours=backfill_hours
        )
    except Exception:  # noqa: BLE001
        _LOGGER.exception("%s: backfill collect failed", DOMAIN)
    _LOGGER.info(
        "%s: backfill(%dh): collected %d statistic batches",
        DOMAIN,
        backfill_hours,
        added,
    )
    await data.uploader.async_push_until_empty(max_iters=200)
    await data.uploader.async_push()


async def async_reset_remote(
    hass: HomeAssistant,
    entry_id: str,
    *,
    days: int,
    full: bool,
) -> None:
    data = _runtime(hass, entry_id)
    effective_days = days if days > 0 else DEFAULT_INITIAL_BACKFILL_DAYS
    if days <= 0:
        _LOGGER.info(
            "%s: reset_remote: days=0 is treated as %d for re-hydration",
            DOMAIN,
            effective_days,
        )
    try:
        deleted = await data.uploader.async_delete_instance_data(full=full)
    except Exception:  # noqa: BLE001
        _LOGGER.exception("%s: reset_remote: server wipe failed; aborting", DOMAIN)
        return
    await data.stats_collector.async_clear_cursors()
    if data.state_backfill is not None:
        await data.state_backfill.async_clear_cursors()
    _LOGGER.info(
        "%s: reset_remote: cleared cursors; server reported %s",
        DOMAIN,
        deleted,
    )
    try:
        if (
            data.state_backfill is not None
            and data.include_energy
            and data.energy.power_entity_ids
        ):
            await data.state_backfill.async_hydrate_from_recorder(
                data.buffer, data.energy.power_entity_ids
            )
        added = await data.stats_collector.async_collect(
            backfill_hours=effective_days * 24
        )
    except Exception:  # noqa: BLE001
        _LOGGER.exception("%s: reset_remote: re-hydrate collect failed", DOMAIN)
        added = 0
    _LOGGER.info(
        "%s: reset_remote: re-hydrate %d days; %d statistic batches",
        DOMAIN,
        effective_days,
        added,
    )
    await data.uploader.async_push_until_empty(max_iters=200)
    for attempt in range(1, 4):
        ok = await data.uploader.async_push()
        if ok:
            break
        _LOGGER.warning(
            "%s: reset_remote: push did not succeed (attempt %d/3), retrying",
            DOMAIN,
            attempt,
        )
        await asyncio.sleep(2.0)
