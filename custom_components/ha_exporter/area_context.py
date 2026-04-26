"""Map Energy dashboard device entities to Home Assistant areas and floors.

The Energy `device_consumption` list does not include area metadata; it is
resolved from the entity, device, area, and (when available) floor registries
so the web UI can draw Home → floor → area → device flows like HA's own view.
"""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant


def _entity_area_id(
    ent_reg: Any, dev_reg: Any, entity_id: str
) -> str | None:
    """Resolve the area for an energy statistic entity (entity, then device)."""
    ent = ent_reg.async_get(entity_id)
    if not ent:
        return None
    if ent.area_id:
        return str(ent.area_id)
    if ent.device_id:
        dev = dev_reg.async_get(ent.device_id)
        if dev and dev.area_id:
            return str(dev.area_id)
    return None


def build_energy_area_context(
    hass: HomeAssistant, prefs: dict[str, Any]
) -> dict[str, Any] | None:
    """Build a small JSON-friendly map: entity_id → area, plus area and floor details."""
    dev_list = prefs.get("device_consumption") or []
    entity_ids: list[str] = []
    for d in dev_list:
        if not isinstance(d, dict):
            continue
        eid = d.get("stat_consumption")
        if isinstance(eid, str) and eid:
            entity_ids.append(eid)
    if not entity_ids:
        return None

    try:
        from homeassistant.helpers import area_registry as ar_mod
        from homeassistant.helpers import device_registry as dr
        from homeassistant.helpers import entity_registry as er
    except ImportError:
        return None

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar_mod.async_get(hass)

    floor_reg: Any | None
    try:
        from homeassistant.helpers import floor_registry as fr_mod  # type: ignore[import-not-found]

        floor_reg = fr_mod.async_get(hass)
    except ImportError:  # older HA
        floor_reg = None

    entity_area: dict[str, str] = {}
    areas: dict[str, dict[str, Any]] = {}
    floors: dict[str, dict[str, Any]] = {}

    for eid in entity_ids:
        aid = _entity_area_id(ent_reg, dev_reg, eid)
        if not aid:
            continue
        entity_area[eid] = aid
        if aid in areas:
            continue
        aent = area_reg.async_get_area(aid)
        if not aent:
            continue
        area_obj: dict[str, Any] = {"name": aent.name}
        fid: str | None = getattr(aent, "floor_id", None) or None
        if isinstance(fid, str) and fid:
            area_obj["floor_id"] = fid
            if floor_reg is not None:
                fent = floor_reg.async_get_floor(fid)
                if fent and fid not in floors:
                    fl: dict[str, Any] = {"name": fent.name}
                    lev = getattr(fent, "level", None)
                    if lev is not None:
                        try:
                            fl["level"] = int(lev)
                        except (TypeError, ValueError):
                            pass
                    floors[fid] = fl
        areas[aid] = area_obj

    return {
        "version": 1,
        "entity_area": entity_area,
        "areas": areas,
        "floors": floors,
    }
