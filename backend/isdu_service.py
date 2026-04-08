"""ISDU read/write support for real ICE2 hardware and simulator fallback."""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import AppSettings
from modbus_core import BackendMode, ModbusConnectionConfig, validate_port


logger = logging.getLogger("ice2.backend.isdu")

ISDUTransportProtocol = Literal["rest-http", "simulator"]
ISDUOperation = Literal["read", "write"]
ISDUPreviewSource = Literal["response", "request", "none"]

_SIMULATOR_ISDU_STORAGE: dict[tuple[int, int, int], bytes] = {}


def validate_isdu_index(index: int) -> int:
    """ISDU indexes are unsigned 16-bit values."""
    if not 0 <= index <= 0xFFFF:
        raise ValueError("ISDU index must be between 0 and 65535")
    return index


def validate_isdu_subindex(subindex: int) -> int:
    """ISDU subindexes are one byte on the wire."""
    if not 0 <= subindex <= 0xFF:
        raise ValueError("ISDU subindex must be between 0 and 255")
    return subindex


def _normalize_hex_token(token: str) -> str:
    normalized = token.strip()

    if normalized.lower().startswith("0x"):
        normalized = normalized[2:]

    if not normalized:
        raise ValueError("Empty ISDU data token")

    if len(normalized) == 1:
        normalized = f"0{normalized}"

    if len(normalized) != 2:
        raise ValueError(f"Invalid ISDU byte token '{token}'")

    int(normalized, 16)
    return normalized.upper()


def normalize_isdu_hex_data(data: str | None) -> str | None:
    """Normalize byte-string payloads like '12 34 AB' for stable display."""
    if data is None:
        return None

    stripped = data.strip()
    if not stripped:
        return ""

    tokens = [_normalize_hex_token(token) for token in stripped.replace(",", " ").split()]
    return " ".join(tokens)


def parse_isdu_hex_bytes(data: str | None) -> bytes:
    """Parse a whitespace-delimited ISDU byte-string into raw bytes."""
    normalized = normalize_isdu_hex_data(data)

    if normalized is None or normalized == "":
        return b""

    return bytes(int(token, 16) for token in normalized.split())


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None

    if isinstance(value, int):
        return value

    if isinstance(value, float) and value.is_integer():
        return int(value)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped, 0)
        except ValueError:
            return None

    return None


def _format_ascii_preview(data_bytes: bytes) -> str | None:
    if not data_bytes:
        return None

    printable = "".join(chr(byte) if 32 <= byte <= 126 else "." for byte in data_bytes)
    return printable if printable.strip(".") else None


def _format_utf8_preview(data_bytes: bytes) -> str | None:
    if not data_bytes:
        return None

    try:
        decoded = data_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return None

    if not decoded:
        return None

    if any(ord(character) < 32 and character not in "\r\n\t" for character in decoded):
        return None

    return decoded


def _get_case_insensitive_value(entry: dict[str, Any], *keys: str) -> Any:
    lowered_entry = {key.lower(): value for key, value in entry.items()}

    for key in keys:
        lowered_key = key.lower()
        if lowered_key in lowered_entry:
            return lowered_entry[lowered_key]

    return None


def build_isdu_read_payload(
    *,
    port: int,
    index: int,
    subindex: int,
) -> list[dict[str, int | str]]:
    """Build the official ICE2 REST ISDU read payload."""
    validated_port = validate_port(port)
    validated_index = validate_isdu_index(index)
    validated_subindex = validate_isdu_subindex(subindex)

    return [
        {
            "req": "read",
            "port": validated_port - 1,
            "index": validated_index,
            "subindex": validated_subindex,
        }
    ]


def build_isdu_write_payload(
    *,
    port: int,
    index: int,
    subindex: int,
    data_hex: str,
) -> list[dict[str, int | str]]:
    """Build the official ICE2 REST ISDU write payload."""
    validated_port = validate_port(port)
    validated_index = validate_isdu_index(index)
    validated_subindex = validate_isdu_subindex(subindex)
    normalized_data = normalize_isdu_hex_data(data_hex)

    if normalized_data is None or normalized_data == "":
        raise ValueError("ISDU write payload must include at least one byte")

    return [
        {
            "req": "write",
            "port": validated_port - 1,
            "index": validated_index,
            "subindex": validated_subindex,
            "data": normalized_data,
        }
    ]


def build_isdu_response_preview(data_hex: str | None) -> dict[str, Any]:
    """Build compact engineering previews for a raw ISDU byte-string payload."""
    normalized_hex = normalize_isdu_hex_data(data_hex)
    data_bytes = parse_isdu_hex_bytes(normalized_hex)

    preview: dict[str, Any] = {
        "byte_count": len(data_bytes),
        "hex": normalized_hex or "",
        "bytes": list(data_bytes),
        "uint16_be": None,
        "uint16_le": None,
        "int16_be": None,
        "int16_le": None,
        "uint32_be": None,
        "uint32_le": None,
        "int32_be": None,
        "int32_le": None,
        "utf8": _format_utf8_preview(data_bytes),
        "ascii": _format_ascii_preview(data_bytes),
    }

    if len(data_bytes) >= 2:
        preview["uint16_be"] = int.from_bytes(data_bytes[:2], byteorder="big", signed=False)
        preview["uint16_le"] = int.from_bytes(data_bytes[:2], byteorder="little", signed=False)
        preview["int16_be"] = int.from_bytes(data_bytes[:2], byteorder="big", signed=True)
        preview["int16_le"] = int.from_bytes(data_bytes[:2], byteorder="little", signed=True)

    if len(data_bytes) >= 4:
        preview["uint32_be"] = int.from_bytes(data_bytes[:4], byteorder="big", signed=False)
        preview["uint32_le"] = int.from_bytes(data_bytes[:4], byteorder="little", signed=False)
        preview["int32_be"] = int.from_bytes(data_bytes[:4], byteorder="big", signed=True)
        preview["int32_le"] = int.from_bytes(data_bytes[:4], byteorder="little", signed=True)

    return preview


def _pretty_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


@dataclass(slots=True)
class ISDUServiceTransport:
    mode: BackendMode
    protocol: ISDUTransportProtocol
    endpoint_url: str
    timeout_seconds: float
    uses_basic_auth: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "protocol": self.protocol,
            "endpoint_url": self.endpoint_url,
            "timeout_seconds": self.timeout_seconds,
            "uses_basic_auth": self.uses_basic_auth,
        }


@dataclass(slots=True)
class ISDURequestFrame:
    operation: ISDUOperation
    port: int
    device_port: int
    index: int
    subindex: int
    data_hex: str | None
    payload: list[dict[str, int | str]]
    payload_json: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "port": self.port,
            "device_port": self.device_port,
            "index": self.index,
            "subindex": self.subindex,
            "data_hex": self.data_hex,
            "payload": self.payload,
            "payload_json": self.payload_json,
        }


@dataclass(slots=True)
class ISDUResponseEnvelope:
    ok: bool
    timed_out: bool
    acknowledged: bool
    status: str
    code: int | None
    data_hex: str | None
    raw_json: Any
    raw_json_pretty: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "timed_out": self.timed_out,
            "acknowledged": self.acknowledged,
            "status": self.status,
            "code": self.code,
            "data_hex": self.data_hex,
            "raw_json": self.raw_json,
            "raw_json_pretty": self.raw_json_pretty,
        }


@dataclass(slots=True)
class ISDUOperationResult:
    transport: ISDUServiceTransport
    request: ISDURequestFrame
    response: ISDUResponseEnvelope
    preview: dict[str, Any] | None
    preview_source: ISDUPreviewSource
    error: str | None
    duration_ms: int

    def to_dict(self, connection: ModbusConnectionConfig) -> dict[str, Any]:
        return {
            "connection": connection.to_dict(),
            "transport": self.transport.to_dict(),
            "request": self.request.to_dict(),
            "response": self.response.to_dict(),
            "preview": self.preview,
            "preview_source": self.preview_source,
            "error": self.error,
            "duration_ms": self.duration_ms,
        }


class ICE2ISDUService(Protocol):
    """Shared contract for real-device and simulator ISDU operations."""

    def read_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
    ) -> ISDUOperationResult:
        """Read a single ISDU object from the selected port."""

    def write_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
        data_hex: str,
    ) -> ISDUOperationResult:
        """Write a single ISDU object to the selected port."""


class ICE2RestISDUService:
    """Perform real ISDU reads and writes via the official ICE2 REST API."""

    def __init__(self, connection: ModbusConnectionConfig, settings: AppSettings) -> None:
        self._connection = connection
        self._settings = settings

    def read_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
    ) -> ISDUOperationResult:
        payload = build_isdu_read_payload(port=port, index=index, subindex=subindex)
        return self._perform_request(
            operation="read",
            port=port,
            index=index,
            subindex=subindex,
            payload=payload,
            data_hex=None,
        )

    def write_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
        data_hex: str,
    ) -> ISDUOperationResult:
        payload = build_isdu_write_payload(
            port=port,
            index=index,
            subindex=subindex,
            data_hex=data_hex,
        )
        return self._perform_request(
            operation="write",
            port=port,
            index=index,
            subindex=subindex,
            payload=payload,
            data_hex=normalize_isdu_hex_data(data_hex),
        )

    def _perform_request(
        self,
        *,
        operation: ISDUOperation,
        port: int,
        index: int,
        subindex: int,
        payload: list[dict[str, int | str]],
        data_hex: str | None,
    ) -> ISDUOperationResult:
        payload_json = json.dumps(payload, separators=(",", ":"))
        endpoint_url = (
            f"{self._settings.isdu_http_scheme}://"
            f"{self._connection.host}:{self._settings.isdu_http_port}/api/isdu/request"
        )
        transport = ISDUServiceTransport(
            mode=self._connection.mode,
            protocol="rest-http",
            endpoint_url=endpoint_url,
            timeout_seconds=max(self._connection.timeout, self._settings.isdu_timeout_seconds),
            uses_basic_auth=bool(self._settings.isdu_http_username),
        )
        request_frame = ISDURequestFrame(
            operation=operation,
            port=port,
            device_port=port - 1,
            index=index,
            subindex=subindex,
            data_hex=data_hex,
            payload=payload,
            payload_json=payload_json,
        )

        logger.info(
            "ISDU %s request prepared: host=%s endpoint=%s port=%s device_port=%s index=%s subindex=%s data=%s payload=%s",
            operation,
            self._connection.host,
            endpoint_url,
            port,
            port - 1,
            index,
            subindex,
            data_hex,
            payload_json,
        )

        start_time = time.monotonic()
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

        if self._settings.isdu_http_username:
            auth_value = (
                f"{self._settings.isdu_http_username}:{self._settings.isdu_http_password or ''}"
            )
            headers["Authorization"] = (
                "Basic " + base64.b64encode(auth_value.encode("utf-8")).decode("ascii")
            )

        request = Request(
            endpoint_url,
            data=payload_json.encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urlopen(request, timeout=transport.timeout_seconds) as response:
                raw_body = response.read().decode("utf-8", errors="replace")
        except HTTPError as error:
            raw_body = error.read().decode("utf-8", errors="replace")
            duration_ms = int((time.monotonic() - start_time) * 1000)
            message = f"HTTP {error.code} {error.reason}".strip()
            logger.warning(
                "ISDU %s HTTP error for host=%s port=%s index=%s subindex=%s duration_ms=%s: %s body=%s",
                operation,
                self._connection.host,
                port,
                index,
                subindex,
                duration_ms,
                message,
                raw_body,
            )
            return ISDUOperationResult(
                transport=transport,
                request=request_frame,
                response=ISDUResponseEnvelope(
                    ok=False,
                    timed_out=False,
                    acknowledged=False,
                    status=message,
                    code=error.code,
                    data_hex=None,
                    raw_json=raw_body,
                    raw_json_pretty=raw_body,
                ),
                preview=build_isdu_response_preview(data_hex) if data_hex else None,
                preview_source="request" if data_hex else "none",
                error=raw_body or message,
                duration_ms=duration_ms,
            )
        except URLError as error:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            reason = str(error.reason)
            timed_out = "timed out" in reason.lower() or "timeout" in reason.lower()
            logger.warning(
                "ISDU %s transport error for host=%s port=%s index=%s subindex=%s duration_ms=%s timed_out=%s: %s",
                operation,
                self._connection.host,
                port,
                index,
                subindex,
                duration_ms,
                timed_out,
                reason,
            )
            return ISDUOperationResult(
                transport=transport,
                request=request_frame,
                response=ISDUResponseEnvelope(
                    ok=False,
                    timed_out=timed_out,
                    acknowledged=False,
                    status="Timed out" if timed_out else "Transport error",
                    code=None,
                    data_hex=None,
                    raw_json=reason,
                    raw_json_pretty=reason,
                ),
                preview=build_isdu_response_preview(data_hex) if data_hex else None,
                preview_source="request" if data_hex else "none",
                error=f"ISDU {'timeout' if timed_out else 'transport error'}: {reason}",
                duration_ms=duration_ms,
            )
        except TimeoutError as error:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.warning(
                "ISDU %s timeout for host=%s port=%s index=%s subindex=%s duration_ms=%s: %s",
                operation,
                self._connection.host,
                port,
                index,
                subindex,
                duration_ms,
                error,
            )
            return ISDUOperationResult(
                transport=transport,
                request=request_frame,
                response=ISDUResponseEnvelope(
                    ok=False,
                    timed_out=True,
                    acknowledged=False,
                    status="Timed out",
                    code=None,
                    data_hex=None,
                    raw_json=str(error),
                    raw_json_pretty=str(error),
                ),
                preview=build_isdu_response_preview(data_hex) if data_hex else None,
                preview_source="request" if data_hex else "none",
                error=f"ISDU timeout: {error}",
                duration_ms=duration_ms,
            )
        except Exception as error:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.exception(
                "Unexpected ISDU %s error for host=%s port=%s index=%s subindex=%s duration_ms=%s",
                operation,
                self._connection.host,
                port,
                index,
                subindex,
                duration_ms,
            )
            return ISDUOperationResult(
                transport=transport,
                request=request_frame,
                response=ISDUResponseEnvelope(
                    ok=False,
                    timed_out=False,
                    acknowledged=False,
                    status="Unexpected error",
                    code=None,
                    data_hex=None,
                    raw_json=str(error),
                    raw_json_pretty=str(error),
                ),
                preview=build_isdu_response_preview(data_hex) if data_hex else None,
                preview_source="request" if data_hex else "none",
                error=f"Unexpected ISDU error: {error}",
                duration_ms=duration_ms,
            )

        duration_ms = int((time.monotonic() - start_time) * 1000)

        try:
            parsed_body = json.loads(raw_body)
            raw_json_pretty = _pretty_json(parsed_body)
        except json.JSONDecodeError:
            parsed_body = raw_body
            raw_json_pretty = raw_body

        logger.info(
            "ISDU %s response received: host=%s port=%s index=%s subindex=%s duration_ms=%s body=%s",
            operation,
            self._connection.host,
            port,
            index,
            subindex,
            duration_ms,
            raw_json_pretty,
        )

        return parse_isdu_response_payload(
            connection=self._connection,
            transport=transport,
            request_frame=request_frame,
            raw_payload=parsed_body,
            raw_payload_pretty=raw_json_pretty,
            duration_ms=duration_ms,
        )


class ICE2SimulatorISDUService:
    """Simulator fallback with persistent in-memory read/write behavior."""

    def __init__(self, connection: ModbusConnectionConfig, settings: AppSettings) -> None:
        self._connection = connection
        self._settings = settings

    def read_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
    ) -> ISDUOperationResult:
        payload = build_isdu_read_payload(port=port, index=index, subindex=subindex)
        payload_json = json.dumps(payload, separators=(",", ":"))
        request_frame = ISDURequestFrame(
            operation="read",
            port=port,
            device_port=port - 1,
            index=index,
            subindex=subindex,
            data_hex=None,
            payload=payload,
            payload_json=payload_json,
        )
        transport = ISDUServiceTransport(
            mode=self._connection.mode,
            protocol="simulator",
            endpoint_url="simulator://isdu/request",
            timeout_seconds=self._settings.isdu_timeout_seconds,
            uses_basic_auth=False,
        )

        storage_key = (port, index, subindex)
        data_bytes = _SIMULATOR_ISDU_STORAGE.get(storage_key) or _build_simulator_isdu_bytes(
            port=port,
            index=index,
            subindex=subindex,
        )
        data_hex = " ".join(f"{byte:02X}" for byte in data_bytes)
        raw_payload = [
            {
                "req": "read",
                "port": port - 1,
                "index": index,
                "subindex": subindex,
                "status": "OK",
                "code": len(data_bytes),
                "data": data_hex,
            }
        ]
        raw_payload_pretty = _pretty_json(raw_payload)

        logger.info(
            "Simulator ISDU read: port=%s index=%s subindex=%s response=%s",
            port,
            index,
            subindex,
            raw_payload_pretty,
        )

        return parse_isdu_response_payload(
            connection=self._connection,
            transport=transport,
            request_frame=request_frame,
            raw_payload=raw_payload,
            raw_payload_pretty=raw_payload_pretty,
            duration_ms=0,
        )

    def write_parameter(
        self,
        *,
        port: int,
        index: int,
        subindex: int,
        data_hex: str,
    ) -> ISDUOperationResult:
        normalized_data = normalize_isdu_hex_data(data_hex)
        if normalized_data is None or normalized_data == "":
            raise ValueError("ISDU write payload must include at least one byte")

        payload = build_isdu_write_payload(
            port=port,
            index=index,
            subindex=subindex,
            data_hex=normalized_data,
        )
        payload_json = json.dumps(payload, separators=(",", ":"))
        request_frame = ISDURequestFrame(
            operation="write",
            port=port,
            device_port=port - 1,
            index=index,
            subindex=subindex,
            data_hex=normalized_data,
            payload=payload,
            payload_json=payload_json,
        )
        transport = ISDUServiceTransport(
            mode=self._connection.mode,
            protocol="simulator",
            endpoint_url="simulator://isdu/request",
            timeout_seconds=self._settings.isdu_timeout_seconds,
            uses_basic_auth=False,
        )

        _SIMULATOR_ISDU_STORAGE[(port, index, subindex)] = parse_isdu_hex_bytes(normalized_data)

        raw_payload = [
            {
                "req": "write",
                "port": port - 1,
                "index": index,
                "subindex": subindex,
                "status": "OK",
                "code": len(_SIMULATOR_ISDU_STORAGE[(port, index, subindex)]),
                "data": normalized_data,
            }
        ]
        raw_payload_pretty = _pretty_json(raw_payload)

        logger.info(
            "Simulator ISDU write: port=%s index=%s subindex=%s data=%s response=%s",
            port,
            index,
            subindex,
            normalized_data,
            raw_payload_pretty,
        )

        return parse_isdu_response_payload(
            connection=self._connection,
            transport=transport,
            request_frame=request_frame,
            raw_payload=raw_payload,
            raw_payload_pretty=raw_payload_pretty,
            duration_ms=0,
        )


def _build_simulator_isdu_bytes(*, port: int, index: int, subindex: int) -> bytes:
    if index == 0:
        return f"SIM-PORT-{port}".encode("ascii")

    if index == 1:
        return bytes([0x00, port, subindex, 0x10])

    if index == 16:
        return int((port * 100) + subindex).to_bytes(2, byteorder="big", signed=False)

    if index == 17:
        return int((index << 8) | subindex).to_bytes(4, byteorder="big", signed=False)

    seed = ((port & 0xFF) << 24) | ((index & 0xFFFF) << 8) | (subindex & 0xFF)
    return seed.to_bytes(4, byteorder="big", signed=False)


def parse_isdu_response_payload(
    *,
    connection: ModbusConnectionConfig,
    transport: ISDUServiceTransport,
    request_frame: ISDURequestFrame,
    raw_payload: Any,
    raw_payload_pretty: str,
    duration_ms: int,
) -> ISDUOperationResult:
    """Parse the official ICE2 response body into a stable API payload."""
    if not isinstance(raw_payload, list) or not raw_payload:
        return ISDUOperationResult(
            transport=transport,
            request=request_frame,
            response=ISDUResponseEnvelope(
                ok=False,
                timed_out=False,
                acknowledged=False,
                status="Invalid response",
                code=None,
                data_hex=None,
                raw_json=raw_payload,
                raw_json_pretty=raw_payload_pretty,
            ),
            preview=build_isdu_response_preview(request_frame.data_hex)
            if request_frame.data_hex
            else None,
            preview_source="request" if request_frame.data_hex else "none",
            error="ISDU response was not a non-empty JSON array.",
            duration_ms=duration_ms,
        )

    first_item = raw_payload[0]
    if not isinstance(first_item, dict):
        return ISDUOperationResult(
            transport=transport,
            request=request_frame,
            response=ISDUResponseEnvelope(
                ok=False,
                timed_out=False,
                acknowledged=False,
                status="Invalid response",
                code=None,
                data_hex=None,
                raw_json=raw_payload,
                raw_json_pretty=raw_payload_pretty,
            ),
            preview=build_isdu_response_preview(request_frame.data_hex)
            if request_frame.data_hex
            else None,
            preview_source="request" if request_frame.data_hex else "none",
            error="ISDU response entry was not a JSON object.",
            duration_ms=duration_ms,
        )

    if len(first_item) == 0:
        fallback_preview = (
            build_isdu_response_preview(request_frame.data_hex)
            if request_frame.data_hex
            else None
        )
        return ISDUOperationResult(
            transport=transport,
            request=request_frame,
            response=ISDUResponseEnvelope(
                ok=True,
                timed_out=False,
                acknowledged=True,
                status="Accepted",
                code=None,
                data_hex=None,
                raw_json=raw_payload,
                raw_json_pretty=raw_payload_pretty,
            ),
            preview=fallback_preview,
            preview_source="request" if fallback_preview is not None else "none",
            error=None,
            duration_ms=duration_ms,
        )

    status_text = str(_get_case_insensitive_value(first_item, "status") or "Accepted")
    data_hex = normalize_isdu_hex_data(
        _get_case_insensitive_value(first_item, "data", "raw")
        if isinstance(_get_case_insensitive_value(first_item, "data", "raw"), str)
        else None
    )
    code = _coerce_int(_get_case_insensitive_value(first_item, "code", "len"))
    lowered_status = status_text.lower()
    timed_out = "timed out" in lowered_status or "timeout" in lowered_status
    failed = any(keyword in lowered_status for keyword in ("fail", "error", "reject"))
    ok = not timed_out and not failed
    acknowledged = True

    if data_hex:
        preview = build_isdu_response_preview(data_hex)
        preview_source: ISDUPreviewSource = "response"
    elif request_frame.data_hex:
        preview = build_isdu_response_preview(request_frame.data_hex)
        preview_source = "request"
    else:
        preview = None
        preview_source = "none"

    error = None
    if not ok:
        error = (
            f"ISDU request timed out for port {request_frame.port}, "
            f"index {request_frame.index}, subindex {request_frame.subindex}."
            if timed_out
            else f"ISDU request failed with status '{status_text}'."
        )

    return ISDUOperationResult(
        transport=transport,
        request=request_frame,
        response=ISDUResponseEnvelope(
            ok=ok,
            timed_out=timed_out,
            acknowledged=acknowledged,
            status=status_text,
            code=code,
            data_hex=data_hex,
            raw_json=raw_payload,
            raw_json_pretty=raw_payload_pretty,
        ),
        preview=preview,
        preview_source=preview_source,
        error=error,
        duration_ms=duration_ms,
    )


def create_isdu_service(
    connection: ModbusConnectionConfig,
    settings: AppSettings,
) -> ICE2ISDUService:
    """Return a real-device or simulator ISDU implementation for the active mode."""
    if connection.mode == "simulator":
        return ICE2SimulatorISDUService(connection, settings)

    return ICE2RestISDUService(connection, settings)
