"""Config flow for HA Exporter."""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

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
)

_LOGGER = logging.getLogger(__name__)

# Optional entity selectors reject None / empty / literal "None" as defaults.
_ENTITY_OPTIONAL_KEYS: tuple[str, ...] = (
    CONF_ELECTRICITY_PRICE_ENTITY,
    CONF_GAS_PRICE_ENTITY,
    CONF_BATTERY_AVAILABLE_KWH_ENTITY,
    CONF_BATTERY_CAPACITY_KWH_ENTITY,
)


def _strip_invalid_optional_entities(data: dict[str, Any]) -> dict[str, Any]:
    """Return a copy safe to pass into EntitySelector defaults / to persist."""
    out = {**data}
    for key in _ENTITY_OPTIONAL_KEYS:
        v = out.get(key)
        if v is None or v == "":
            out.pop(key, None)
            continue
        if isinstance(v, str) and v.strip().lower() in ("none", "null"):
            out.pop(key, None)
    return out


def _is_valid_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except (ValueError, AttributeError):
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    """Build the data schema shared between config + options flows."""
    d = _strip_invalid_optional_entities(defaults)
    fields: dict[Any, Any] = {
        vol.Required(
            CONF_ENDPOINT, default=d.get(CONF_ENDPOINT, "")
        ): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.URL)
        ),
        vol.Optional(
            CONF_SECONDARY_ENDPOINT, default=(d.get(CONF_SECONDARY_ENDPOINT) or "")
        ): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.URL)
        ),
        vol.Required(
            CONF_TOKEN, default=d.get(CONF_TOKEN, "")
        ): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        ),
        vol.Required(
            CONF_INTERVAL, default=d.get(CONF_INTERVAL, DEFAULT_INTERVAL)
        ): selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=30,
                max=86400,
                step=30,
                unit_of_measurement="s",
                mode=selector.NumberSelectorMode.BOX,
            )
        ),
        vol.Optional(
            CONF_INCLUDE_ENERGY,
            default=d.get(CONF_INCLUDE_ENERGY, DEFAULT_INCLUDE_ENERGY),
        ): selector.BooleanSelector(),
        vol.Optional(
            CONF_EXTRA_ENTITIES,
            default=d.get(CONF_EXTRA_ENTITIES, []),
        ): selector.EntitySelector(
            selector.EntitySelectorConfig(multiple=True)
        ),
        vol.Optional(
            CONF_VERIFY_SSL,
            default=d.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        ): selector.BooleanSelector(),
        vol.Optional(
            CONF_INITIAL_BACKFILL_DAYS,
            default=d.get(
                CONF_INITIAL_BACKFILL_DAYS, DEFAULT_INITIAL_BACKFILL_DAYS
            ),
        ): selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=0,
                max=MAX_BACKFILL_DAYS,
                step=1,
                unit_of_measurement="d",
                mode=selector.NumberSelectorMode.BOX,
            )
        ),
    }

    def _optional_entity(key: str, domains: list[str]) -> None:
        sel = selector.EntitySelector(
            selector.EntitySelectorConfig(domain=domains)
        )
        ent = d.get(key)
        if ent:
            fields[vol.Optional(key, default=ent)] = sel
        else:
            fields[vol.Optional(key)] = sel

    _optional_entity(CONF_ELECTRICITY_PRICE_ENTITY, ["sensor"])
    _optional_entity(CONF_GAS_PRICE_ENTITY, ["sensor"])
    _optional_entity(CONF_BATTERY_AVAILABLE_KWH_ENTITY, ["sensor", "number"])
    _optional_entity(CONF_BATTERY_CAPACITY_KWH_ENTITY, ["sensor", "number"])

    return vol.Schema(fields)


class HAExporterConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HA Exporter."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First-time setup step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        errors: dict[str, str] = {}

        if user_input is not None:
            if not _is_valid_url(user_input[CONF_ENDPOINT]):
                errors[CONF_ENDPOINT] = "invalid_url"
            else:
                # Strip trailing slash so we can always append `/ingest`.
                user_input[CONF_ENDPOINT] = user_input[CONF_ENDPOINT].rstrip("/")
                sec_raw = (user_input.get(CONF_SECONDARY_ENDPOINT) or "").strip()
                if sec_raw:
                    if not _is_valid_url(sec_raw):
                        errors[CONF_SECONDARY_ENDPOINT] = "invalid_url"
                    elif sec_raw.rstrip("/") == user_input[CONF_ENDPOINT]:
                        errors[CONF_SECONDARY_ENDPOINT] = "same_as_primary"
                    else:
                        user_input[CONF_SECONDARY_ENDPOINT] = sec_raw.rstrip("/")
                else:
                    user_input.pop(CONF_SECONDARY_ENDPOINT, None)
            if not errors:
                user_input[CONF_INTERVAL] = int(user_input[CONF_INTERVAL])
                user_input[CONF_INITIAL_BACKFILL_DAYS] = int(
                    user_input.get(
                        CONF_INITIAL_BACKFILL_DAYS, DEFAULT_INITIAL_BACKFILL_DAYS
                    )
                )
                return self.async_create_entry(
                    title="HA Exporter",
                    data=_strip_invalid_optional_entities(user_input),
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(_strip_invalid_optional_entities(user_input or {})),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> HAExporterOptionsFlow:
        return HAExporterOptionsFlow(config_entry)


class HAExporterOptionsFlow(OptionsFlow):
    """Options flow so settings can be tweaked after install."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        # Merge current data + existing options so the form is pre-filled.
        current: dict[str, Any] = _strip_invalid_optional_entities(
            {**self._entry.data, **self._entry.options}
        )

        if user_input is not None:
            if not _is_valid_url(user_input[CONF_ENDPOINT]):
                errors[CONF_ENDPOINT] = "invalid_url"
            else:
                user_input[CONF_ENDPOINT] = user_input[CONF_ENDPOINT].rstrip("/")
                sec_raw = (user_input.get(CONF_SECONDARY_ENDPOINT) or "").strip()
                if sec_raw:
                    if not _is_valid_url(sec_raw):
                        errors[CONF_SECONDARY_ENDPOINT] = "invalid_url"
                    elif sec_raw.rstrip("/") == user_input[CONF_ENDPOINT]:
                        errors[CONF_SECONDARY_ENDPOINT] = "same_as_primary"
                    else:
                        user_input[CONF_SECONDARY_ENDPOINT] = sec_raw.rstrip("/")
                else:
                    user_input.pop(CONF_SECONDARY_ENDPOINT, None)
            if not errors:
                user_input[CONF_INTERVAL] = int(user_input[CONF_INTERVAL])
                user_input[CONF_INITIAL_BACKFILL_DAYS] = int(
                    user_input.get(
                        CONF_INITIAL_BACKFILL_DAYS, DEFAULT_INITIAL_BACKFILL_DAYS
                    )
                )
                return self.async_create_entry(
                    title="",
                    data=_strip_invalid_optional_entities(user_input),
                )

        return self.async_show_form(
            step_id="init",
            data_schema=_schema(current),
            errors=errors,
        )
