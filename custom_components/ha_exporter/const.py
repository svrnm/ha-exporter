"""Constants for the HA Exporter integration."""
from __future__ import annotations

from typing import Final

DOMAIN: Final = "ha_exporter"

# Config / options keys
CONF_ENDPOINT: Final = "endpoint"
# Optional: duplicate uploads (e.g. dev + prod) with the same token and options.
CONF_SECONDARY_ENDPOINT: Final = "second_endpoint"
# Upload / remote-wipe secret; must match HA_EXPORTER_WRITE_TOKEN on the server.
CONF_TOKEN: Final = "token"
CONF_INTERVAL: Final = "interval"
CONF_INCLUDE_ENERGY: Final = "include_energy"
CONF_EXTRA_ENTITIES: Final = "extra_entities"
CONF_VERIFY_SSL: Final = "verify_ssl"
CONF_INITIAL_BACKFILL_DAYS: Final = "initial_backfill_days"
CONF_ELECTRICITY_PRICE_ENTITY: Final = "electricity_price_entity"
CONF_GAS_PRICE_ENTITY: Final = "gas_price_entity"
# Optional sensor: remaining usable energy in the battery (kWh / Wh / MWh)
CONF_BATTERY_AVAILABLE_KWH_ENTITY: Final = "battery_available_kwh_entity"
# Optional: total usable capacity (same units as remaining) for SOC % on the web UI
CONF_BATTERY_CAPACITY_KWH_ENTITY: Final = "battery_capacity_kwh_entity"

# Defaults
DEFAULT_INTERVAL: Final = 300  # seconds between pushes
DEFAULT_BATCH_SIZE: Final = 500  # max state records per push
DEFAULT_INCLUDE_ENERGY: Final = True
DEFAULT_VERIFY_SSL: Final = True
# Days of historical long-term statistics to pull on the very first run
# (and after `reset_remote`). 0 disables the auto-hydrate.
DEFAULT_INITIAL_BACKFILL_DAYS: Final = 30
# Hard cap — HA's long-term statistics are indefinitely retained, but we
# don't want a typo to force a year-long fetch every time.
MAX_BACKFILL_DAYS: Final = 366

# Backoff
MIN_BACKOFF: Final = 1.0
MAX_BACKOFF: Final = 300.0
BACKOFF_FACTOR: Final = 2.0

# Storage
STORAGE_VERSION: Final = 1
STORAGE_KEY_BUFFER: Final = f"{DOMAIN}.buffer"
STORAGE_KEY_CURSORS: Final = f"{DOMAIN}.cursors"
# Max last_updated per power entity after historical fetches (recorder backfill)
STORAGE_KEY_STATE_BACKFILL: Final = f"{DOMAIN}.state_backfill"
# Match HA short-term / recording retention; history fetch window cap
STATE_HISTORY_CUTOFF_DAYS: Final = 10

# Upload
INGEST_PATH: Final = "/ingest"
GZIP_THRESHOLD: Final = 4096  # bytes

# Events
EVENT_PUSHED: Final = f"{DOMAIN}_pushed"

# Services
SERVICE_PUSH_NOW: Final = "push_now"
SERVICE_BACKFILL: Final = "backfill"
SERVICE_RESET_REMOTE: Final = "reset_remote"
