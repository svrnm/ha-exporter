"""Shared device info for HA Exporter dashboard entities."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo

from .const import DOMAIN


def exporter_device_info(entry: ConfigEntry) -> DeviceInfo:
    """Single virtual device per config entry (service integration)."""
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="HA Exporter",
        manufacturer="HA Exporter",
        model="Remote export",
        entry_type=DeviceEntryType.SERVICE,
    )
