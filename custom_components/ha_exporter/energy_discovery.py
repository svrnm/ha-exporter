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

    prefs: dict[str, Any] | None = getattr(manager, "data", None)
    if not prefs:
        return EnergyDiscoveryResult(available=True, prefs=None)

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

    # CO₂ signal / Electricity Maps integration. HA exposes one sensor entity
    # under `co2signal_config.entity`. Its statistic is short-term only (mean
    # fossil-fuel percentage per hour), but we can still pull it via the same
    # `statistics_during_period` API because HA stores a 5-minute mean for
    # every state_class=measurement sensor. The stat_id for short-term stats
    # is the entity_id itself.
    co2 = prefs.get("co2signal_config") or {}
    co2_entity = co2.get("entity") if isinstance(co2, dict) else None
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
