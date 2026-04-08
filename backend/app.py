"""FastAPI entry point for high-speed cached ICE2 IO-Link monitoring."""
from __future__ import annotations

import importlib.util
import logging
import os
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile as StarletteUploadFile

from config import AppSettings, load_settings
from converters import SupportedDataType, WordOrder, convert_register_value, registers_to_bytes
from history_export import (
    HistoryExportConfig,
    build_export_filename,
    build_custom_export_filename,
    build_history_csv,
    filter_history_samples_by_time,
    format_display_timestamp,
    parse_export_range,
    parse_export_time_bounds,
    parse_sentinel_mapping_entries,
)
from iodd_library import IODDLibraryService
from isdu_service import (
    create_isdu_service,
    validate_isdu_index,
    validate_isdu_subindex,
)
from modbus_core import (
    BackendMode,
    HEADER_WORD_COUNT,
    ICE2Backend,
    ICE2ModbusClient,
    ModbusConnectionConfig,
    PDIBlockMode,
    build_port_pdi_base0_address,
    build_port_pdi_base1_address,
    parse_pdi_header,
    validate_port,
)
from polling import PDICacheWorker
from simulator import ICE2Simulator

logger = logging.getLogger("ice2.backend.app")
_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_FRONTEND_DIST_DIR = (_BACKEND_DIR.parent / "frontend" / "dist").resolve()


def _read_dependency_version(package_name: str) -> str:
    try:
        return version(package_name)
    except PackageNotFoundError:
        return "missing"


def _build_dependency_report() -> dict[str, str]:
    return {
        "fastapi": _read_dependency_version("fastapi"),
        "uvicorn": _read_dependency_version("uvicorn"),
        "pymodbus": _read_dependency_version("pymodbus"),
        "python_multipart": _read_dependency_version("python-multipart"),
    }


def _is_multipart_available() -> bool:
    if importlib.util.find_spec("multipart") is None:
        return False

    try:
        import multipart  # type: ignore
    except Exception:
        return False

    return True


def _log_runtime_dependency_status() -> None:
    dependency_report = _build_dependency_report()
    multipart_available = _is_multipart_available()
    logger.info(
        "Backend dependency status: fastapi=%s uvicorn=%s pymodbus=%s python_multipart=%s multipart_available=%s",
        dependency_report["fastapi"],
        dependency_report["uvicorn"],
        dependency_report["pymodbus"],
        dependency_report["python_multipart"],
        multipart_available,
    )

    if not multipart_available:
        logger.warning(
            "IODD upload route is running in degraded mode because python-multipart is not installed. "
            "Core Modbus polling remains available; install backend/requirements.txt to enable XML upload."
        )


def _get_frontend_dist_dir() -> Path | None:
    configured_dist_dir = os.getenv("FRONTEND_DIST_DIR")
    candidates = [
        Path(configured_dist_dir).expanduser() if configured_dist_dir else None,
        _REPO_FRONTEND_DIST_DIR,
    ]

    for candidate in candidates:
        if candidate is None:
            continue

        resolved_candidate = candidate.resolve()
        index_path = resolved_candidate / "index.html"
        if resolved_candidate.is_dir() and index_path.is_file():
            return resolved_candidate

    return None


def _resolve_frontend_asset(frontend_path: str) -> Path | None:
    frontend_dist_dir = _get_frontend_dist_dir()
    if frontend_dist_dir is None:
        return None

    normalized_path = frontend_path.strip().lstrip("/")
    index_path = frontend_dist_dir / "index.html"

    if not normalized_path:
        return index_path if index_path.is_file() else None

    relative_path = Path(normalized_path)
    if any(part in {"", ".", ".."} for part in relative_path.parts):
        return None

    candidate_path = (frontend_dist_dir / relative_path).resolve()

    try:
        candidate_path.relative_to(frontend_dist_dir)
    except ValueError:
        return None

    if candidate_path.is_file():
        return candidate_path

    if "." not in relative_path.name and index_path.is_file():
        return index_path

    return None


class ConnectRequest(BaseModel):
    """Connection settings stored as the default local development target."""

    mode: BackendMode = Field(
        "real",
        description="Backend runtime mode: real Modbus TCP or simulator fallback",
    )
    host: str = Field(..., description="ICE2 IP address or hostname")
    port: int = Field(502, ge=1, le=65535, description="Modbus TCP port")
    slave_id: int = Field(1, ge=0, le=255, description="Modbus unit/slave ID")
    timeout: float = Field(3.0, gt=0, description="Request timeout in seconds")
    retries: int = Field(1, ge=0, description="PyModbus retry count")


class ConvertRequest(BaseModel):
    """Ad-hoc payload conversion request for quick testing from Swagger or VS Code."""

    registers: list[int] = Field(..., min_length=1, description="Raw 16-bit registers to decode")
    data_type: SupportedDataType
    word_offset: int = Field(0, ge=0, description="Starting register offset")
    word_length: int | None = Field(
        None,
        ge=1,
        description="Optional register length for binary conversion",
    )
    word_order: WordOrder = Field(
        "big",
        description="Use little for devices that publish 32-bit values in swapped register order",
    )


class ISDUReadRequest(BaseModel):
    """Read a single ISDU parameter from the currently configured ICE2 target."""

    port: int = Field(..., ge=1, le=8, description="1-based IO-Link port number")
    index: int = Field(..., ge=0, le=65535, description="ISDU index")
    subindex: int = Field(0, ge=0, le=255, description="ISDU subindex")


class ISDUWriteRequest(BaseModel):
    """Write a single ISDU parameter to the currently configured ICE2 target."""

    port: int = Field(..., ge=1, le=8, description="1-based IO-Link port number")
    index: int = Field(..., ge=0, le=65535, description="ISDU index")
    subindex: int = Field(0, ge=0, le=255, description="ISDU subindex")
    data_hex: str = Field(
        ...,
        min_length=1,
        description="Whitespace-delimited hex payload bytes, for example '12 34 AB'",
    )


def _create_backend(connection: ModbusConnectionConfig) -> ICE2Backend:
    """
    Create the active ICE2 backend.

    The polling worker and API layer both call only this factory so simulator
    mode and future real hardware mode stay interchangeable.
    """
    if connection.mode == "simulator":
        return ICE2Simulator(connection)
    return ICE2ModbusClient(connection)


def _build_pdi_response(
    connection: ModbusConnectionConfig,
    port: int,
    block_mode: PDIBlockMode,
    payload_word_count: int,
    registers: list[int],
    convert_as: SupportedDataType | None = None,
    word_offset: int = 0,
    word_length: int | None = None,
    word_order: WordOrder = "big",
) -> dict[str, object]:
    """Parse a raw PDI register block into the response shape used by the API."""
    header = parse_pdi_header(registers)
    payload_words = registers[HEADER_WORD_COUNT:]
    payload_bytes = registers_to_bytes(payload_words)

    response: dict[str, object] = {
        "connection": connection.to_dict(),
        "port": port,
        "pdi_block": {
            "mode": block_mode,
            "base1_address": build_port_pdi_base1_address(port=port, block_mode=block_mode),
            "base0_address": build_port_pdi_base0_address(port=port, block_mode=block_mode),
            "header_word_count": HEADER_WORD_COUNT,
            "payload_word_count": payload_word_count,
            "total_word_count": len(registers),
        },
        "header": header,
        "payload": {
            "registers": payload_words,
            "hex": payload_bytes.hex(" ").upper(),
        },
    }

    if convert_as is not None:
        response["conversion"] = {
            "data_type": convert_as,
            "word_offset": word_offset,
            "word_length": word_length,
            "word_order": word_order,
            "value": convert_register_value(
                payload_words,
                data_type=convert_as,
                word_offset=word_offset,
                word_length=word_length,
                word_order=word_order,
            ),
        }

    return response


def _build_cached_port_snapshot(
    connection: ModbusConnectionConfig,
    port: int,
    block_mode: PDIBlockMode,
    payload_word_count: int,
    registers: list[int],
) -> dict[str, object]:
    """Polling-worker adapter for storing parsed snapshots without conversions."""
    return _build_pdi_response(
        connection=connection,
        port=port,
        block_mode=block_mode,
        payload_word_count=payload_word_count,
        registers=registers,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start and stop the shared background polling worker with the app."""
    settings = load_settings()
    _log_runtime_dependency_status()
    logger.info(
        "Backend startup configuration: default_mode=%s poll_interval_ms=%s stale_after_ms=%s history_retention_ms=%s block_mode=%s payload_word_count=%s iodd_library_dir=%s",
        settings.default_mode,
        settings.poll_interval_ms,
        settings.stale_after_ms,
        settings.history_retention_ms,
        settings.block_mode,
        settings.payload_word_count,
        settings.iodd_library_dir,
    )
    app.state.settings = settings
    app.state.connection_config = None
    app.state.iodd_library = IODDLibraryService(Path(settings.iodd_library_dir))
    app.state.polling_worker = PDICacheWorker(
        backend_factory=_create_backend,
        snapshot_builder=_build_cached_port_snapshot,
        default_mode=settings.default_mode,
        poll_interval_ms=settings.poll_interval_ms,
        stale_after_ms=settings.stale_after_ms,
        reconnect_base_ms=settings.reconnect_base_ms,
        reconnect_max_ms=settings.reconnect_max_ms,
        history_retention_ms=settings.history_retention_ms,
        history_max_points=settings.history_max_points,
        history_sample_interval_ms=settings.history_sample_interval_ms,
        payload_word_count=settings.payload_word_count,
        block_mode=settings.block_mode,
    )
    app.state.polling_worker.start()

    try:
        yield
    finally:
        app.state.polling_worker.stop()


app = FastAPI(
    title="ICE2 IO-Link Master Backend",
    version="0.3.0",
    lifespan=lifespan,
    description=(
        "High-speed cached FastAPI backend for ICE2 IO-Link PDI monitoring. "
        "The backend now polls simulator or Modbus TCP data in the background, "
        "stores the latest parsed state in memory, and serves both single-port "
        "and all-port views from cache for responsive industrial UI updates."
    ),
)


@app.middleware("http")
async def api_prefix_compatibility_middleware(request: Request, call_next):
    """Allow the production frontend to keep calling `/api/*` without changing backend routes."""
    request_path = request.scope.get("path", "")
    if request_path.startswith("/api/"):
        stripped_path = request_path[4:] or "/"
        request.scope["path"] = stripped_path
        request.scope["raw_path"] = stripped_path.encode("utf-8")

    return await call_next(request)


def _get_settings() -> AppSettings:
    return app.state.settings


def _get_runtime_mode() -> BackendMode:
    connection = app.state.connection_config
    if connection is not None:
        return connection.mode
    return _get_settings().default_mode


def _get_saved_connection() -> ModbusConnectionConfig:
    config = app.state.connection_config
    if config is None:
        raise HTTPException(
            status_code=400,
            detail="No ICE2 target is configured. Call POST /connect first.",
        )
    return config


def _get_cached_port_or_raise(port: int) -> dict[str, object]:
    validate_port(port)
    cached_snapshot = app.state.polling_worker.get_port_snapshot(port)

    if cached_snapshot is not None:
        return cached_snapshot

    _get_saved_connection()
    raise HTTPException(
        status_code=503,
        detail="Cached PDI data is not ready yet. Wait for the background poller to complete its first cycle.",
    )


def _validate_cache_shape(
    payload_word_count: int,
    block_mode: PDIBlockMode,
) -> None:
    settings = _get_settings()

    if payload_word_count != settings.payload_word_count:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cached polling is configured for "
                f"payload_word_count={settings.payload_word_count}. "
                "Adjust PDI_PAYLOAD_WORD_COUNT and restart the backend to change it."
            ),
        )

    if block_mode != settings.block_mode:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cached polling is configured for block_mode='{settings.block_mode}'. "
                "Adjust PDI_BLOCK_MODE and restart the backend to change it."
            ),
        )


@app.get("/")
def root() -> dict[str, object]:
    """Small landing response so local development starts with a friendly summary."""
    frontend_index = _resolve_frontend_asset("")
    if frontend_index is not None:
        return FileResponse(frontend_index)

    settings = _get_settings()
    polling = app.state.polling_worker.get_status()

    return {
        "service": "ICE2 IO-Link Master Backend",
        "phase": "2",
        "backend_mode": _get_runtime_mode(),
        "default_mode": settings.default_mode,
        "use_simulator": settings.use_simulator,
        "polling": polling.to_dict(),
        "docs": "/docs",
        "features_ready_now": [
            "Background PDI polling cache",
            "Bulk cached all-port PDI reads",
            "Bulk cached all-port history reads",
            "Single-port cached PDI access",
            "Real and simulator ISDU reads and writes",
            "IODD upload and parsed device-profile library",
            "Header parsing and value conversion",
        ],
        "future_ready_for": [
            "MQTT publishing",
            "AI diagnostics",
            "Industrial UI",
        ],
    }


@app.get("/health")
def health() -> dict[str, object]:
    """Basic health endpoint for local checks and future container probes."""
    settings = _get_settings()
    polling = app.state.polling_worker.get_status()
    dependency_report = _build_dependency_report()
    multipart_available = _is_multipart_available()

    return {
        "status": "ok",
        "phase": "2",
        "backend_mode": _get_runtime_mode(),
        "default_mode": settings.default_mode,
        "poll_interval_ms": settings.poll_interval_ms,
        "stale_after_ms": settings.stale_after_ms,
        "reconnect_base_ms": settings.reconnect_base_ms,
        "reconnect_max_ms": settings.reconnect_max_ms,
        "history_retention_ms": settings.history_retention_ms,
        "history_max_points": settings.history_max_points,
        "history_sample_interval_ms": settings.history_sample_interval_ms,
        "isdu_http_scheme": settings.isdu_http_scheme,
        "isdu_http_port": settings.isdu_http_port,
        "isdu_timeout_seconds": settings.isdu_timeout_seconds,
        "isdu_uses_basic_auth": bool(settings.isdu_http_username),
        "iodd_library_dir": settings.iodd_library_dir,
        "frontend_dist_dir": str(_get_frontend_dist_dir()) if _get_frontend_dist_dir() else None,
        "frontend_assets_available": _get_frontend_dist_dir() is not None,
        "iodd_upload_enabled": multipart_available,
        "dependencies": dependency_report,
        "cache_running": polling.running,
        "cache_updated_at": polling.updated_at,
        "last_successful_poll_at": polling.last_successful_poll_at,
        "cache_is_stale": polling.is_stale,
        "communication_state": polling.communication_state,
        "last_error": polling.last_error,
    }


@app.get("/iodd/library")
def read_iodd_library() -> dict[str, object]:
    """Return the locally stored parsed IODD library."""
    profiles = app.state.iodd_library.list_profiles()
    return {
        "count": len(profiles),
        "profiles": profiles,
    }


@app.get("/iodd/library/{profile_id}")
def read_iodd_profile(profile_id: str) -> dict[str, object]:
    """Return one parsed IODD profile."""
    profile = app.state.iodd_library.get_profile(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="IODD profile not found.")

    return profile


@app.post("/iodd/library/upload")
async def upload_iodd_profile(request: Request) -> dict[str, object]:
    """Upload, parse, and store one XML IODD file locally."""
    if not _is_multipart_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "IODD upload is unavailable because python-multipart is not installed in the backend environment. "
                "Install backend/requirements.txt to enable XML upload."
            ),
        )

    try:
        form_data = await request.form()
    except Exception as exc:
        logger.warning("IODD upload multipart parsing failed: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="Could not parse multipart form data for the uploaded IODD file.",
        ) from exc

    uploaded_file = form_data.get("file")
    if not isinstance(uploaded_file, StarletteUploadFile):
        raise HTTPException(
            status_code=400,
            detail="No IODD XML file was provided in the multipart request.",
        )

    file_name = uploaded_file.filename or "uploaded-iodd.xml"
    file_bytes = await uploaded_file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded IODD file is empty.")

    logger.info("Received IODD upload: file=%s bytes=%s", file_name, len(file_bytes))

    try:
        profile = app.state.iodd_library.save_uploaded_xml(
            file_name=file_name,
            xml_bytes=file_bytes,
        )
    except ValueError as exc:
        logger.warning("IODD upload failed for file=%s: %s", file_name, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected IODD upload failure for file=%s", file_name)
        raise HTTPException(status_code=500, detail=f"Unexpected IODD upload failure: {exc}") from exc

    return {
        "uploaded": True,
        "profile": profile,
        "count": len(app.state.iodd_library.list_profiles()),
    }


@app.get("/connection")
def get_connection() -> dict[str, object]:
    """Return the currently saved local development target."""
    config = app.state.connection_config
    polling = app.state.polling_worker.get_status()
    return {
        "configured": config is not None,
        "connection": None if config is None else config.to_dict(),
        "polling": polling.to_dict(),
    }


@app.post("/connect")
def connect_to_ice2(request: ConnectRequest) -> dict[str, object]:
    """
    Validate connectivity and store the default ICE2 target.

    The background poller takes over once the target is saved, which separates
    fast device reads from slower UI refreshes.
    """
    connection = ModbusConnectionConfig(**request.model_dump())
    logger.info(
        "Received connect request: mode=%s host=%s port=%s slave_id=%s timeout=%s retries=%s",
        connection.mode,
        connection.host,
        connection.port,
        connection.slave_id,
        connection.timeout,
        connection.retries,
    )

    try:
        with _create_backend(connection):
            pass
    except ConnectionError as exc:
        logger.warning(
            "Connect failed for mode=%s host=%s port=%s: %s",
            connection.mode,
            connection.host,
            connection.port,
            exc,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected connect failure for mode=%s host=%s",
            connection.mode,
            connection.host,
        )
        raise HTTPException(status_code=500, detail=f"Unexpected connect failure: {exc}") from exc

    app.state.connection_config = connection
    app.state.polling_worker.update_connection(connection)
    polling_status = app.state.polling_worker.get_status()
    logger.info(
        "Connect succeeded: mode=%s host=%s port=%s slave_id=%s",
        connection.mode,
        connection.host,
        connection.port,
        connection.slave_id,
    )
    logger.info(
        "Active target stored after connect: configured=%s running=%s communication_state=%s has_snapshot=%s next_retry_at=%s",
        polling_status.configured,
        polling_status.running,
        polling_status.communication_state,
        polling_status.has_snapshot,
        polling_status.next_retry_at,
    )

    return {
        "connected": True,
        "message": (
            "Simulator session is ready and the high-speed polling cache is warming up."
            if connection.mode == "simulator"
            else "Connection test succeeded and the high-speed polling cache is warming up."
        ),
        "connection": connection.to_dict(),
    }


@app.post("/disconnect")
def disconnect_target() -> dict[str, object]:
    """Clear the saved target and stop background polling for intentional disconnects."""
    previous_connection = app.state.connection_config

    app.state.connection_config = None
    app.state.polling_worker.update_connection(None)

    if previous_connection is None:
        logger.info("Disconnect requested with no active target configured")
        return {
            "disconnected": True,
            "message": "No active target was configured. The polling worker remains idle.",
            "connection": None,
        }

    logger.info(
        "Disconnect succeeded: mode=%s host=%s port=%s slave_id=%s",
        previous_connection.mode,
        previous_connection.host,
        previous_connection.port,
        previous_connection.slave_id,
    )
    return {
        "disconnected": True,
        "message": "The active ICE2 target was cleared and the background polling worker has been idled.",
        "connection": previous_connection.to_dict(),
    }


@app.get("/ports/all/pdi")
def read_all_ports_pdi() -> dict[str, object]:
    """Return the latest cached PDI snapshot for all ports."""
    return app.state.polling_worker.get_all_ports_snapshot()


@app.get("/ports/all/history")
def read_all_ports_history(
    window_ms: int | None = Query(
        None,
        ge=1000,
        description="Optional rolling history window in milliseconds",
    ),
    max_points: int | None = Query(
        None,
        ge=10,
        le=1000,
        description="Optional cap for returned samples per port",
    ),
) -> dict[str, object]:
    """Return cached rolling history for all ports."""
    return app.state.polling_worker.get_all_ports_history(
        window_ms=window_ms,
        max_points=max_points,
    )


@app.get("/ports/{port}/pdi")
def read_port_pdi(
    port: int,
    payload_word_count: int = Query(
        16,
        ge=0,
        le=123,
        description="Number of payload registers to read after the fixed two-word header",
    ),
    block_mode: Literal["multiple", "specific"] = Query(
        "multiple",
        description="ICE2 Modbus PDI block address flavor",
    ),
    convert_as: SupportedDataType | None = Query(
        None,
        description="Optional payload conversion type",
    ),
    word_offset: int = Query(0, ge=0, description="Payload register offset for conversion"),
    word_length: int | None = Query(
        None,
        ge=1,
        description="Optional register length for binary conversion",
    ),
    word_order: WordOrder = Query(
        "big",
        description="Register order for 32-bit or binary payload conversion",
    ),
) -> dict[str, object]:
    """
    Return the cached port PDI block, parse the header, and optionally decode a value.

    This route now serves from the in-memory polling cache instead of triggering
    a fresh device read on each request.
    """
    _validate_cache_shape(payload_word_count=payload_word_count, block_mode=block_mode)
    cached_snapshot = _get_cached_port_or_raise(port)

    if convert_as is None:
        return cached_snapshot

    try:
        payload_words = cached_snapshot["payload"]["registers"]
        if not isinstance(payload_words, list):
            raise ValueError("Cached payload registers are unavailable")

        cached_snapshot["conversion"] = {
            "data_type": convert_as,
            "word_offset": word_offset,
            "word_length": word_length,
            "word_order": word_order,
            "value": convert_register_value(
                payload_words,
                data_type=convert_as,
                word_offset=word_offset,
                word_length=word_length,
                word_order=word_order,
            ),
        }
        return cached_snapshot
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/ports/{port}/history")
def read_port_history(
    port: int,
    window_ms: int | None = Query(
        None,
        ge=1000,
        description="Optional rolling history window in milliseconds",
    ),
    max_points: int | None = Query(
        None,
        ge=10,
        le=1000,
        description="Optional cap for returned samples",
    ),
) -> dict[str, object]:
    """Return cached rolling history for one port."""
    validate_port(port)
    return app.state.polling_worker.get_port_history(
        port=port,
        window_ms=window_ms,
        max_points=max_points,
    )


@app.get("/ports/{port}/history/export")
def export_port_history_csv(
    port: int,
    range_label: str | None = Query(
        None,
        alias="range",
        description="Cached export range: 30s, 2min, 10min, 15min, 30min, or 1h",
    ),
    start: str | None = Query(
        None,
        description="Inclusive custom export start timestamp in ISO 8601 format",
    ),
    end: str | None = Query(
        None,
        description="Inclusive custom export end timestamp in ISO 8601 format",
    ),
    data_type: SupportedDataType = Query(
        ...,
        description="Decode type used to render extracted and scaled values",
    ),
    word_order: WordOrder = Query(
        "big",
        description="Register order for multi-word exported values",
    ),
    byte_order: Literal["big", "little"] = Query(
        "big",
        description="Byte order inside each source register",
    ),
    resolution_factor: float = Query(
        1.0,
        gt=0,
        description="Frontend display resolution factor applied after decoding",
    ),
    source_word_count: int = Query(
        1,
        ge=1,
        le=2,
        description="Number of cached source registers to use for extraction",
    ),
    field_mode: Literal["full_word", "bit_field"] = Query(
        "full_word",
        description="Decode mode for full-word or record bit-field extraction",
    ),
    bit_offset: int = Query(
        0,
        ge=0,
        le=31,
        description="Bit offset for bit-field extraction",
    ),
    bit_length: int = Query(
        16,
        ge=1,
        le=32,
        description="Bit length for bit-field extraction",
    ),
    signed: bool = Query(
        False,
        description="Interpret the extracted field as a signed integer",
    ),
    engineering_unit: str | None = Query(
        None,
        description="Optional engineering unit label carried into the CSV",
    ),
    sentinel_mapping: list[str] = Query(
        default=[],
        description="Repeated value=label mappings such as 16383=No Echo",
    ),
    status: str | None = Query(
        None,
        description="Optional current port severity or state label",
    ),
    event_code: str | None = Query(
        None,
        description="Optional current event code carried into the export",
    ),
    anomaly_state: str | None = Query(
        None,
        description="Optional current diagnostics state carried into the export",
    ),
    time_zone: str | None = Query(
        None,
        description="Optional browser IANA timezone used for CSV timestamp_local formatting",
    ),
    local_utc_offset_minutes: int | None = Query(
        None,
        ge=-720,
        le=840,
        description="Optional browser UTC offset in minutes used when no IANA timezone is available",
    ),
) -> Response:
    """Export cached per-port history as CSV without triggering live device reads."""
    validate_port(port)

    try:
        custom_bounds = parse_export_time_bounds(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if custom_bounds is None:
        try:
            window_ms, normalized_range_label = parse_export_range(range_label or "30s")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        history_response = app.state.polling_worker.get_port_history_for_export(
            port=port,
            window_ms=window_ms,
        )
    else:
        normalized_range_label = None
        history_response = app.state.polling_worker.get_port_history_for_export(
            port=port,
            window_ms=None,
        )

    samples = history_response.get("samples")

    if not isinstance(samples, list):
        raise HTTPException(
            status_code=500,
            detail="Cached history export is unavailable because the history buffer response is invalid.",
        )

    if custom_bounds is not None:
        start_at, end_at = custom_bounds
        filtered_samples, earliest_available, latest_available = filter_history_samples_by_time(
            samples,
            start_at=start_at,
            end_at=end_at,
        )

        if not filtered_samples:
            available_window = ""
            if earliest_available is not None and latest_available is not None:
                available_window = (
                    " Available retained history spans "
                    f"{format_display_timestamp(earliest_available, local_time_zone=time_zone, local_utc_offset_minutes=local_utc_offset_minutes)} "
                    f"to {format_display_timestamp(latest_available, local_time_zone=time_zone, local_utc_offset_minutes=local_utc_offset_minutes)}."
                )

            raise HTTPException(
                status_code=400,
                detail=(
                    "No cached history samples fall within the requested custom export interval."
                    f"{available_window}"
                ),
            )

        samples = filtered_samples

    if bit_offset + bit_length > source_word_count * 16:
        raise HTTPException(
            status_code=400,
            detail="Bit-field range exceeds the selected source_word_count window.",
        )

    export_config = HistoryExportConfig(
        data_type=data_type,
        word_order=word_order,
        byte_order=byte_order,
        resolution_factor=resolution_factor,
        source_word_count=source_word_count,
        field_mode=field_mode,
        bit_offset=bit_offset,
        bit_length=bit_length,
        signed=signed,
        engineering_unit=engineering_unit,
        sentinel_mappings=parse_sentinel_mapping_entries(sentinel_mapping),
        status=status,
        event_code=event_code,
        anomaly_state=anomaly_state,
        local_time_zone=time_zone,
        local_utc_offset_minutes=local_utc_offset_minutes,
    )
    csv_content = build_history_csv(
        port=port,
        samples=samples,
        config=export_config,
    )
    filename = (
        build_export_filename(port=port, range_label=normalized_range_label)
        if normalized_range_label is not None
        else build_custom_export_filename(
            port=port,
            start_at=custom_bounds[0],
            end_at=custom_bounds[1],
        )
    )

    logger.info(
        "Exported cached port history CSV: port=%s range=%s start=%s end=%s samples=%s data_type=%s field_mode=%s",
        port,
        normalized_range_label,
        None if custom_bounds is None else custom_bounds[0].isoformat(),
        None if custom_bounds is None else custom_bounds[1].isoformat(),
        len(samples),
        data_type,
        field_mode,
    )

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/convert")
def convert_registers(request: ConvertRequest) -> dict[str, object]:
    """Convert raw registers into one of the supported value types."""
    try:
        value = convert_register_value(
            request.registers,
            data_type=request.data_type,
            word_offset=request.word_offset,
            word_length=request.word_length,
            word_order=request.word_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "data_type": request.data_type,
        "word_offset": request.word_offset,
        "word_length": request.word_length,
        "word_order": request.word_order,
        "registers": request.registers,
        "hex": registers_to_bytes(request.registers).hex(" ").upper(),
        "value": value,
    }


@app.post("/isdu/read")
def read_isdu_parameter(request: ISDUReadRequest) -> dict[str, object]:
    """
    Perform an ISDU read against the active ICE2 target.

    ISDU reads use a separate real-device service path so the background PDI
    polling worker can keep its own Modbus cadence uninterrupted.
    """
    connection = _get_saved_connection()
    settings = _get_settings()

    try:
        port = validate_port(request.port)
        index = validate_isdu_index(request.index)
        subindex = validate_isdu_subindex(request.subindex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Received ISDU read request: mode=%s host=%s port=%s index=%s subindex=%s",
        connection.mode,
        connection.host,
        port,
        index,
        subindex,
    )

    try:
        service = create_isdu_service(connection, settings)
        result = service.read_parameter(port=port, index=index, subindex=subindex)
    except Exception as exc:
        logger.exception(
            "Unexpected ISDU read failure for mode=%s host=%s port=%s index=%s subindex=%s",
            connection.mode,
            connection.host,
            port,
            index,
            subindex,
        )
        raise HTTPException(status_code=500, detail=f"Unexpected ISDU read failure: {exc}") from exc

    return result.to_dict(connection)


@app.post("/isdu/write")
def write_isdu_parameter(request: ISDUWriteRequest) -> dict[str, object]:
    """
    Perform an ISDU write against the active ICE2 target.

    Writes use the same dedicated ISDU service path as reads so cached PDI
    polling remains isolated from engineering operations.
    """
    connection = _get_saved_connection()
    settings = _get_settings()

    try:
        port = validate_port(request.port)
        index = validate_isdu_index(request.index)
        subindex = validate_isdu_subindex(request.subindex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Received confirmed ISDU write request: mode=%s host=%s port=%s index=%s subindex=%s data=%s",
        connection.mode,
        connection.host,
        port,
        index,
        subindex,
        request.data_hex,
    )

    try:
        service = create_isdu_service(connection, settings)
        result = service.write_parameter(
            port=port,
            index=index,
            subindex=subindex,
            data_hex=request.data_hex,
        )
    except ValueError as exc:
        logger.warning(
            "ISDU write validation failed for mode=%s host=%s port=%s index=%s subindex=%s: %s",
            connection.mode,
            connection.host,
            port,
            index,
            subindex,
            exc,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected ISDU write failure for mode=%s host=%s port=%s index=%s subindex=%s",
            connection.mode,
            connection.host,
            port,
            index,
            subindex,
        )
        raise HTTPException(status_code=500, detail=f"Unexpected ISDU write failure: {exc}") from exc

    return result.to_dict(connection)


@app.get("/{frontend_path:path}", include_in_schema=False)
def serve_frontend_app(frontend_path: str):
    """Serve the built frontend assets when running the packaged or production desktop app."""
    asset_path = _resolve_frontend_asset(frontend_path)
    if asset_path is None:
        raise HTTPException(status_code=404, detail="Resource not found.")

    return FileResponse(asset_path)
