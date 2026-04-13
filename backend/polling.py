"""Background polling cache for high-speed ICE2 PDI monitoring."""

from __future__ import annotations

from collections import deque
import logging
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from converters import registers_to_bytes
from modbus_core import (
    BackendMode,
    DEFAULT_PAYLOAD_WORD_COUNT,
    PORT_COUNT,
    ICE2Backend,
    ModbusConnectionConfig,
    PDIBlockMode,
)


PortSnapshotBuilder = Callable[
    [ModbusConnectionConfig, int, PDIBlockMode, int, list[int]],
    dict[str, object],
]
BackendFactory = Callable[[ModbusConnectionConfig], ICE2Backend]
PollingEventCallback = Callable[[dict[str, object]], None]

logger = logging.getLogger("ice2.backend.polling")

HISTORY_SOURCE_REGISTER_COUNT = 2


@dataclass(slots=True)
class PollingStatus:
    """Thread-safe view of the current polling status."""

    backend_mode: str
    interval_ms: int
    history_sample_interval_ms: int
    stale_after_ms: int
    payload_word_count: int
    block_mode: PDIBlockMode
    configured: bool
    running: bool
    updated_at: str | None
    last_successful_poll_at: str | None
    age_ms: int | None
    is_stale: bool
    cycle_count: int
    last_error: str | None
    communication_state: str
    has_snapshot: bool
    last_failure_at: str | None
    consecutive_failures: int
    reconnect_attempts: int
    next_retry_at: str | None
    next_retry_in_ms: int | None

    def to_dict(self) -> dict[str, object]:
        return {
            "backend_mode": self.backend_mode,
            "interval_ms": self.interval_ms,
            "history_sample_interval_ms": self.history_sample_interval_ms,
            "stale_after_ms": self.stale_after_ms,
            "payload_word_count": self.payload_word_count,
            "block_mode": self.block_mode,
            "configured": self.configured,
            "running": self.running,
            "updated_at": self.updated_at,
            "last_successful_poll_at": self.last_successful_poll_at,
            "age_ms": self.age_ms,
            "is_stale": self.is_stale,
            "cycle_count": self.cycle_count,
            "last_error": self.last_error,
            "communication_state": self.communication_state,
            "has_snapshot": self.has_snapshot,
            "last_failure_at": self.last_failure_at,
            "consecutive_failures": self.consecutive_failures,
            "reconnect_attempts": self.reconnect_attempts,
            "next_retry_at": self.next_retry_at,
            "next_retry_in_ms": self.next_retry_in_ms,
        }


class PDICacheWorker:
    """
    Poll all 8 ports in the background and keep the latest parsed snapshot in memory.

    The worker owns the fast device cadence while the frontend and API read the
    already-parsed results from cache. This keeps simulator mode and future real
    Modbus TCP mode under the same contract.
    """

    def __init__(
        self,
        *,
        backend_factory: BackendFactory,
        snapshot_builder: PortSnapshotBuilder,
        default_mode: BackendMode = "real",
        poll_interval_ms: int = 50,
        stale_after_ms: int = 250,
        reconnect_base_ms: int = 250,
        reconnect_max_ms: int = 5000,
        history_retention_ms: int = 600000,
        history_max_points: int = 240,
        history_sample_interval_ms: int = 100,
        payload_word_count: int = DEFAULT_PAYLOAD_WORD_COUNT,
        block_mode: PDIBlockMode = "multiple",
        event_callback: PollingEventCallback | None = None,
    ) -> None:
        self._backend_factory = backend_factory
        self._snapshot_builder = snapshot_builder
        self._default_mode = default_mode
        self._poll_interval_ms = poll_interval_ms
        self._stale_after_ms = stale_after_ms
        self._reconnect_base_ms = reconnect_base_ms
        self._reconnect_max_ms = reconnect_max_ms
        self._history_retention_ms = history_retention_ms
        self._history_max_points = history_max_points
        self._history_sample_interval_ms = history_sample_interval_ms
        self._payload_word_count = payload_word_count
        self._block_mode = block_mode
        self._event_callback = event_callback

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name="ice2-pdi-poller",
            daemon=True,
        )

        self._connection: ModbusConnectionConfig | None = None
        self._connection_revision = 0
        self._ports_by_number: dict[int, dict[str, object]] = {}
        self._history_by_port: dict[int, deque[tuple[float, dict[str, object]]]] = {
            port: deque()
            for port in range(1, PORT_COUNT + 1)
        }
        self._updated_at_monotonic: float | None = None
        self._updated_at_iso: str | None = None
        self._last_history_sample_monotonic: float | None = None
        self._cycle_count = 0
        self._last_error: str | None = None
        self._last_failure_at_iso: str | None = None
        self._consecutive_failures = 0
        self._reconnect_attempts = 0
        self._next_retry_monotonic: float | None = None
        self._next_retry_at_iso: str | None = None
        self._running = False
        self._last_stale_state: bool | None = None
        self._last_communication_state: str | None = None

    def start(self) -> None:
        """Start the background polling thread exactly once."""
        if not self._thread.is_alive():
            logger.info(
                "Starting PDI cache worker with default_mode=%s, interval=%sms, stale_after=%sms",
                self._default_mode,
                self._poll_interval_ms,
                self._stale_after_ms,
            )
            logger.info(
                "History buffer configured with retention=%sms, sample_interval=%sms, default_max_points=%s, source_register_count=%s",
                self._history_retention_ms,
                self._history_sample_interval_ms,
                self._history_max_points,
                HISTORY_SOURCE_REGISTER_COUNT,
            )
            self._thread.start()

    def stop(self) -> None:
        """Stop the polling thread and unblock any pending sleeps."""
        logger.info("Stopping PDI cache worker")
        self._stop_event.set()
        self._wake_event.set()

        if self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def update_connection(self, connection: ModbusConnectionConfig | None) -> None:
        """Swap the active target and force the worker to reconnect on the next loop."""
        with self._lock:
            previous_connection = self._connection
            same_target = previous_connection == connection
            self._connection = connection
            self._connection_revision += 1

            if connection is None or not same_target:
                self._ports_by_number = {}
                self._history_by_port = {
                    port: deque()
                    for port in range(1, PORT_COUNT + 1)
                }
                self._updated_at_monotonic = None
                self._updated_at_iso = None
                self._last_history_sample_monotonic = None
                self._cycle_count = 0

            self._last_error = None
            self._last_failure_at_iso = None
            self._consecutive_failures = 0
            self._reconnect_attempts = 0
            self._next_retry_monotonic = None
            self._next_retry_at_iso = None
            self._last_stale_state = None
            self._last_communication_state = None

        if connection is None:
            if previous_connection is not None:
                logger.info(
                    "Disconnected PDI polling target: mode=%s host=%s port=%s slave_id=%s",
                    previous_connection.mode,
                    previous_connection.host,
                    previous_connection.port,
                    previous_connection.slave_id,
                )
            else:
                logger.info("Cleared active PDI polling target")
        else:
            logger.info(
                "Updated active PDI polling target: mode=%s host=%s port=%s slave_id=%s same_target=%s",
                connection.mode,
                connection.host,
                connection.port,
                connection.slave_id,
                same_target,
            )

        self._wake_event.set()

    def get_status(self) -> PollingStatus:
        """Return a snapshot of the current polling metadata."""
        with self._lock:
            connection = self._connection
            updated_at_monotonic = self._updated_at_monotonic
            updated_at_iso = self._updated_at_iso
            cycle_count = self._cycle_count
            last_error = self._last_error
            last_failure_at = self._last_failure_at_iso
            consecutive_failures = self._consecutive_failures
            reconnect_attempts = self._reconnect_attempts
            next_retry_monotonic = self._next_retry_monotonic
            next_retry_at = self._next_retry_at_iso
            running = self._running

        backend_mode = connection.mode if connection is not None else self._default_mode
        age_ms: int | None = None
        if updated_at_monotonic is not None:
            age_ms = max(0, int((time.monotonic() - updated_at_monotonic) * 1000))

        has_snapshot = updated_at_monotonic is not None
        is_stale = (
            connection is not None
            and has_snapshot
            and age_ms is not None
            and age_ms > self._stale_after_ms
        )
        next_retry_in_ms: int | None = None
        if next_retry_monotonic is not None:
            next_retry_in_ms = max(
                0,
                int((next_retry_monotonic - time.monotonic()) * 1000),
            )

        communication_state = self._determine_communication_state(
            connection=connection,
            has_snapshot=has_snapshot,
            is_stale=is_stale,
            last_error=last_error,
        )
        self._log_stale_state_change(is_stale=is_stale, age_ms=age_ms, connection=connection)
        self._log_communication_state_change(
            communication_state=communication_state,
            connection=connection,
            last_error=last_error,
            next_retry_in_ms=next_retry_in_ms,
        )

        return PollingStatus(
            backend_mode=backend_mode,
            interval_ms=self._poll_interval_ms,
            history_sample_interval_ms=self._history_sample_interval_ms,
            stale_after_ms=self._stale_after_ms,
            payload_word_count=self._payload_word_count,
            block_mode=self._block_mode,
            configured=connection is not None,
            running=running,
            updated_at=updated_at_iso,
            last_successful_poll_at=updated_at_iso,
            age_ms=age_ms,
            is_stale=is_stale,
            cycle_count=cycle_count,
            last_error=last_error,
            communication_state=communication_state,
            has_snapshot=has_snapshot,
            last_failure_at=last_failure_at,
            consecutive_failures=consecutive_failures,
            reconnect_attempts=reconnect_attempts,
            next_retry_at=next_retry_at,
            next_retry_in_ms=next_retry_in_ms,
        )

    def get_all_ports_snapshot(self) -> dict[str, object]:
        """Return the latest cached snapshot for all ports plus polling metadata."""
        with self._lock:
            connection = self._connection
            port_snapshots = [
                deepcopy(self._ports_by_number[port])
                for port in sorted(self._ports_by_number)
            ]
        status = self.get_status()

        return {
            "backend_mode": status.backend_mode,
            "connection": None if connection is None else connection.to_dict(),
            "polling": status.to_dict(),
            "ports": port_snapshots,
        }

    def get_port_snapshot(self, port: int) -> dict[str, object] | None:
        """Return the cached snapshot for one port if it exists."""
        with self._lock:
            snapshot = self._ports_by_number.get(port)
            return None if snapshot is None else deepcopy(snapshot)

    def get_all_ports_history(
        self,
        *,
        window_ms: int | None = None,
        max_points: int | None = None,
    ) -> dict[str, object]:
        """Return cached per-port history for the requested window."""
        with self._lock:
            connection = self._connection
            history_by_port = {
                port: list(self._history_by_port.get(port, deque()))
                for port in range(1, PORT_COUNT + 1)
            }

        status = self.get_status()
        resolved_window_ms, resolved_max_points = self._resolve_history_request(
            window_ms=window_ms,
            max_points=max_points,
        )

        return {
            "backend_mode": status.backend_mode,
            "connection": None if connection is None else connection.to_dict(),
            "polling": status.to_dict(),
            "history_window_ms": resolved_window_ms,
            "history_retention_ms": self._history_retention_ms,
            "history_max_points": resolved_max_points,
            "history_source_register_count": HISTORY_SOURCE_REGISTER_COUNT,
            "ports": [
                {
                    "port": port,
                    "samples": self._select_history_samples(
                        history_by_port[port],
                        window_ms=resolved_window_ms,
                        max_points=resolved_max_points,
                    ),
                }
                for port in range(1, PORT_COUNT + 1)
            ],
        }

    def get_port_history(
        self,
        port: int,
        *,
        window_ms: int | None = None,
        max_points: int | None = None,
    ) -> dict[str, object]:
        """Return cached history for one port."""
        with self._lock:
            connection = self._connection
            history_entries = list(self._history_by_port.get(port, deque()))

        status = self.get_status()
        resolved_window_ms, resolved_max_points = self._resolve_history_request(
            window_ms=window_ms,
            max_points=max_points,
        )

        return {
            "backend_mode": status.backend_mode,
            "connection": None if connection is None else connection.to_dict(),
            "polling": status.to_dict(),
            "history_window_ms": resolved_window_ms,
            "history_retention_ms": self._history_retention_ms,
            "history_max_points": resolved_max_points,
            "history_source_register_count": HISTORY_SOURCE_REGISTER_COUNT,
            "port": port,
            "samples": self._select_history_samples(
                history_entries,
                window_ms=resolved_window_ms,
                max_points=resolved_max_points,
            ),
        }

    def get_port_history_for_export(
        self,
        port: int,
        *,
        window_ms: int | None = None,
    ) -> dict[str, object]:
        """Return cached history for one port without downsampling for CSV export."""
        with self._lock:
            connection = self._connection
            history_entries = list(self._history_by_port.get(port, deque()))

        status = self.get_status()
        resolved_window_ms = self._history_retention_ms if window_ms is None else max(
            1000,
            min(window_ms, self._history_retention_ms),
        )

        return {
            "backend_mode": status.backend_mode,
            "connection": None if connection is None else connection.to_dict(),
            "polling": status.to_dict(),
            "history_window_ms": resolved_window_ms,
            "history_retention_ms": self._history_retention_ms,
            "history_max_points": None,
            "history_source_register_count": HISTORY_SOURCE_REGISTER_COUNT,
            "port": port,
            "samples": self._select_history_samples(
                history_entries,
                window_ms=resolved_window_ms,
                max_points=None,
            ),
        }

    def _set_success_snapshot(
        self,
        connection: ModbusConnectionConfig,
        port_snapshots: dict[int, dict[str, object]],
    ) -> None:
        first_success = False
        recovered_from_error = False
        cycle_count = 0
        should_sample_history = False

        with self._lock:
            if self._connection != connection:
                return

            first_success = self._updated_at_monotonic is None
            recovered_from_error = self._last_error is not None
            recorded_at_monotonic = time.monotonic()
            recorded_at_iso = datetime.now(timezone.utc).isoformat()
            self._ports_by_number = port_snapshots
            should_sample_history = self._should_sample_history_locked(recorded_at_monotonic)
            self._append_history_samples_locked(
                port_snapshots=port_snapshots,
                recorded_at_monotonic=recorded_at_monotonic,
                recorded_at_iso=recorded_at_iso,
                append_samples=should_sample_history,
            )
            if should_sample_history:
                self._last_history_sample_monotonic = recorded_at_monotonic
            self._updated_at_monotonic = recorded_at_monotonic
            self._updated_at_iso = recorded_at_iso
            self._cycle_count += 1
            self._last_error = None
            self._last_failure_at_iso = None
            self._consecutive_failures = 0
            self._reconnect_attempts = 0
            self._next_retry_monotonic = None
            self._next_retry_at_iso = None
            cycle_count = self._cycle_count

        if first_success or recovered_from_error:
            logger.info(
                "PDI cache update succeeded for mode=%s host=%s port=%s slave_id=%s cycle=%s sampled_history=%s ports=%s",
                connection.mode,
                connection.host,
                connection.port,
                connection.slave_id,
                cycle_count,
                should_sample_history,
                len(port_snapshots),
            )

        self._emit_event(
            {
                "type": "poll_success",
                "connection": connection.to_dict(),
                "cycle_count": cycle_count,
                "sampled_history": should_sample_history,
                "ports": deepcopy(port_snapshots),
            }
        )

    def _set_error(
        self,
        connection: ModbusConnectionConfig,
        error: Exception,
        *,
        phase: str,
    ) -> None:
        delay_ms = self._calculate_reconnect_delay_ms(connection.mode)
        failure_time = datetime.now(timezone.utc)
        reconnect_attempt = 0

        with self._lock:
            if self._connection != connection:
                return

            self._last_error = str(error)
            self._last_failure_at_iso = failure_time.isoformat()
            self._consecutive_failures += 1
            self._reconnect_attempts += 1
            reconnect_attempt = self._reconnect_attempts
            self._next_retry_monotonic = time.monotonic() + (delay_ms / 1000.0)
            self._next_retry_at_iso = (
                failure_time + timedelta(milliseconds=delay_ms)
            ).isoformat()

        logger.warning(
            "PDI %s failure for mode=%s host=%s port=%s slave_id=%s attempt=%s retry_in_ms=%s: %s",
            phase,
            connection.mode,
            connection.host,
            connection.port,
            connection.slave_id,
            reconnect_attempt,
            delay_ms,
            error,
        )
        self._emit_event(
            {
                "type": "poll_error",
                "phase": phase,
                "connection": connection.to_dict(),
                "error": str(error),
                "retry_in_ms": delay_ms,
                "attempt": reconnect_attempt,
            }
        )

    def _calculate_reconnect_delay_ms(self, mode: BackendMode) -> int:
        if mode == "simulator":
            return self._poll_interval_ms

        exponent = max(0, self._consecutive_failures)
        base_delay_ms = max(self._poll_interval_ms, self._reconnect_base_ms)
        delay_ms = base_delay_ms * (2**exponent)
        return min(self._reconnect_max_ms, delay_ms)

    def _determine_communication_state(
        self,
        *,
        connection: ModbusConnectionConfig | None,
        has_snapshot: bool,
        is_stale: bool,
        last_error: str | None,
    ) -> str:
        if connection is None:
            return "disconnected"

        if is_stale:
            return "stale"

        if last_error is not None:
            return "polling_error"

        if has_snapshot:
            return "healthy"

        return "healthy"

    def _log_stale_state_change(
        self,
        *,
        is_stale: bool,
        age_ms: int | None,
        connection: ModbusConnectionConfig | None,
    ) -> None:
        with self._lock:
            previous_state = self._last_stale_state
            if previous_state == is_stale:
                return
            self._last_stale_state = is_stale

        if connection is None:
            return

        if is_stale:
            logger.warning(
                "PDI cache is stale for mode=%s host=%s age_ms=%s",
                connection.mode,
                connection.host,
                age_ms,
            )
        else:
            logger.info(
                "PDI cache is fresh again for mode=%s host=%s age_ms=%s",
                connection.mode,
                connection.host,
                age_ms,
            )

    def _log_communication_state_change(
        self,
        *,
        communication_state: str,
        connection: ModbusConnectionConfig | None,
        last_error: str | None,
        next_retry_in_ms: int | None,
    ) -> None:
        with self._lock:
            previous_state = self._last_communication_state
            if previous_state == communication_state:
                return
            self._last_communication_state = communication_state

        if connection is None:
            logger.info("Communication state changed to disconnected")
            return

        if communication_state == "healthy":
            logger.info(
                "Communication state changed to healthy for mode=%s host=%s",
                connection.mode,
                connection.host,
            )
            return

        if communication_state == "stale":
            logger.warning(
                "Communication state changed to stale for mode=%s host=%s last_error=%s",
                connection.mode,
                connection.host,
                last_error,
            )
            return

        logger.warning(
            "Communication state changed to polling_error for mode=%s host=%s next_retry_in_ms=%s last_error=%s",
            connection.mode,
            connection.host,
            next_retry_in_ms,
            last_error,
        )

    def _append_history_samples_locked(
        self,
        *,
        port_snapshots: dict[int, dict[str, object]],
        recorded_at_monotonic: float,
        recorded_at_iso: str,
        append_samples: bool,
    ) -> None:
        cutoff = recorded_at_monotonic - (self._history_retention_ms / 1000.0)

        for port in range(1, PORT_COUNT + 1):
            history_deque = self._history_by_port.setdefault(port, deque())
            snapshot = port_snapshots.get(port)

            if append_samples and snapshot is not None:
                sample = self._build_history_sample(
                    snapshot=snapshot,
                    recorded_at_iso=recorded_at_iso,
                )
                if sample is not None:
                    history_deque.append((recorded_at_monotonic, sample))

            while history_deque and history_deque[0][0] < cutoff:
                history_deque.popleft()

    def _should_sample_history_locked(self, recorded_at_monotonic: float) -> bool:
        if self._last_history_sample_monotonic is None:
            return True

        elapsed_ms = (recorded_at_monotonic - self._last_history_sample_monotonic) * 1000.0
        return elapsed_ms >= self._history_sample_interval_ms

    def _build_history_sample(
        self,
        *,
        snapshot: dict[str, object],
        recorded_at_iso: str,
    ) -> dict[str, object] | None:
        payload = snapshot.get("payload")
        if not isinstance(payload, dict):
            return None

        payload_registers = payload.get("registers")
        if not isinstance(payload_registers, list):
            return None

        source_registers = [
            int(register) & 0xFFFF
            for register in payload_registers[:HISTORY_SOURCE_REGISTER_COUNT]
        ]

        return {
            "timestamp": recorded_at_iso,
            "registers": source_registers,
            "hex": registers_to_bytes(source_registers).hex(" ").upper(),
        }

    def _resolve_history_request(
        self,
        *,
        window_ms: int | None,
        max_points: int | None,
    ) -> tuple[int, int]:
        resolved_window_ms = self._history_retention_ms if window_ms is None else max(
            1000,
            min(window_ms, self._history_retention_ms),
        )
        resolved_max_points = (
            self._history_max_points
            if max_points is None
            else max(10, min(max_points, self._history_max_points))
        )
        return resolved_window_ms, resolved_max_points

    def _select_history_samples(
        self,
        history_entries: list[tuple[float, dict[str, object]]],
        *,
        window_ms: int,
        max_points: int | None,
    ) -> list[dict[str, object]]:
        if not history_entries:
            return []

        cutoff = time.monotonic() - (window_ms / 1000.0)
        filtered_entries = [
            deepcopy(sample)
            for recorded_at_monotonic, sample in history_entries
            if recorded_at_monotonic >= cutoff
        ]

        if not filtered_entries:
            return []

        if max_points is None:
            return filtered_entries

        if len(filtered_entries) <= max_points:
            return filtered_entries

        if max_points <= 1:
            return [filtered_entries[-1]]

        step = (len(filtered_entries) - 1) / (max_points - 1)
        return [
            filtered_entries[min(len(filtered_entries) - 1, round(index * step))]
            for index in range(max_points)
        ]

    def _wait(self, timeout_seconds: float) -> None:
        if timeout_seconds <= 0:
            self._wake_event.clear()
            return

        self._wake_event.wait(timeout=timeout_seconds)
        self._wake_event.clear()

    def _wait_for_next_cycle(self, elapsed_seconds: float) -> None:
        remaining = max(0.0, (self._poll_interval_ms / 1000.0) - elapsed_seconds)
        self._wait(remaining)

    def _wait_for_retry_or_wake(self) -> None:
        with self._lock:
            next_retry_monotonic = self._next_retry_monotonic

        if next_retry_monotonic is None:
            self._wait_for_next_cycle(0.0)
            return

        remaining = max(0.0, next_retry_monotonic - time.monotonic())
        self._wake_event.wait(timeout=remaining)
        self._wake_event.clear()

    def _emit_event(self, event: dict[str, object]) -> None:
        if self._event_callback is None:
            return

        try:
            self._event_callback(event)
        except Exception:
            logger.exception("Polling event callback failed for event_type=%s", event.get("type"))

    def _run(self) -> None:
        active_connection: ModbusConnectionConfig | None = None
        active_revision = -1
        active_backend: ICE2Backend | None = None

        with self._lock:
            self._running = True

        try:
            logger.info("PDI cache worker loop started")
            while not self._stop_event.is_set():
                with self._lock:
                    target_connection = self._connection
                    target_revision = self._connection_revision

                if target_connection is None:
                    if active_backend is not None:
                        active_backend.close()
                        active_backend = None
                        active_connection = None
                        active_revision = -1
                        logger.info("Closed backend session because no active target is configured")

                    self._wait(self._poll_interval_ms / 1000.0)
                    continue

                if (
                    active_backend is None
                    or active_connection != target_connection
                    or active_revision != target_revision
                ):
                    with self._lock:
                        next_retry_monotonic = self._next_retry_monotonic

                    if next_retry_monotonic is not None:
                        retry_in_seconds = next_retry_monotonic - time.monotonic()
                        if retry_in_seconds > 0:
                            self._wait_for_retry_or_wake()
                            continue

                    try:
                        if active_backend is not None:
                            active_backend.close()

                        logger.info(
                            "Opening backend session for mode=%s host=%s port=%s slave_id=%s",
                            target_connection.mode,
                            target_connection.host,
                            target_connection.port,
                            target_connection.slave_id,
                        )
                        active_backend = self._backend_factory(target_connection)
                        active_backend.connect()
                        active_connection = target_connection
                        active_revision = target_revision
                    except Exception as error:
                        logger.warning(
                            "Backend session open failed for mode=%s host=%s: %s",
                            target_connection.mode,
                            target_connection.host,
                            error,
                        )
                        self._set_error(target_connection, error, phase="connect")
                        active_backend = None
                        active_connection = None
                        active_revision = -1
                        self._wait_for_retry_or_wake()
                        continue

                cycle_started = time.monotonic()

                try:
                    grouped_reads = active_backend.read_all_port_pdi(
                        ports=list(range(1, PORT_COUNT + 1)),
                        payload_word_count=self._payload_word_count,
                        block_mode=self._block_mode,
                    )
                    port_snapshots: dict[int, dict[str, object]] = {}

                    for port in range(1, PORT_COUNT + 1):
                        registers = grouped_reads[port]
                        port_snapshots[port] = self._snapshot_builder(
                            target_connection,
                            port,
                            self._block_mode,
                            self._payload_word_count,
                            registers,
                        )

                    self._set_success_snapshot(target_connection, port_snapshots)
                except Exception as error:
                    self._set_error(target_connection, error, phase="poll")

                    if active_backend is not None:
                        active_backend.close()
                        active_backend = None
                        active_connection = None
                        active_revision = -1

                    self._wait_for_retry_or_wake()
                    continue

                self._wait_for_next_cycle(time.monotonic() - cycle_started)
        finally:
            if active_backend is not None:
                active_backend.close()

            with self._lock:
                self._running = False

            logger.info("PDI cache worker loop stopped")
