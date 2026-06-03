"""Read the user's Energy dashboard preferences and extract statistic IDs.

The `homeassistant.components.energy` module is part of core HA but its Python
API is semi-internal. We import defensively and fall back to an empty result
with a logged warning if the internals move.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


# Keys on each energy source entry that reference a statistic id.
# See homeassistant/components/energy/data.py for the authoritative list.
_STAT_KEYS = (
    "stat_energy_from",
    "stat_energy_to",
    "stat_cost",
    "stat_compensation",
    "entity_energy_price",
    "entity_energy_price_export",
    "stat_production",
    "stat_predicted_cost",
    "stat_consumption",
)

# Keys on each source that reference an instantaneous power sensor (W/kW).
# These drive the live flow diagram — they're state-tracked, not pulled as
# long-term statistics. Some sources expose them at the top level, others
# nest them in `power_config`, so the discovery scans both spots.
_POWER_KEYS = (
    "stat_rate",
    "stat_rate_from",
    "stat_rate_to",
)

# Price sensors referenced by the Energy UI (`entity_energy_price`, …). We
# state-track them because many tariff helpers are constants with no useful
# long-term statistics — the web UI and cost math still need their values.
_PRICE_ENTITY_KEYS = (
    "entity_energy_price",
    "entity_energy_price_export",
)


@dataclass(slots=True)
class EnergyDiscoveryResult:
    """Result of reading Energy dashboard prefs."""

    statistic_ids: list[str] = field(default_factory=list)
    power_entity_ids: list[str] = field(default_factory=list)
    price_entity_ids: list[str] = field(default_factory=list)
    prefs: dict[str, Any] | None = None
    available: bool = False


def _find_co2signal_entity(hass: HomeAssistant) -> str | None:
    """Locate the Electricity Maps / CO₂ Signal fossil-fuel-% entity.

    Mirrors HA's own dashboard logic (frontend's `getEnergyData`): we want
    the `%` sensor exposed by the `co2signal` integration (its other sensor
    reports gCO₂eq/kWh intensity, which is not what the energy view uses).
    Modern HA's `EnergyPreferences` no longer carries the entity id, so we
    have to discover it ourselves.

    Strategy (most → least reliable):
      1. Walk `co2signal` config entries and pick the `%` sensor among
         the entities each one registered.
      2. Fall back to scanning the entity registry for `platform=="co2signal"`
         (in case the integration is loaded but config_entries lookup fails
         on this HA version).
    """
    try:
        from homeassistant.helpers import entity_registry as er
    except ImportError:
        _LOGGER.debug("co2signal: entity_registry import failed")
        return None
    try:
        ent_reg = er.async_get(hass)
    except Exception:  # noqa: BLE001 - defensive across HA versions
        _LOGGER.debug("co2signal: er.async_get failed", exc_info=True)
        return None

    def _is_percent_entity(entry: Any) -> bool:
        # Prefer the registry's stored unit (set when the entity was created),
        # then the live state's unit attribute.
        unit = getattr(entry, "unit_of_measurement", None)
        if unit != "%":
            state = hass.states.get(entry.entity_id)
            unit = state.attributes.get("unit_of_measurement") if state else None
        return unit == "%"

    # Path 1: via config entries — bulletproof against `entry.platform`
    # quirks and surfaces clear logs when the integration is not installed.
    co2_entries = []
    try:
        co2_entries = list(hass.config_entries.async_entries("co2signal"))
    except Exception:  # noqa: BLE001
        _LOGGER.debug("co2signal: async_entries('co2signal') failed", exc_info=True)
    if co2_entries:
        for cfg in co2_entries:
            try:
                regs = er.async_entries_for_config_entry(ent_reg, cfg.entry_id)
            except Exception:  # noqa: BLE001
                _LOGGER.debug(
                    "co2signal: async_entries_for_config_entry failed for %s",
                    cfg.entry_id,
                    exc_info=True,
                )
                continue
            _LOGGER.debug(
                "co2signal: config_entry=%s entities=%s",
                cfg.entry_id,
                [e.entity_id for e in regs],
            )
            for entry in regs:
                if _is_percent_entity(entry):
                    return entry.entity_id
    else:
        _LOGGER.info(
            "co2signal: no Electricity Maps / CO₂ Signal config entry found "
            "— skipping CO₂-frei discovery"
        )

    # Path 2: fall back to a registry scan.
    matched = 0
    for entry in ent_reg.entities.values():
        if getattr(entry, "platform", None) != "co2signal":
            continue
        matched += 1
        if _is_percent_entity(entry):
            return entry.entity_id
    if matched == 0 and not co2_entries:
        return None
    _LOGGER.info(
        "co2signal: scanned registry, %d co2signal entities present, "
        "none with unit '%%' — fossil-%% sensor may be disabled",
        matched,
    )
    return None


async def discover_energy(hass: HomeAssistant) -> EnergyDiscoveryResult:
    """Return the set of statistic_ids referenced by the Energy dashboard."""
    try:
        from homeassistant.components.energy.data import (  # type: ignore[import-not-found]
            async_get_manager,
        )
    except ImportError:
        _LOGGER.warning(
            "Energy component is unavailable; energy auto-discovery disabled"
        )
        return EnergyDiscoveryResult()

    try:
        manager = await async_get_manager(hass)
    except Exception:  # noqa: BLE001 - defensive, HA internals may change
        _LOGGER.exception("Failed to read Energy dashboard preferences")
        return EnergyDiscoveryResult()

    raw_prefs: dict[str, Any] | None = getattr(manager, "data", None)
    if not raw_prefs:
        return EnergyDiscoveryResult(available=True, prefs=None)
    # Shallow copy so we can inject ha_exporter-only fields (e.g. a discovered
    # `co2signal_config`) without mutating HA's internal manager.data.
    prefs: dict[str, Any] = dict(raw_prefs)

    stat_ids: list[str] = []
    seen: set[str] = set()
    power_ids: list[str] = []
    seen_power: set[str] = set()
    price_ids: list[str] = []
    seen_price: set[str] = set()

    def _add_stat(val: Any) -> None:
        if isinstance(val, str) and val and val not in seen:
            seen.add(val)
            stat_ids.append(val)

    def _add_power(val: Any) -> None:
        if isinstance(val, str) and val and val not in seen_power:
            seen_power.add(val)
            power_ids.append(val)

    def _add_price_entity(val: Any) -> None:
        if isinstance(val, str) and val and val not in seen_price:
            seen_price.add(val)
            price_ids.append(val)

    # energy_sources is a list of dicts, each with a `type` plus source-specific
    # fields. We also scan `device_consumption` which is a list of
    # {"stat_consumption": "..."} entries.
    for source in prefs.get("energy_sources", []) or []:
        for key in _STAT_KEYS:
            _add_stat(source.get(key))
        for key in _PRICE_ENTITY_KEYS:
            _add_price_entity(source.get(key))
        for key in _POWER_KEYS:
            _add_power(source.get(key))
        # `power_config` is a nested dict with the same rate keys.
        power_cfg = source.get("power_config")
        if isinstance(power_cfg, dict):
            for key in _POWER_KEYS:
                _add_power(power_cfg.get(key))
        # Some sources nest flow data (e.g. grid has `flow_from`, `flow_to`).
        for nested_key in ("flow_from", "flow_to"):
            for nested in source.get(nested_key, []) or []:
                if not isinstance(nested, dict):
                    continue
                for key in _STAT_KEYS:
                    _add_stat(nested.get(key))
                for key in _PRICE_ENTITY_KEYS:
                    _add_price_entity(nested.get(key))
                for key in _POWER_KEYS:
                    _add_power(nested.get(key))

    for device in prefs.get("device_consumption", []) or []:
        if not isinstance(device, dict):
            continue
        _add_stat(device.get("stat_consumption"))
        _add_power(device.get("stat_rate"))

    for device in prefs.get("device_consumption_water", []) or []:
        if not isinstance(device, dict):
            continue
        _add_stat(device.get("stat_consumption"))
        _add_power(device.get("stat_rate"))

    # CO₂ signal / Electricity Maps integration. Older HA versions kept the
    # selected entity in `co2signal_config.entity` on the energy prefs, but
    # current HA dropped that field — the dashboard now scans the entity
    # registry for the `co2signal` platform's `%` sensor instead (see the HA
    # frontend's `getEnergyData` in src/data/energy.ts). Mirror that behaviour
    # here, then inject the discovered entity back into the outgoing prefs as
    # `co2signal_config.entity` so server + web consumers keep working
    # unchanged. The stat is short-term only (mean fossil-fuel percentage per
    # 5 min) but the collector pulls both periods so it ends up on the wire.
    co2 = prefs.get("co2signal_config") or {}
    co2_entity = co2.get("entity") if isinstance(co2, dict) else None
    if not co2_entity:
        co2_entity = _find_co2signal_entity(hass)
        if co2_entity:
            prefs["co2signal_config"] = {"entity": co2_entity}
    _add_stat(co2_entity)

    # Log enough detail that users can diagnose "why is stat X not showing up"
    # without enabling debug for the whole component. We print the source
    # types, the counts per list, and the stat_ids they contributed so it's
    # clear whether HA's energy_prefs is complete or not.
    source_types = [s.get("type") for s in (prefs.get("energy_sources") or [])]
    _LOGGER.info(
        "%s: discovered %d stat ids, %d power entities, %d price entities "
        "from energy dashboard (sources=%s, co2signal=%s)",
        "ha_exporter",
        len(stat_ids),
        len(power_ids),
        len(price_ids),
        source_types or "[]",
        bool(co2_entity),
    )
    _LOGGER.debug(
        "%s: statistic_ids=%s power_entity_ids=%s price_entity_ids=%s",
        "ha_exporter",
        stat_ids,
        power_ids,
        price_ids,
    )
    return EnergyDiscoveryResult(
        statistic_ids=stat_ids,
        power_entity_ids=power_ids,
        price_entity_ids=price_ids,
        prefs=prefs,
        available=True,
    )
