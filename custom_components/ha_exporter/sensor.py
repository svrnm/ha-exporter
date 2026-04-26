"""Sensors for buffer size, last successful push, and upload health."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, EVENT_PUSHED
from .coordinator import HAExporterCoordinator
from .entity import exporter_device_info

_LOGGER = logging.getLogger(__name__)


SENSORS: tuple[SensorEntityDescription, ...] = (
    SensorEntityDescription(
        key="last_success",
        translation_key="last_success",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SensorEntityDescription(
        key="buffer_states",
        translation_key="buffer_states",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SensorEntityDescription(
        key="buffer_statistics",
        translation_key="buffer_statistics",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SensorEntityDescription(
        key="upload_status",
        translation_key="upload_status",
        device_class=SensorDeviceClass.ENUM,
        options=["ok", "retrying"],
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)


class HAExporterSensorEntity(CoordinatorEntity[HAExporterCoordinator], SensorEntity):
    """Base for exporter status sensors."""

    entity_description: SensorEntityDescription
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HAExporterCoordinator,
        description: SensorEntityDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}-{description.key}"

    @property
    def device_info(self) -> DeviceInfo:
        return exporter_device_info(self.coordinator.config_entry)


class HAExporterLastSuccessSensor(HAExporterSensorEntity):
    """When the primary endpoint last accepted a payload."""

    @property
    def native_value(self) -> Any:
        return self.coordinator.data.get("last_success_at")


class HAExporterBufferStatesSensor(HAExporterSensorEntity):
    """Pending state change records in the export buffer."""

    @property
    def native_value(self) -> int | None:
        v = self.coordinator.data.get("buffer_states")
        return int(v) if v is not None else None


class HAExporterBufferStatisticsSensor(HAExporterSensorEntity):
    """Pending statistics batches in the export buffer."""

    @property
    def native_value(self) -> int | None:
        v = self.coordinator.data.get("buffer_statistics")
        return int(v) if v is not None else None


class HAExporterUploadStatusSensor(HAExporterSensorEntity):
    """Whether the last primary-endpoint attempt failed (retry / backoff)."""

    @property
    def native_value(self) -> str | None:
        if self.coordinator.data.get("is_failing"):
            return "retrying"
        return "ok"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = HAExporterCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    @callback
    def _on_pushed(ev: Any) -> None:
        if ev.data.get("entry_id") != entry.entry_id:
            return
        coordinator.async_request_refresh()

    unsub: CALLBACK_TYPE = hass.bus.async_listen(EVENT_PUSHED, _on_pushed)
    entry.async_on_unload(unsub)

    entities: list[SensorEntity] = []
    for desc in SENSORS:
        if desc.key == "last_success":
            entities.append(HAExporterLastSuccessSensor(coordinator, desc))
        elif desc.key == "buffer_states":
            entities.append(HAExporterBufferStatesSensor(coordinator, desc))
        elif desc.key == "buffer_statistics":
            entities.append(HAExporterBufferStatisticsSensor(coordinator, desc))
        elif desc.key == "upload_status":
            entities.append(HAExporterUploadStatusSensor(coordinator, desc))
    async_add_entities(entities)
