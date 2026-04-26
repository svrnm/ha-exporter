"""Polls buffer / upload status for dashboard sensors."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class HAExporterCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """15s refresh of queue sizes and uploader health (also refreshed on push)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.config_entry = entry
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=15),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        domain_data = self.hass.data.get(DOMAIN)
        if not domain_data or self.config_entry.entry_id not in domain_data:
            raise UpdateFailed("HA Exporter is not loaded")
        data = domain_data[self.config_entry.entry_id]
        states_n, stats_n = data.buffer.size()
        last_at: datetime | None = data.uploader.last_success_at
        return {
            "buffer_states": states_n,
            "buffer_statistics": stats_n,
            "last_success_at": last_at,
            "is_failing": data.uploader.is_failing,
        }
