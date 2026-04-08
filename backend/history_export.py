"""CSV export helpers for cached per-port PDI history."""

from __future__ import annotations

import csv
import io
import struct
from datetime import datetime, timedelta, timezone, tzinfo
from dataclasses import dataclass
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from converters import SupportedDataType, WordOrder, registers_to_bytes

ByteOrder = Literal["big", "little"]
FieldMode = Literal["full_word", "bit_field"]

EXPORT_RANGE_LABELS: dict[str, tuple[int, str]] = {
    "30s": (30_000, "30s"),
    "2m": (120_000, "2min"),
    "2min": (120_000, "2min"),
    "120s": (120_000, "2min"),
    "10m": (600_000, "10min"),
    "10min": (600_000, "10min"),
    "600s": (600_000, "10min"),
    "15m": (900_000, "15min"),
    "15min": (900_000, "15min"),
    "900s": (900_000, "15min"),
    "30m": (1_800_000, "30min"),
    "30min": (1_800_000, "30min"),
    "1800s": (1_800_000, "30min"),
    "1h": (3_600_000, "1h"),
    "60m": (3_600_000, "1h"),
    "60min": (3_600_000, "1h"),
    "3600s": (3_600_000, "1h"),
}


@dataclass(slots=True)
class HistoryExportConfig:
    """Frontend-selected decode profile for CSV export."""

    data_type: SupportedDataType
    word_order: WordOrder
    byte_order: ByteOrder
    resolution_factor: float
    source_word_count: int
    field_mode: FieldMode
    bit_offset: int
    bit_length: int
    signed: bool
    engineering_unit: str | None
    sentinel_mappings: dict[int, str]
    status: str | None = None
    event_code: str | None = None
    anomaly_state: str | None = None
    local_time_zone: str | None = None
    local_utc_offset_minutes: int | None = None


def parse_export_range(range_label: str) -> tuple[int, str]:
    """Map a compact export range label to milliseconds and filename-safe label."""

    normalized = range_label.strip().lower()

    if normalized not in EXPORT_RANGE_LABELS:
        raise ValueError(
            "Unsupported export range. Use 30s, 2min, 10min, 15min, 30min, or 1h."
        )

    return EXPORT_RANGE_LABELS[normalized]


def parse_sentinel_mapping_entries(entries: list[str]) -> dict[int, str]:
    """Parse repeated sentinel mapping query values like '16383=No Echo'."""

    mappings: dict[int, str] = {}

    for entry in entries:
        if "=" not in entry:
            continue

        raw_value, raw_label = entry.split("=", 1)
        label = raw_label.strip()

        if not label:
            continue

        try:
            value = int(raw_value.strip())
        except ValueError:
            continue

        mappings[value] = label

    return mappings


def build_export_filename(port: int, range_label: str) -> str:
    """Create a predictable CSV filename for the selected port and range."""

    return f"port{port}_pdi_history_{range_label}.csv"


def build_custom_export_filename(
    *,
    port: int,
    start_at: datetime,
    end_at: datetime,
) -> str:
    """Create a predictable CSV filename for a custom time interval."""

    start_label = start_at.astimezone(timezone.utc).strftime("%Y%m%d_%H%M%S")
    end_label = end_at.astimezone(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"port{port}_pdi_history_custom_{start_label}_to_{end_label}.csv"


def parse_export_time_bounds(
    start: str | None,
    end: str | None,
) -> tuple[datetime, datetime] | None:
    """Parse optional ISO 8601 custom export timestamps."""

    if start is None and end is None:
        return None

    if not start or not end:
        raise ValueError("Provide both start and end for a custom export range.")

    start_at = _parse_iso_timestamp(start, label="start")
    end_at = _parse_iso_timestamp(end, label="end")

    if start_at >= end_at:
        raise ValueError("Custom export start must be before end.")

    return start_at, end_at


def filter_history_samples_by_time(
    samples: list[dict[str, object]],
    *,
    start_at: datetime,
    end_at: datetime,
) -> tuple[list[dict[str, object]], datetime | None, datetime | None]:
    """Filter cached history samples to an inclusive custom timestamp range."""

    filtered_samples: list[dict[str, object]] = []
    earliest_available: datetime | None = None
    latest_available: datetime | None = None

    for sample in samples:
        timestamp = sample.get("timestamp")

        if not isinstance(timestamp, str):
            continue

        try:
            sample_time = _parse_iso_timestamp(timestamp, label="sample timestamp")
        except ValueError:
            continue

        if earliest_available is None or sample_time < earliest_available:
            earliest_available = sample_time

        if latest_available is None or sample_time > latest_available:
            latest_available = sample_time

        if start_at <= sample_time <= end_at:
            filtered_samples.append(sample)

    return filtered_samples, earliest_available, latest_available


def build_history_csv(
    *,
    port: int,
    samples: list[dict[str, object]],
    config: HistoryExportConfig,
) -> str:
    """Convert cached history samples into a CSV string."""

    output = io.StringIO()
    local_time_zone = _resolve_local_timezone(config)
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "timestamp_utc",
            "timestamp_local",
            "port",
            "raw_registers",
            "raw_hex",
            "extracted_value",
            "scaled_value",
            "unit",
            "sentinel_label",
            "status",
            "event_code",
            "anomaly_state",
        ],
        lineterminator="\n",
    )
    writer.writeheader()

    for sample in samples:
        registers = sample.get("registers")
        timestamp = sample.get("timestamp")
        raw_hex = sample.get("hex")

        if not isinstance(registers, list) or not isinstance(timestamp, str):
            continue

        try:
            sample_time = _parse_iso_timestamp(timestamp, label="sample timestamp")
        except ValueError:
            continue

        register_values = [int(register) & 0xFFFF for register in registers]
        extracted_value, scaled_value, sentinel_label = _decode_history_sample(
            register_values,
            config,
        )

        writer.writerow(
            {
                "timestamp_utc": _format_csv_timestamp(
                    sample_time.astimezone(timezone.utc)
                ),
                "timestamp_local": _format_csv_timestamp(
                    sample_time.astimezone(local_time_zone)
                ),
                "port": port,
                "raw_registers": " | ".join(str(register) for register in register_values),
                "raw_hex": raw_hex if isinstance(raw_hex, str) else registers_to_bytes(register_values).hex(" ").upper(),
                "extracted_value": extracted_value,
                "scaled_value": scaled_value,
                "unit": config.engineering_unit or "",
                "sentinel_label": sentinel_label or "",
                "status": config.status or "",
                "event_code": config.event_code or "",
                "anomaly_state": config.anomaly_state or "",
            }
        )

    return "\ufeff" + output.getvalue()


def resolve_display_timezone(
    *,
    local_time_zone: str | None,
    local_utc_offset_minutes: int | None,
) -> tzinfo:
    if local_time_zone:
        try:
            return ZoneInfo(local_time_zone)
        except ZoneInfoNotFoundError:
            pass

    if local_utc_offset_minutes is not None:
        return timezone(timedelta(minutes=local_utc_offset_minutes))

    return timezone.utc


def format_display_timestamp(
    value: datetime,
    *,
    local_time_zone: str | None,
    local_utc_offset_minutes: int | None,
) -> str:
    return _format_csv_timestamp(
        value.astimezone(
            resolve_display_timezone(
                local_time_zone=local_time_zone,
                local_utc_offset_minutes=local_utc_offset_minutes,
            )
        )
    )


def _resolve_local_timezone(config: HistoryExportConfig) -> tzinfo:
    return resolve_display_timezone(
        local_time_zone=config.local_time_zone,
        local_utc_offset_minutes=config.local_utc_offset_minutes,
    )


def _decode_history_sample(
    registers: list[int],
    config: HistoryExportConfig,
) -> tuple[str, str, str | None]:
    if config.field_mode == "bit_field":
        return _decode_bit_field_sample(registers, config)

    return _decode_full_word_sample(registers, config)


def _decode_bit_field_sample(
    registers: list[int],
    config: HistoryExportConfig,
) -> tuple[str, str, str | None]:
    register_count = max(1, min(config.source_word_count, len(registers)))
    source_registers = _get_ordered_registers(registers[:register_count], config)
    total_bit_length = len(source_registers) * 16

    if config.bit_offset < 0 or config.bit_offset >= total_bit_length:
        return "", "", None

    if config.bit_length < 1 or config.bit_offset + config.bit_length > total_bit_length:
        return "", "", None

    aggregate_value = 0
    for register in source_registers:
        aggregate_value = (aggregate_value << 16) | register

    field_mask = (1 << config.bit_length) - 1
    field_value = (aggregate_value >> config.bit_offset) & field_mask
    interpreted_value = _apply_signed(field_value, config.bit_length, config.signed)

    if config.data_type == "binary":
        binary_value = format(field_value, f"0{config.bit_length}b")
        return _group_binary(binary_value), _group_binary(binary_value), None

    extracted_value = _format_number(interpreted_value)
    sentinel_label = config.sentinel_mappings.get(int(interpreted_value))

    if sentinel_label is not None:
        return extracted_value, sentinel_label, sentinel_label

    scaled_numeric_value = interpreted_value * config.resolution_factor
    scaled_value = _format_number(scaled_numeric_value)

    return extracted_value, scaled_value, None


def _decode_full_word_sample(
    registers: list[int],
    config: HistoryExportConfig,
) -> tuple[str, str, str | None]:
    register_count = (
        max(1, min(config.source_word_count, len(registers)))
        if config.data_type == "binary"
        else _get_registers_needed(config.data_type)
    )

    if len(registers) < register_count:
        return "", "", None

    source_registers = _get_ordered_registers(registers[:register_count], config)

    if config.data_type == "binary":
        binary_value = "".join(
            format(byte_value, "08b")
            for byte_value in registers_to_bytes(source_registers)
        )
        grouped_value = _group_binary(binary_value)
        return grouped_value, grouped_value, None

    packed = registers_to_bytes(source_registers)
    extracted_numeric_value: float | int

    if config.data_type == "uint16":
        extracted_numeric_value = struct.unpack(">H", packed[:2])[0]
    elif config.data_type == "int16":
        extracted_numeric_value = struct.unpack(">h", packed[:2])[0]
    elif config.data_type == "uint32":
        extracted_numeric_value = struct.unpack(">I", packed[:4])[0]
    elif config.data_type == "int32":
        extracted_numeric_value = struct.unpack(">i", packed[:4])[0]
    elif config.data_type == "float32":
        extracted_numeric_value = struct.unpack(">f", packed[:4])[0]
    else:
        raise ValueError(f"Unsupported export data type: {config.data_type}")

    extracted_value = _format_number(extracted_numeric_value)
    sentinel_label: str | None = None

    if float(extracted_numeric_value).is_integer():
        sentinel_label = config.sentinel_mappings.get(int(extracted_numeric_value))

    if sentinel_label is not None:
        return extracted_value, sentinel_label, sentinel_label

    scaled_numeric_value = extracted_numeric_value * config.resolution_factor
    scaled_value = _format_number(scaled_numeric_value)

    return extracted_value, scaled_value, None


def _apply_signed(value: int, bit_length: int, signed: bool) -> int:
    if not signed or bit_length <= 0:
        return value

    sign_mask = 1 << (bit_length - 1)
    full_range = 1 << bit_length

    return value - full_range if (value & sign_mask) else value


def _get_registers_needed(data_type: SupportedDataType) -> int:
    if data_type in {"uint32", "int32", "float32", "binary"}:
        return 2

    return 1


def _swap_register_bytes(register_value: int) -> int:
    return ((register_value & 0xFF) << 8) | ((register_value >> 8) & 0xFF)


def _get_ordered_registers(
    registers: list[int],
    config: HistoryExportConfig,
) -> list[int]:
    byte_ordered_registers = [
        _swap_register_bytes(register_value) if config.byte_order == "little" else register_value
        for register_value in registers
    ]

    return list(reversed(byte_ordered_registers)) if config.word_order == "little" else byte_ordered_registers


def _group_binary(binary_value: str) -> str:
    return " ".join(
        binary_value[index : index + 8]
        for index in range(0, len(binary_value), 8)
    )


def _format_number(value: float | int) -> str:
    if isinstance(value, int):
        return str(value)

    if value.is_integer():
        return str(int(value))

    absolute_value = abs(value)
    if absolute_value >= 1000:
        formatted_value = f"{value:.0f}"
    elif absolute_value >= 100:
        formatted_value = f"{value:.1f}"
    elif absolute_value >= 10:
        formatted_value = f"{value:.2f}"
    elif absolute_value >= 1:
        formatted_value = f"{value:.3f}"
    elif absolute_value >= 0.01:
        formatted_value = f"{value:.4f}"
    else:
        formatted_value = f"{value:.6g}"

    return formatted_value.rstrip("0").rstrip(".")


def _format_csv_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _parse_iso_timestamp(value: str, *, label: str) -> datetime:
    normalized = value.strip()

    if not normalized:
        raise ValueError(f"Custom export {label} time cannot be empty.")

    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(
            f"Custom export {label} time must be a valid ISO timestamp."
        ) from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)
