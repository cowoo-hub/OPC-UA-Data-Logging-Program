"""Configuration helpers for selecting real or simulator runtime defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from modbus_core import BackendMode, DEFAULT_PAYLOAD_WORD_COUNT, PDIBlockMode


def _read_bool_env(name: str, default: bool) -> bool:
    """Parse common truthy/falsy environment variable values."""
    raw_value = os.getenv(name)

    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()

    if normalized in {"1", "true", "yes", "on"}:
        return True

    if normalized in {"0", "false", "no", "off"}:
        return False

    return default


def _read_int_env(
    name: str,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """Parse integer environment values with safe bounds."""
    raw_value = os.getenv(name)

    if raw_value is None:
        value = default
    else:
        try:
            value = int(raw_value.strip())
        except ValueError:
            value = default

    if minimum is not None:
        value = max(minimum, value)

    if maximum is not None:
        value = min(maximum, value)

    return value


def _read_float_env(
    name: str,
    default: float,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    """Parse float environment values with optional bounds."""
    raw_value = os.getenv(name)

    if raw_value is None:
        value = default
    else:
        try:
            value = float(raw_value.strip())
        except ValueError:
            value = default

    if minimum is not None:
        value = max(minimum, value)

    if maximum is not None:
        value = min(maximum, value)

    return value


def _read_optional_str_env(name: str) -> str | None:
    """Read optional string settings and normalize empty values to None."""
    raw_value = os.getenv(name)

    if raw_value is None:
        return None

    trimmed = raw_value.strip()
    return trimmed or None


def _read_block_mode_env(name: str, default: PDIBlockMode) -> PDIBlockMode:
    """Limit block mode configuration to the supported ICE2 values."""
    raw_value = os.getenv(name)

    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in {"multiple", "specific"}:
        return normalized

    return default


def _read_mode_env(name: str, default: BackendMode) -> BackendMode:
    """Parse the default backend runtime mode."""
    raw_value = os.getenv(name)

    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in {"real", "simulator"}:
        return normalized

    return default


def _read_http_scheme_env(name: str, default: str) -> str:
    """Restrict HTTP scheme values to http or https."""
    raw_value = os.getenv(name)

    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in {"http", "https"}:
        return normalized

    return default


def _read_choice_env(name: str, default: str, allowed: set[str]) -> str:
    raw_value = os.getenv(name)

    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in allowed:
        return normalized

    return default


@dataclass(slots=True)
class AppSettings:
    """
    Runtime settings for the backend.

    Real-device-first mode is now the default. Simulator mode remains available
    as an explicit fallback for development and recovery work.
    """

    default_mode: BackendMode = "real"
    poll_interval_ms: int = 20
    stale_after_ms: int = 250
    reconnect_base_ms: int = 250
    reconnect_max_ms: int = 5000
    history_retention_ms: int = 3600000
    history_max_points: int = 240
    history_sample_interval_ms: int = 100
    payload_word_count: int = DEFAULT_PAYLOAD_WORD_COUNT
    block_mode: PDIBlockMode = "multiple"
    isdu_http_scheme: str = "http"
    isdu_http_port: int = 80
    isdu_timeout_seconds: float = 5.0
    isdu_http_username: str | None = None
    isdu_http_password: str | None = None
    iodd_library_dir: str = str(Path(__file__).resolve().parent / "data" / "iodd_library")
    opcua_enabled: bool = False
    opcua_host: str = "0.0.0.0"
    opcua_port: int = 4840
    opcua_path: str = "masterway"
    opcua_namespace_uri: str = "urn:masterway:opcua"
    opcua_server_name: str = "Masterway OPC UA Server"
    opcua_security_mode: str = "none"
    opcua_anonymous: bool = True
    opcua_writable: bool = False
    runtime_settings_file: str = str(
        Path(__file__).resolve().parent / "data" / "runtime_settings.local.json"
    )

    @property
    def backend_mode(self) -> str:
        return self.default_mode

    @property
    def use_simulator(self) -> bool:
        """Backward-compatible view for older helper code."""
        return self.default_mode == "simulator"


def load_settings() -> AppSettings:
    """Load settings from environment variables."""
    poll_interval_ms = _read_int_env(
        "PDI_POLL_INTERVAL_MS",
        default=20,
        minimum=10,
    )

    default_mode = _read_mode_env(
        "ICE2_DEFAULT_MODE",
        default="simulator" if _read_bool_env("USE_SIMULATOR", default=False) else "real",
    )

    return AppSettings(
        default_mode=default_mode,
        poll_interval_ms=poll_interval_ms,
        stale_after_ms=_read_int_env(
            "PDI_STALE_AFTER_MS",
            default=max(250, poll_interval_ms * 4),
            minimum=poll_interval_ms,
        ),
        reconnect_base_ms=_read_int_env(
            "PDI_RECONNECT_BASE_MS",
            default=max(250, poll_interval_ms * 5),
            minimum=poll_interval_ms,
        ),
        reconnect_max_ms=_read_int_env(
            "PDI_RECONNECT_MAX_MS",
            default=5000,
            minimum=max(250, poll_interval_ms * 5),
        ),
        history_retention_ms=_read_int_env(
            "PDI_HISTORY_RETENTION_MS",
            default=3600000,
            minimum=max(5000, poll_interval_ms * 20),
        ),
        history_max_points=_read_int_env(
            "PDI_HISTORY_MAX_POINTS",
            default=240,
            minimum=10,
            maximum=1000,
        ),
        history_sample_interval_ms=_read_int_env(
            "PDI_HISTORY_SAMPLE_INTERVAL_MS",
            default=max(100, poll_interval_ms * 5),
            minimum=max(poll_interval_ms, 20),
        ),
        payload_word_count=_read_int_env(
            "PDI_PAYLOAD_WORD_COUNT",
            default=DEFAULT_PAYLOAD_WORD_COUNT,
            minimum=0,
            maximum=123,
        ),
        block_mode=_read_block_mode_env("PDI_BLOCK_MODE", default="multiple"),
        isdu_http_scheme=_read_http_scheme_env("ICE2_ISDU_HTTP_SCHEME", default="http"),
        isdu_http_port=_read_int_env(
            "ICE2_ISDU_HTTP_PORT",
            default=80,
            minimum=1,
            maximum=65535,
        ),
        isdu_timeout_seconds=_read_float_env(
            "ICE2_ISDU_TIMEOUT_SECONDS",
            default=5.0,
            minimum=0.5,
            maximum=60.0,
        ),
        isdu_http_username=_read_optional_str_env("ICE2_ISDU_HTTP_USERNAME"),
        isdu_http_password=_read_optional_str_env("ICE2_ISDU_HTTP_PASSWORD"),
        iodd_library_dir=(
            _read_optional_str_env("IODD_LIBRARY_DIR")
            or str(Path(__file__).resolve().parent / "data" / "iodd_library")
        ),
        opcua_enabled=_read_bool_env("OPCUA_ENABLED", default=False),
        opcua_host=_read_optional_str_env("OPCUA_HOST") or "0.0.0.0",
        opcua_port=_read_int_env("OPCUA_PORT", default=4840, minimum=1, maximum=65535),
        opcua_path=_read_optional_str_env("OPCUA_PATH") or "masterway",
        opcua_namespace_uri=_read_optional_str_env("OPCUA_NAMESPACE_URI") or "urn:masterway:opcua",
        opcua_server_name=_read_optional_str_env("OPCUA_SERVER_NAME") or "Masterway OPC UA Server",
        opcua_security_mode=_read_choice_env("OPCUA_SECURITY_MODE", default="none", allowed={"none"}),
        opcua_anonymous=_read_bool_env("OPCUA_ANONYMOUS", default=True),
        opcua_writable=_read_bool_env("OPCUA_WRITABLE", default=False),
        runtime_settings_file=(
            _read_optional_str_env("MASTERWAY_RUNTIME_SETTINGS_FILE")
            or str(Path(__file__).resolve().parent / "data" / "runtime_settings.local.json")
        ),
    )
