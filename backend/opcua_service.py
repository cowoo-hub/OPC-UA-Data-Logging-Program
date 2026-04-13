"""Read-only OPC UA server for exposing Masterway PDI data to industrial clients."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("ice2.backend.opcua")

try:
    from opcua import Server, ua
except ModuleNotFoundError:
    Server = None
    ua = None


@dataclass(slots=True)
class OPCUAStatus:
    enabled: bool
    configured: bool
    running: bool
    endpoint: str
    namespace_uri: str
    server_name: str
    namespace_index: int | None
    security_mode: str
    anonymous: bool
    writable: bool
    last_error: str | None
    last_update_at: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "running": self.running,
            "endpoint": self.endpoint,
            "namespace_uri": self.namespace_uri,
            "server_name": self.server_name,
            "namespace_index": self.namespace_index,
            "security_mode": self.security_mode,
            "anonymous": self.anonymous,
            "writable": self.writable,
            "last_error": self.last_error,
            "last_update_at": self.last_update_at,
        }


class OPCUAService:
    """Small UAExpert-compatible OPC UA server hosted inside the FastAPI process."""

    def __init__(
        self,
        *,
        enabled: bool,
        host: str,
        port: int,
        path: str,
        namespace_uri: str,
        server_name: str,
        security_mode: str = "none",
        anonymous: bool = True,
        writable: bool = False,
    ) -> None:
        self._enabled = enabled
        self._host = host.strip() or "0.0.0.0"
        self._port = max(1, min(int(port), 65535))
        self._path = path.strip().strip("/") or "masterway"
        self._namespace_uri = namespace_uri.strip() or "urn:masterway:opcua"
        self._server_name = server_name.strip() or "Masterway OPC UA Server"
        self._security_mode = security_mode
        self._anonymous = anonymous
        self._writable = writable

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._server: Any | None = None
        self._namespace_index: int | None = None
        self._running = False
        self._last_error: str | None = None
        self._last_update_at: str | None = None
        self._nodes: dict[str, Any] = {}
        self._node_browse_paths: dict[str, str] = {}
        self._node_values: dict[str, object] = {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def endpoint(self) -> str:
        return f"opc.tcp://{self._host}:{self._port}/{self._path}"

    def start(self) -> None:
        if not self._enabled:
            logger.info("OPC UA server is disabled")
            return

        if Server is None or ua is None:
            self._last_error = "Missing backend dependency 'opcua'"
            logger.warning(
                "OPC UA is enabled but opcua is not installed. Install backend/requirements.txt."
            )
            return

        with self._lock:
            if self._thread is not None:
                return
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run_server,
                name="masterway-opcua",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            self._stop_event.set()
            server = self._server

        if server is not None:
            try:
                server.stop()
            except Exception:
                logger.exception("Failed to stop OPC UA server cleanly")

        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)

        with self._lock:
            self._thread = None
            self._server = None
            self._running = False
            self._namespace_index = None
            self._nodes = {}
            self._node_browse_paths = {}
            self._node_values = {}

    def get_status(self) -> OPCUAStatus:
        return OPCUAStatus(
            enabled=self._enabled,
            configured=bool(self._host and self._port),
            running=self._running,
            endpoint=self.endpoint,
            namespace_uri=self._namespace_uri,
            server_name=self._server_name,
            namespace_index=self._namespace_index,
            security_mode=self._security_mode,
            anonymous=self._anonymous,
            writable=self._writable,
            last_error=self._last_error,
            last_update_at=self._last_update_at,
        )

    def get_node_preview(self) -> dict[str, object]:
        """Return a compact mirror of the currently exposed OPC UA variable nodes."""
        with self._lock:
            nodes = [
                {
                    "key": key,
                    "browse_path": self._node_browse_paths.get(key, key),
                    "value": self._node_values.get(key),
                    "data_type": self._infer_data_type(self._node_values.get(key)),
                    "updated_at": self._last_update_at,
                }
                for key in sorted(self._node_browse_paths, key=self._sort_node_key)
            ]

        return {
            "count": len(nodes),
            "nodes": nodes,
        }

    def reconfigure(
        self,
        *,
        enabled: bool,
        host: str,
        port: int,
        path: str,
        namespace_uri: str,
        server_name: str,
        security_mode: str,
        anonymous: bool,
        writable: bool,
    ) -> None:
        self.stop()
        self._enabled = enabled
        self._host = host.strip() or "0.0.0.0"
        self._port = max(1, min(int(port), 65535))
        self._path = path.strip().strip("/") or "masterway"
        self._namespace_uri = namespace_uri.strip() or "urn:masterway:opcua"
        self._server_name = server_name.strip() or "Masterway OPC UA Server"
        self._security_mode = security_mode
        self._anonymous = anonymous
        self._writable = writable
        self._last_error = None
        self._last_update_at = None
        self.start()

    def update_system(self, payload: dict[str, object]) -> None:
        if not self._enabled or not self._running:
            return

        polling = payload.get("polling")
        connection_state = ""
        cycle_count = 0
        if isinstance(polling, dict):
            connection_state = str(polling.get("communication_state") or "")
            cycle_count = int(polling.get("cycle_count") or 0)

        timestamp = str(payload.get("timestamp") or payload.get("lastUpdate") or "")
        self._write_node("system.status", str(payload.get("status") or "ok"))
        self._write_node("system.connection_state", connection_state)
        self._write_node("system.last_update", timestamp)
        self._write_node("system.backend_mode", str(payload.get("backendMode") or ""))
        self._write_node("system.cycle_count", cycle_count)
        self._last_update_at = timestamp or None

    def update_port_snapshot(self, port_number: int, payload: dict[str, object]) -> None:
        if not self._enabled or not self._running:
            return

        prefix = f"port.{port_number}"
        raw_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
        event_code = header.get("event_code") if isinstance(header.get("event_code"), dict) else {}
        display_state = payload.get("display") if isinstance(payload.get("display"), dict) else {}
        preview = (
            display_state.get("featuredPreview")
            if isinstance(display_state.get("featuredPreview"), dict)
            else {}
        )
        config = display_state.get("config") if isinstance(display_state.get("config"), dict) else {}
        registers = raw_payload.get("registers") if isinstance(raw_payload, dict) else []
        if not isinstance(registers, list):
            registers = []

        self._write_node(f"{prefix}.valid", bool(payload.get("valid")))
        self._write_node(f"{prefix}.severity", str(payload.get("severity") or "normal"))
        self._write_node(f"{prefix}.event_code", str(event_code.get("hex") or ""))
        self._write_node(f"{prefix}.raw_hex", str(raw_payload.get("hex") or ""))
        self._write_node(
            f"{prefix}.raw_registers",
            ua.Variant([int(value) & 0xFFFF for value in registers], ua.VariantType.UInt16),
        )
        self._write_node(f"{prefix}.display_value", str(preview.get("displayValue") or ""))
        self._write_node(f"{prefix}.display_raw", str(preview.get("rawDisplayValue") or ""))
        self._write_node(f"{prefix}.display_scaled", str(preview.get("scaledValue") or ""))
        self._write_node(f"{prefix}.display_unit", str(config.get("engineeringUnit") or ""))
        self._write_node(f"{prefix}.display_decode_type", str(config.get("preferredDecodeType") or ""))
        self._write_node(f"{prefix}.diagnostic_status", str(payload.get("severity") or "normal"))
        self._last_update_at = str(payload.get("timestamp") or "")

    def _run_server(self) -> None:
        try:
            server = Server()
            server.set_endpoint(self.endpoint)
            server.set_server_name(self._server_name)
            server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
            server.set_security_IDs(["Anonymous"] if self._anonymous else [])
            namespace_index = server.register_namespace(self._namespace_uri)
            self._build_node_model(server, namespace_index)

            with self._lock:
                self._server = server
                self._namespace_index = namespace_index

            server.start()
            with self._lock:
                self._running = True
                self._last_error = None

            logger.info("OPC UA server started at %s namespace=%s", self.endpoint, namespace_index)
            self._stop_event.wait()
        except Exception as exc:
            with self._lock:
                self._running = False
                self._last_error = str(exc)
            logger.exception("OPC UA server failed")
        finally:
            with self._lock:
                self._running = False

    def _build_node_model(self, server: Any, namespace_index: int) -> None:
        objects = server.get_objects_node()
        root = objects.add_object(namespace_index, "Masterway")
        system = root.add_object(namespace_index, "System")
        ports = root.add_object(namespace_index, "Ports")

        self._nodes = {}
        self._node_browse_paths = {}
        self._node_values = {}
        self._add_variable(namespace_index, system, "system.status", "Masterway/System/Status", "Status", "Idle")
        self._add_variable(
            namespace_index,
            system,
            "system.connection_state",
            "Masterway/System/ConnectionState",
            "ConnectionState",
            "disconnected",
        )
        self._add_variable(
            namespace_index,
            system,
            "system.last_update",
            "Masterway/System/LastUpdate",
            "LastUpdate",
            "",
        )
        self._add_variable(
            namespace_index,
            system,
            "system.backend_mode",
            "Masterway/System/BackendMode",
            "BackendMode",
            "",
        )
        self._add_variable(
            namespace_index,
            system,
            "system.cycle_count",
            "Masterway/System/CycleCount",
            "CycleCount",
            0,
        )

        for port_number in range(1, 9):
            port_node = ports.add_object(namespace_index, f"Port{port_number}")
            raw = port_node.add_object(namespace_index, "Raw")
            display = port_node.add_object(namespace_index, "Display")
            diagnostics = port_node.add_object(namespace_index, "Diagnostics")
            prefix = f"port.{port_number}"
            browse_prefix = f"Masterway/Ports/Port{port_number}"
            self._add_variable(namespace_index, port_node, f"{prefix}.valid", f"{browse_prefix}/Valid", "Valid", False)
            self._add_variable(
                namespace_index,
                port_node,
                f"{prefix}.severity",
                f"{browse_prefix}/Severity",
                "Severity",
                "normal",
            )
            self._add_variable(
                namespace_index,
                port_node,
                f"{prefix}.event_code",
                f"{browse_prefix}/EventCode",
                "EventCode",
                "",
            )
            self._add_variable(namespace_index, raw, f"{prefix}.raw_hex", f"{browse_prefix}/Raw/Hex", "Hex", "")
            self._add_variable(
                namespace_index,
                raw,
                f"{prefix}.raw_registers",
                f"{browse_prefix}/Raw/Registers",
                "Registers",
                ua.Variant([], ua.VariantType.UInt16),
            )
            self._add_variable(
                namespace_index,
                display,
                f"{prefix}.display_value",
                f"{browse_prefix}/Display/Value",
                "Value",
                "",
            )
            self._add_variable(
                namespace_index,
                display,
                f"{prefix}.display_raw",
                f"{browse_prefix}/Display/RawValue",
                "RawValue",
                "",
            )
            self._add_variable(
                namespace_index,
                display,
                f"{prefix}.display_scaled",
                f"{browse_prefix}/Display/ScaledValue",
                "ScaledValue",
                "",
            )
            self._add_variable(
                namespace_index,
                display,
                f"{prefix}.display_unit",
                f"{browse_prefix}/Display/Unit",
                "Unit",
                "",
            )
            self._add_variable(
                namespace_index,
                display,
                f"{prefix}.display_decode_type",
                f"{browse_prefix}/Display/DecodeType",
                "DecodeType",
                "",
            )
            self._add_variable(
                namespace_index,
                diagnostics,
                f"{prefix}.diagnostic_status",
                f"{browse_prefix}/Diagnostics/Status",
                "Status",
                "",
            )

    def _add_variable(
        self,
        namespace_index: int,
        parent: Any,
        key: str,
        browse_path: str,
        name: str,
        initial_value: object,
    ) -> None:
        self._nodes[key] = parent.add_variable(namespace_index, name, initial_value)
        self._node_browse_paths[key] = browse_path
        self._node_values[key] = self._normalize_value(initial_value)

    def _write_node(self, key: str, value: object) -> None:
        with self._lock:
            node = self._nodes.get(key)
            if node is None:
                return

            try:
                node.set_value(value)
                self._node_values[key] = self._normalize_value(value)
            except Exception as exc:
                self._last_error = str(exc)
                logger.warning("OPC UA node update failed for key=%s: %s", key, exc)

    @staticmethod
    def _normalize_value(value: object) -> object:
        if ua is not None and isinstance(value, ua.Variant):
            value = value.Value

        if isinstance(value, (str, int, float, bool)) or value is None:
            return value

        if isinstance(value, (list, tuple)):
            return [OPCUAService._normalize_value(item) for item in value]

        return str(value)

    @staticmethod
    def _infer_data_type(value: object) -> str:
        if isinstance(value, bool):
            return "Boolean"
        if isinstance(value, int):
            return "Integer"
        if isinstance(value, float):
            return "Double"
        if isinstance(value, list):
            if all(isinstance(item, int) for item in value):
                return "UInt16[]"
            return "Array"
        return "String"

    @staticmethod
    def _sort_node_key(key: str) -> tuple[object, ...]:
        if key.startswith("system."):
            system_order = {
                "system.status": 0,
                "system.connection_state": 1,
                "system.last_update": 2,
                "system.backend_mode": 3,
                "system.cycle_count": 4,
            }
            return (0, system_order.get(key, 99), key)

        parts = key.split(".")
        port_number = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 99
        metric = ".".join(parts[2:])
        metric_order = {
            "valid": 0,
            "severity": 1,
            "event_code": 2,
            "raw_hex": 3,
            "raw_registers": 4,
            "display_value": 5,
            "display_raw": 6,
            "display_scaled": 7,
            "display_unit": 8,
            "display_decode_type": 9,
            "diagnostic_status": 10,
        }
        return (1, port_number, metric_order.get(metric, 99), key)
