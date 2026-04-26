"""HTTP uploader: batches buffer contents and POSTs them to the remote API."""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
from typing import Any, Callable

import aiohttp
from aiohttp import ClientError

from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .buffer import ExportBuffer
from .const import (
    BACKOFF_FACTOR,
    DEFAULT_BATCH_SIZE,
    DOMAIN,
    EVENT_PUSHED,
    GZIP_THRESHOLD,
    INGEST_PATH,
    MAX_BACKOFF,
    MIN_BACKOFF,
)

_LOGGER = logging.getLogger(__name__)

# Status codes we treat as "retryable": server-side + rate limit.
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def _ingest_url(base: str) -> str:
    return f"{base.rstrip('/')}{INGEST_PATH}"


class Uploader:
    """Takes an `ExportBuffer` snapshot and POSTs it to the configured API(s)."""

    def __init__(
        self,
        hass: HomeAssistant,
        buffer: ExportBuffer,
        endpoints: list[str],
        token: str,
        *,
        verify_ssl: bool = True,
        instance_id_provider: Callable[[], str] | None = None,
        energy_prefs_provider: Callable[[], dict[str, Any] | None] = None,
    ) -> None:
        if not endpoints:
            raise ValueError("at least one endpoint is required")
        self._hass = hass
        self._buffer = buffer
        self._endpoints = [e.rstrip("/") for e in endpoints]
        self._token = token
        self._verify_ssl = verify_ssl
        self._instance_id = instance_id_provider
        self._energy_prefs = energy_prefs_provider
        self._push_lock = asyncio.Lock()
        self._backoff = MIN_BACKOFF
        self._failing = False

    @property
    def url(self) -> str:
        """Primary ingest URL (first configured base)."""
        return _ingest_url(self._endpoints[0])

    def _instance_delete_url(self, base: str, *, full: bool) -> str | None:
        inst = self._instance_id() if self._instance_id else None
        if not inst:
            return None
        url = f"{base.rstrip('/')}/instances/{inst}"
        if full:
            url = f"{url}?full=1"
        return url

    def update_credentials(
        self, endpoints: list[str], token: str, *, verify_ssl: bool = True
    ) -> None:
        if not endpoints:
            raise ValueError("at least one endpoint is required")
        self._endpoints = [e.rstrip("/") for e in endpoints]
        self._token = token
        self._verify_ssl = verify_ssl
        self._backoff = MIN_BACKOFF
        self._failing = False

    async def _post_same_payload_to_mirrors(
        self, session: aiohttp.ClientSession, body: bytes, headers: dict[str, str]
    ) -> None:
        for base in self._endpoints[1:]:
            url = _ingest_url(base)
            try:
                async with session.post(
                    url,
                    data=body,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    st = resp.status
                    if 200 <= st < 300:
                        _LOGGER.debug("%s: mirror push OK: %s", DOMAIN, url)
                    else:
                        text = (await resp.text())[:200]
                        _LOGGER.warning(
                            "%s: mirror push at %s got HTTP %d: %s",
                            DOMAIN,
                            url,
                            st,
                            text,
                        )
            except (asyncio.TimeoutError, ClientError) as err:
                _LOGGER.warning(
                    "%s: mirror push failed for %s: %s", DOMAIN, url, err
                )

    async def async_push(self) -> bool:
        """Attempt a single push.

        Returns True if anything was sent (or nothing to send). Returns False
        only when a **retryable** failure occurred on the **primary** endpoint;
        caller can apply backoff. Optional mirror endpoints are best-effort only
        (errors are logged, they never block acks or back off the queue).
        """
        async with self._push_lock:
            states, stats = self._buffer.snapshot()
            prefs = self._energy_prefs() if self._energy_prefs else None
            if not states and not stats and prefs is None:
                return True

            states_batch = states[:DEFAULT_BATCH_SIZE] if states else []
            stats_batch = stats[:DEFAULT_BATCH_SIZE] if stats else []

            payload: dict[str, Any] = {
                "schema_version": 1,
                "instance_id": self._instance_id() if self._instance_id else None,
                "ha_version": HA_VERSION,
                "sent_at": dt_util.utcnow().isoformat(),
                "statistics": stats_batch,
                "states": states_batch,
            }
            if prefs is not None:
                payload["energy_prefs"] = prefs

            loc = getattr(self._hass.config, "location_name", None)
            if isinstance(loc, str) and loc.strip():
                payload["location_name"] = loc.strip()

            body = json.dumps(payload, default=str).encode("utf-8")
            headers = {
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "User-Agent": f"{DOMAIN}/0.1 HomeAssistant/{HA_VERSION}",
            }
            if len(body) > GZIP_THRESHOLD:
                body = gzip.compress(body)
                headers["Content-Encoding"] = "gzip"

            session = async_get_clientsession(self._hass, verify_ssl=self._verify_ssl)
            primary_ingest = _ingest_url(self._endpoints[0])
            try:
                async with session.post(
                    primary_ingest,
                    data=body,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    status = resp.status
                    if 200 <= status < 300:
                        self._buffer.ack(len(states_batch), len(stats_batch))
                        await self._buffer.async_flush()
                        self._backoff = MIN_BACKOFF
                        self._failing = False
                        self._hass.bus.async_fire(
                            EVENT_PUSHED,
                            {
                                "states": len(states_batch),
                                "statistics": len(stats_batch),
                                "status": status,
                            },
                        )
                        if self._endpoints[1:]:
                            await self._post_same_payload_to_mirrors(
                                session, body, headers
                            )
                        if states_batch or stats_batch:
                            _LOGGER.info(
                                "%s: pushed %d states + %d stats to %s (HTTP %d)",
                                DOMAIN,
                                len(states_batch),
                                len(stats_batch),
                                primary_ingest,
                                status,
                            )
                        else:
                            _LOGGER.info(
                                "%s: pushed prefs-only to %s (HTTP %d) to "
                                "re-register after an empty buffer",
                                DOMAIN,
                                primary_ingest,
                                status,
                            )
                        return True

                    if status in _RETRYABLE_STATUS:
                        text = await resp.text()
                        _LOGGER.warning(
                            "%s: push got retryable HTTP %d: %s",
                            DOMAIN,
                            status,
                            text[:200],
                        )
                        self._failing = True
                        return False

                    text = await resp.text()
                    _LOGGER.error(
                        "%s: push got non-retryable HTTP %d, dropping batch: %s",
                        DOMAIN,
                        status,
                        text[:200],
                    )
                    self._buffer.ack(len(states_batch), len(stats_batch))
                    await self._buffer.async_flush()
                    return True

            except (asyncio.TimeoutError, ClientError) as err:
                _LOGGER.warning("%s: push network error: %s", DOMAIN, err)
                self._failing = True
                return False

    async def async_push_with_backoff(self) -> None:
        """Try one push; if it fails, sleep the current backoff."""
        ok = await self.async_push()
        if ok:
            return
        delay = self._backoff
        self._backoff = min(self._backoff * BACKOFF_FACTOR, MAX_BACKOFF)
        _LOGGER.debug("%s: backing off %.1fs", DOMAIN, delay)
        await asyncio.sleep(delay)

    async def async_push_until_empty(self, *, max_iters: int = 20) -> None:
        """Push repeatedly until the buffer is empty or we hit a failure/cap."""
        for _ in range(max_iters):
            if self._buffer.is_empty():
                return
            ok = await self.async_push()
            if not ok:
                return

    async def async_delete_instance_data(self, *, full: bool = False) -> dict[str, int]:
        """Tell the server(s) to wipe stored time-series for this HA instance.

        The **primary** endpoint must return 2xx or this raises. Optional
        mirrors are best-effort: failures are logged as warnings.
        """
        headers = {
            "Authorization": f"Bearer {self._token}",
            "User-Agent": f"{DOMAIN}/0.1 HomeAssistant/{HA_VERSION}",
        }
        session = async_get_clientsession(self._hass, verify_ssl=self._verify_ssl)
        primary_deleted: dict[str, int] = {}

        for i, base in enumerate(self._endpoints):
            del_url = self._instance_delete_url(base, full=full)
            if not del_url:
                if i == 0:
                    raise RuntimeError("instance_id not yet available")
                continue
            try:
                async with session.delete(
                    del_url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    text = await resp.text()
                    if 200 <= resp.status < 300:
                        if i == 0:
                            try:
                                payload = json.loads(text) if text else {}
                            except json.JSONDecodeError:
                                payload = {}
                            primary_deleted = (
                                payload.get("deleted", {})
                                if isinstance(payload, dict)
                                else {}
                            )
                            _LOGGER.info(
                                "%s: remote wipe OK: %s: %s",
                                DOMAIN,
                                del_url,
                                primary_deleted,
                            )
                        else:
                            _LOGGER.info(
                                "%s: remote mirror wipe OK: %s", DOMAIN, del_url
                            )
                    elif i == 0:
                        _LOGGER.error(
                            "%s: remote wipe got HTTP %d: %s",
                            DOMAIN,
                            resp.status,
                            text[:200],
                        )
                        raise RuntimeError(f"remote wipe failed: HTTP {resp.status}")
                    else:
                        _LOGGER.warning(
                            "%s: remote wipe on mirror %s: HTTP %d: %s",
                            DOMAIN,
                            del_url,
                            resp.status,
                            text[:200],
                        )
            except (asyncio.TimeoutError, ClientError) as err:
                if i == 0:
                    _LOGGER.error("%s: remote wipe error: %s", DOMAIN, err)
                    raise RuntimeError(f"remote wipe failed: {err}") from err
                _LOGGER.warning(
                    "%s: remote wipe on mirror %s: %s", DOMAIN, del_url, err
                )
        return primary_deleted
