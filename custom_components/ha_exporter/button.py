"""Buttons that run the same actions as the integration services."""

from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity, ButtonEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DEFAULT_INITIAL_BACKFILL_DAYS, MAX_BACKFILL_DAYS
from .entity import exporter_device_info
from . import runtime_actions


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities(
        [
            HAExporterPushNowButton(hass, entry),
            HAExporterBackfillButton(hass, entry),
            HAExporterResetRemoteButton(hass, entry),
        ]
    )


class HAExporterButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        description: ButtonEntityDescription,
    ) -> None:
        self.entity_description = description
        self._hass = hass
        self._entry_id = entry.entry_id
        self._attr_unique_id = f"{entry.entry_id}-{description.key}"
        self._attr_device_info = exporter_device_info(entry)


class HAExporterPushNowButton(HAExporterButton):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            entry,
            ButtonEntityDescription(
                key="push_now",
                translation_key="push_now",
            ),
        )

    async def async_press(self) -> None:
        await runtime_actions.async_push_now(self._hass, self._entry_id)


class HAExporterBackfillButton(HAExporterButton):
    """Re-export 30 days of long-term statistics (same default spirit as the service)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            entry,
            ButtonEntityDescription(
                key="backfill_30d",
                translation_key="backfill_30d",
            ),
        )

    async def async_press(self) -> None:
        hours = min(30, MAX_BACKFILL_DAYS) * 24
        await runtime_actions.async_backfill(
            self._hass,
            self._entry_id,
            backfill_hours=hours,
            clear_cursors=False,
        )


class HAExporterResetRemoteButton(HAExporterButton):
    """Wipe remote series for this instance and re-hydrate (default day window)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            entry,
            ButtonEntityDescription(
                key="reset_remote",
                translation_key="reset_remote",
            ),
        )

    async def async_press(self) -> None:
        await runtime_actions.async_reset_remote(
            self._hass,
            self._entry_id,
            days=DEFAULT_INITIAL_BACKFILL_DAYS,
            full=False,
        )
