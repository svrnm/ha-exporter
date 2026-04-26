"""HA Exporter integration.

Wires together the collectors, buffer, and uploader behind a single config
entry. Everything is stored on `hass.data[DOMAIN][entry_id]` as a
`RuntimeData` object so services + options updates can reach it.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    EVENT_HOMEASSISTANT_STARTED,
    EVENT_HOMEASSISTANT_STOP,
)
from homeassistant.core import CoreState, HomeAssistant, ServiceCall, callback
from homeassistant.helpers import instance_id
from homeassistant.helpers.event import async_track_time_interval

from .buffer import ExportBuffer
from .collector import StateCollector, StatisticsCollector
from .const import (
    CONF_BATTERY_AVAILABLE_KWH_ENTITY,
    CONF_BATTERY_CAPACITY_KWH_ENTITY,
    CONF_ELECTRICITY_PRICE_ENTITY,
    CONF_ENDPOINT,
    CONF_SECONDARY_ENDPOINT,
    CONF_EXTRA_ENTITIES,
    CONF_GAS_PRICE_ENTITY,
    CONF_INCLUDE_ENERGY,
    CONF_INITIAL_BACKFILL_DAYS,
    CONF_INTERVAL,
    CONF_TOKEN,
    CONF_VERIFY_SSL,
    DEFAULT_INCLUDE_ENERGY,
    DEFAULT_INITIAL_BACKFILL_DAYS,
    DEFAULT_INTERVAL,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    MAX_BACKFILL_DAYS,
    SERVICE_BACKFILL,
    SERVICE_PUSH_NOW,
    SERVICE_RESET_REMOTE,
)
from .area_context import build_energy_area_context
from .energy_discovery import EnergyDiscoveryResult, discover_energy
from .state_history_backfill import StateHistoryBackfill
from .uploader import Uploader

_LOGGER = logging.getLogger(__name__)


@dataclass
class RuntimeData:
    hass: HomeAssistant
    entry: ConfigEntry
    buffer: ExportBuffer
    uploader: Uploader
    state_collector: StateCollector
    stats_collector: StatisticsCollector
    energy: EnergyDiscoveryResult
    unsub_interval: Any = None
    unsub_stop: Any = None
    include_energy: bool = True
    extra_entities: list[str] = field(default_factory=list)
    initial_backfill_days: int = DEFAULT_INITIAL_BACKFILL_DAYS
    electricity_price_entity: str | None = None
    gas_price_entity: str | None = None
    battery_available_kwh_entity: str | None = None
    battery_capacity_kwh_entity: str | None = None
    state_backfill: StateHistoryBackfill | None = None

    def statistic_ids(self) -> list[str]:
        if not self.include_energy:
            return []
        ids = list(self.energy.statistic_ids)
        seen = set(ids)
        for e in (self.electricity_price_entity, self.gas_price_entity):
            if e and e not in seen:
                seen.add(e)
                ids.append(e)
        return ids

    def energy_prefs(self) -> dict[str, Any] | None:
        if not self.include_energy or not self.energy.prefs:
            return None
        out = dict(self.energy.prefs)
        if self.electricity_price_entity:
            out["ha_exporter_electricity_price_entity"] = (
                self.electricity_price_entity
            )
        if self.gas_price_entity:
            out["ha_exporter_gas_price_entity"] = self.gas_price_entity
        if self.battery_available_kwh_entity:
            out["ha_exporter_battery_available_kwh_entity"] = (
                self.battery_available_kwh_entity
            )
        if self.battery_capacity_kwh_entity:
            out["ha_exporter_battery_capacity_kwh_entity"] = (
                self.battery_capacity_kwh_entity
            )
        ac = build_energy_area_context(self.hass, out)
        if ac is not None:
            out["ha_exporter_area_context"] = ac
        return out


def _merged_conf(entry: ConfigEntry) -> dict[str, Any]:
    return {**entry.data, **entry.options}


def _endpoints_from_conf(conf: dict[str, Any]) -> list[str]:
    """Primary URL + optional second (e.g. dev) — same token and payload for both."""
    primary = str(conf[CONF_ENDPOINT]).rstrip("/")
    ordered: list[str] = [primary]
    raw = conf.get(CONF_SECONDARY_ENDPOINT)
    if isinstance(raw, str):
        sec = raw.strip().rstrip("/")
        if sec and sec != primary:
            ordered.append(sec)
    return list(dict.fromkeys(ordered))


def _optional_entity_id(conf: dict[str, Any], key: str) -> str | None:
    raw = conf.get(key)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _compute_tracked_entities(data: "RuntimeData") -> list[str]:
    """Merge user extras, energy-discovered power sensors, and price entities.

    Used both at initial setup and after a deferred re-discovery, so any
    sensors that the energy component surfaced late still get state-tracked.
    """
    price_track: list[str] = []
    if data.include_energy:
        price_track = list(data.energy.price_entity_ids)
    if data.electricity_price_entity:
        price_track.append(data.electricity_price_entity)
    if data.gas_price_entity:
        price_track.append(data.gas_price_entity)
    if data.battery_available_kwh_entity:
        price_track.append(data.battery_available_kwh_entity)
    if data.battery_capacity_kwh_entity:
        price_track.append(data.battery_capacity_kwh_entity)
    return list(
        dict.fromkeys(
            [
                *data.extra_entities,
                *(data.energy.power_entity_ids if data.include_energy else []),
                *price_track,
            ]
        )
    )


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """YAML setup is not supported; entry is required."""
    hass.data.setdefault(DOMAIN, {})
    _register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HA Exporter from a config entry."""
    conf = _merged_conf(entry)
    endpoints = _endpoints_from_conf(conf)
    token: str = conf[CONF_TOKEN]
    interval: int = int(conf.get(CONF_INTERVAL, DEFAULT_INTERVAL))
    include_energy: bool = bool(
        conf.get(CONF_INCLUDE_ENERGY, DEFAULT_INCLUDE_ENERGY)
    )
    extras: list[str] = list(conf.get(CONF_EXTRA_ENTITIES, []) or [])
    verify_ssl: bool = bool(conf.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL))
    initial_backfill_days: int = int(
        conf.get(CONF_INITIAL_BACKFILL_DAYS, DEFAULT_INITIAL_BACKFILL_DAYS)
    )
    initial_backfill_days = max(0, min(initial_backfill_days, MAX_BACKFILL_DAYS))
    electricity_price_entity = _optional_entity_id(conf, CONF_ELECTRICITY_PRICE_ENTITY)
    gas_price_entity = _optional_entity_id(conf, CONF_GAS_PRICE_ENTITY)
    battery_available_kwh_entity = _optional_entity_id(
        conf, CONF_BATTERY_AVAILABLE_KWH_ENTITY
    )
    battery_capacity_kwh_entity = _optional_entity_id(
        conf, CONF_BATTERY_CAPACITY_KWH_ENTITY
    )

    buffer = ExportBuffer(hass, entry.entry_id)
    await buffer.async_load()

    state_backfill = StateHistoryBackfill(hass, entry.entry_id)
    await state_backfill.async_load()

    energy = (
        await discover_energy(hass)
        if include_energy
        else EnergyDiscoveryResult()
    )

    ha_uuid = await instance_id.async_get(hass)

    # Build the runtime container first; we feed `tracked_state_entities`
    # in via a helper that depends on the runtime so we can recompute it
    # after a deferred energy re-discovery (see below).
    data = RuntimeData(
        hass=hass,
        entry=entry,
        buffer=buffer,
        uploader=Uploader(
            hass,
            buffer,
            endpoints=endpoints,
            token=token,
            verify_ssl=verify_ssl,
            instance_id_provider=lambda: ha_uuid,
            energy_prefs_provider=lambda: data.energy_prefs(),  # noqa: F821
        ),
        # Placeholder collectors; real ones are wired below once we know
        # the tracked entity list. Using a dummy here keeps the dataclass
        # contract simple.
        state_collector=StateCollector(hass, buffer, []),
        stats_collector=StatisticsCollector(
            hass, buffer, entry.entry_id, lambda: data.statistic_ids()  # noqa: F821
        ),
        energy=energy,
        include_energy=include_energy,
        extra_entities=extras,
        initial_backfill_days=initial_backfill_days,
        electricity_price_entity=electricity_price_entity,
        gas_price_entity=gas_price_entity,
        battery_available_kwh_entity=battery_available_kwh_entity,
        battery_capacity_kwh_entity=battery_capacity_kwh_entity,
        state_backfill=state_backfill,
    )

    # Merge user-selected extras with any power sensors surfaced by the
    # energy dashboard (stat_rate / stat_rate_from / stat_rate_to). Those
    # drive the live flow view on the web UI — we state-track them rather
    # than pull them as long-term stats, because they're instantaneous
    # W/kW measurements without a cumulative sum.
    #
    # First, mirror the recorder for those *power* entity ids (same time span
    # HA’s History / Energy graph uses) so the remote has overnight rows, not
    # only from subscribe() onward.
    #
    # Energy price entities (entity_energy_price / export) are also
    # state-tracked: many are constants or rarely change and may not
    # produce meaningful hourly statistics, but the remote UI needs them.
    await data.stats_collector.async_load()
    skip_power_prime: set[str] = set()
    if data.state_backfill and include_energy and data.energy.power_entity_ids:
        skip_power_prime = await data.state_backfill.async_hydrate_from_recorder(
            buffer, data.energy.power_entity_ids
        )

    data.state_collector = StateCollector(
        hass, buffer, _compute_tracked_entities(data)
    )
    data.state_collector.start(skip_prime_for=skip_power_prime)
    data.stats_collector.start()

    # Detect first-run (or post-wipe) state before the initial collect and
    # trigger a hydrate in the background so setup isn't blocked by a
    # potentially large `statistics_during_period` call.
    is_first_run = (
        include_energy
        and initial_backfill_days > 0
        and not data.stats_collector.has_cursors()
    )

    async def _initial_collect_and_push() -> None:
        try:
            await data.uploader.async_push_until_empty()
            if is_first_run:
                _LOGGER.info(
                    "%s: first run detected; hydrating %d days of long-term "
                    "statistics from Home Assistant",
                    DOMAIN,
                    initial_backfill_days,
                )
                await data.stats_collector.async_collect(
                    backfill_hours=initial_backfill_days * 24
                )
            else:
                await data.stats_collector.async_collect()
            await data.uploader.async_push_until_empty()
            # Prefs-only when the buffer is empty: restores instance + energy_prefs
            # on the server after a wipe, when nothing else is queued to POST.
            await data.uploader.async_push()
        except Exception:  # noqa: BLE001
            _LOGGER.exception("%s: initial statistics collect failed", DOMAIN)

    hass.async_create_task(_initial_collect_and_push())

    # If HA is still starting up, the `energy` integration may not have
    # loaded its prefs yet, in which case `discover_energy` returned an
    # empty result. Re-run discovery after `homeassistant_started` and
    # rebind collectors if anything new shows up — otherwise nothing
    # would be exported until the next HA restart.
    needs_late_discovery = (
        include_energy
        and hass.state != CoreState.running
        and (
            not data.energy.prefs
            or not data.energy.statistic_ids
            or not data.energy.power_entity_ids
        )
    )

    async def _rediscover_after_start(_event: Any) -> None:
        try:
            fresh = await discover_energy(hass)
        except Exception:  # noqa: BLE001
            _LOGGER.exception(
                "%s: deferred energy re-discovery failed", DOMAIN
            )
            return
        if not fresh.prefs:
            _LOGGER.debug(
                "%s: deferred energy re-discovery still empty", DOMAIN
            )
            return

        changed_stats = fresh.statistic_ids != data.energy.statistic_ids
        changed_power = fresh.power_entity_ids != data.energy.power_entity_ids
        if not (changed_stats or changed_power or fresh.prefs != data.energy.prefs):
            return

        _LOGGER.info(
            "%s: deferred discovery picked up %d stat ids and %d power "
            "entities (was %d / %d)",
            DOMAIN,
            len(fresh.statistic_ids),
            len(fresh.power_entity_ids),
            len(data.energy.statistic_ids),
            len(data.energy.power_entity_ids),
        )
        data.energy = fresh

        # Stats collector reads ids via callback, so it picks up new ones
        # automatically. The state collector subscribes once on start, so
        # we tear it down and rebuild it with the merged tracked-entity
        # list.
        if changed_power:
            try:
                data.state_collector.stop()
            except Exception:  # noqa: BLE001
                _LOGGER.debug("%s: state collector stop failed", DOMAIN)
            skip2: set[str] = set()
            if data.state_backfill and fresh.power_entity_ids:
                skip2 = await data.state_backfill.async_hydrate_from_recorder(
                    buffer, fresh.power_entity_ids
                )
            data.state_collector = StateCollector(
                hass, buffer, _compute_tracked_entities(data)
            )
            data.state_collector.start(skip_prime_for=skip2)

        # Trigger an immediate collect so freshly discovered stats land
        # on the server within seconds rather than at the next 5-min tick.
        hass.async_create_task(_initial_collect_and_push())

    if needs_late_discovery:
        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, _rediscover_after_start
        )

    async def _interval_push(_now: Any) -> None:
        await data.uploader.async_push_with_backoff()
        # Opportunistically drain if backlog built up while we were offline.
        if not data.buffer.is_empty():
            await data.uploader.async_push_until_empty()

    data.unsub_interval = async_track_time_interval(
        hass, _interval_push, timedelta(seconds=max(interval, 30))
    )

    async def _on_stop(_event: Any) -> None:
        # Best-effort final flush before HA goes down.
        try:
            await data.uploader.async_push()
        except Exception:  # noqa: BLE001
            _LOGGER.debug("%s: final push failed during shutdown", DOMAIN)
        await data.buffer.async_flush(force=True)

    data.unsub_stop = hass.bus.async_listen_once(
        EVENT_HOMEASSISTANT_STOP, _on_stop
    )

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = data
    _register_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data: RuntimeData | None = hass.data.get(DOMAIN, {}).pop(
        entry.entry_id, None
    )
    if data is None:
        return True

    if data.unsub_interval is not None:
        data.unsub_interval()
        data.unsub_interval = None
    if data.unsub_stop is not None:
        data.unsub_stop()
        data.unsub_stop = None

    data.state_collector.stop()
    data.stats_collector.stop()

    await data.buffer.async_flush(force=True)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Clean up persisted data when the integration is uninstalled."""
    buffer = ExportBuffer(hass, entry.entry_id)
    await buffer.async_remove()
    sb = StateHistoryBackfill(hass, entry.entry_id)
    await sb.async_remove()
    stats = StatisticsCollector(hass, buffer, entry.entry_id, list)
    await stats.async_remove()


async def _async_update_listener(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Reload on options change (simplest correct approach)."""
    await hass.config_entries.async_reload(entry.entry_id)


# --------------------------------------------------------------------------- #
# Services
# --------------------------------------------------------------------------- #

_BACKFILL_SCHEMA = vol.Schema(
    {
        vol.Optional("days"): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=MAX_BACKFILL_DAYS)
        ),
        vol.Optional("hours"): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=MAX_BACKFILL_DAYS * 24)
        ),
        vol.Optional("clear_cursors", default=False): vol.Coerce(bool),
    }
)

_RESET_REMOTE_SCHEMA = vol.Schema(
    {
        vol.Optional("days", default=DEFAULT_INITIAL_BACKFILL_DAYS): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=MAX_BACKFILL_DAYS)
        ),
        vol.Optional("full", default=False): vol.Coerce(bool),
    }
)


def _resolve_window_hours(
    days: int | None, hours: int | None, default_hours: int = 24
) -> int:
    if days is not None and days > 0:
        return days * 24
    if hours is not None and hours > 0:
        return hours
    return default_hours


@callback
def _all_runtime(hass: HomeAssistant) -> list[RuntimeData]:
    return list(hass.data.get(DOMAIN, {}).values())


def _register_services(hass: HomeAssistant) -> None:
    # Register each service only if it's not already present, so a running
    # HA that gets the integration updated still picks up newly added ones
    # (e.g. `reset_remote` after upgrading from the hours-only backfill).

    async def _push_now(_call: ServiceCall) -> None:
        runtimes = _all_runtime(hass)
        if not runtimes:
            _LOGGER.warning(
                "%s.push_now called but no config entry is loaded",
                DOMAIN,
            )
            return
        for data in runtimes:
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
                # Still register instance + prefs on the server (e.g. after a wipe
                # when stats have not been collected yet this tick).
                await data.uploader.async_push()
                _LOGGER.info(
                    "%s: push_now: buffer was empty; sent prefs/heartbeat if available",
                    DOMAIN,
                )
                continue
            await data.uploader.async_push_until_empty(max_iters=200)
            await data.uploader.async_push()
            s_after, st_after = data.buffer.size()
            _LOGGER.info(
                "%s: push_now: done; remaining buffer %d states + %d statistic batches",
                DOMAIN,
                s_after,
                st_after,
            )

    async def _backfill(call: ServiceCall) -> None:
        hours = _resolve_window_hours(
            call.data.get("days"), call.data.get("hours")
        )
        clear = bool(call.data.get("clear_cursors", False))
        for data in _all_runtime(hass):
            if clear:
                await data.stats_collector.async_clear_cursors()
                if data.state_backfill is not None:
                    await data.state_backfill.async_clear_cursors()
                _LOGGER.info(
                    "%s: backfill: cleared statistic and state-backfill cursors", DOMAIN
                )
            added = 0
            try:
                added = await data.stats_collector.async_collect(
                    backfill_hours=hours
                )
            except Exception:  # noqa: BLE001
                _LOGGER.exception("%s: backfill collect failed", DOMAIN)
            _LOGGER.info(
                "%s: backfill(%dh): collected %d statistic batches",
                DOMAIN,
                hours,
                added,
            )
            await data.uploader.async_push_until_empty(max_iters=200)
            await data.uploader.async_push()

    async def _reset_remote(call: ServiceCall) -> None:
        days = int(call.data.get("days", DEFAULT_INITIAL_BACKFILL_DAYS))
        full = bool(call.data.get("full", False))
        # 0 = "no re-import" in older mind-set; for a one-step reset to "show
        # data again" we always hydrate at least the default day window.
        effective_days = days if days > 0 else DEFAULT_INITIAL_BACKFILL_DAYS
        if days <= 0:
            _LOGGER.info(
                "%s: reset_remote: days=0 is treated as %d for re-hydration",
                DOMAIN,
                effective_days,
            )
        for data in _all_runtime(hass):
            try:
                deleted = await data.uploader.async_delete_instance_data(full=full)
            except Exception:  # noqa: BLE001
                _LOGGER.exception(
                    "%s: reset_remote: server wipe failed; aborting", DOMAIN
                )
                continue
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
                _LOGGER.exception(
                    "%s: reset_remote: re-hydrate collect failed", DOMAIN
                )
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

    if not hass.services.has_service(DOMAIN, SERVICE_PUSH_NOW):
        hass.services.async_register(DOMAIN, SERVICE_PUSH_NOW, _push_now)
    if not hass.services.has_service(DOMAIN, SERVICE_BACKFILL):
        hass.services.async_register(
            DOMAIN, SERVICE_BACKFILL, _backfill, schema=_BACKFILL_SCHEMA
        )
    if not hass.services.has_service(DOMAIN, SERVICE_RESET_REMOTE):
        hass.services.async_register(
            DOMAIN,
            SERVICE_RESET_REMOTE,
            _reset_remote,
            schema=_RESET_REMOTE_SCHEMA,
        )
