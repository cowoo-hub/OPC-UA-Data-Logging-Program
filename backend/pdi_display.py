"""Canonical PDI display model helpers shared by UI-oriented integrations like OPC UA."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Literal

from converters import SupportedDataType, WordOrder, convert_register_value

ByteOrder = Literal["big", "little"]
FieldMode = Literal["full_word", "bit_field"]
ProcessDataProfileMode = Literal["manual", "profile", "auto"]

SUPPORTED_DECODE_TYPES = {"uint16", "int16", "uint32", "int32", "float32", "binary"}
SUPPORTED_WORD_ORDERS = {"big", "little"}
SUPPORTED_BYTE_ORDERS = {"big", "little"}
SUPPORTED_FIELD_MODES = {"full_word", "bit_field"}
SUPPORTED_PROCESS_DATA_MODES = {"manual", "profile", "auto"}
SUPPORTED_RESOLUTION_FACTORS = {1.0, 0.1, 0.01, 0.001}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _swap_register_bytes(register_value: int) -> int:
    return ((register_value & 0xFF) << 8) | ((register_value >> 8) & 0xFF)


def _normalize_registers(registers: list[int]) -> list[int]:
    normalized: list[int] = []
    for register_value in registers:
        normalized_value = int(register_value)
        if normalized_value < 0 or normalized_value > 0xFFFF:
            raise ValueError(f"Register value out of range: {register_value}")
        normalized.append(normalized_value)
    return normalized


def _normalize_scaled_number(value: float) -> float:
    return float(f"{value:.12g}")


def _normalize_comparable_numeric_value(value: float) -> float:
    return float(f"{value:.12g}")


def _format_numeric_value(value: float | int) -> str:
    numeric_value = float(value)
    if numeric_value.is_integer():
        return f"{int(numeric_value):,}"
    return f"{numeric_value:.3f}".rstrip("0").rstrip(".")


def _format_decoded_value(value: int | float | str, data_type: SupportedDataType) -> str:
    if isinstance(value, str):
        if data_type != "binary":
            return value
        return " ".join(value[index:index + 8] for index in range(0, len(value), 8))
    return _format_numeric_value(value)


def _resolve_mapped_text_label(
    value: float,
    mappings: list[dict[str, object]],
) -> str | None:
    normalized_value = _normalize_comparable_numeric_value(value)

    for mapping in mappings:
        mapping_value = mapping.get("value")
        mapping_label = mapping.get("label")
        if not isinstance(mapping_value, (int, float)) or not isinstance(mapping_label, str):
            continue

        normalized_mapping_value = _normalize_comparable_numeric_value(float(mapping_value))
        if float(normalized_value).is_integer() and float(normalized_mapping_value).is_integer():
            if normalized_mapping_value == normalized_value:
                return mapping_label
            continue

        tolerance = max(1e-9, abs(normalized_value) * 1e-9)
        if abs(normalized_mapping_value - normalized_value) <= tolerance:
            return mapping_label

    return None


def _build_unavailable_preview(message: str = "Decode unavailable") -> dict[str, object]:
    return {
        "displayValue": "Unavailable",
        "rawValue": None,
        "scaledValue": None,
        "mappingComparisonValue": None,
        "rawDisplayValue": None,
        "sourceRegisters": [],
        "error": message,
        "sentinelLabel": None,
        "statusBits": [],
    }


def _get_ordered_registers(
    registers: list[int],
    *,
    word_order: WordOrder,
    byte_order: ByteOrder,
) -> list[int]:
    byte_ordered_registers = [
        _swap_register_bytes(register_value) if byte_order == "little" else register_value
        for register_value in _normalize_registers(registers)
    ]
    return list(reversed(byte_ordered_registers)) if word_order == "little" else byte_ordered_registers


def _apply_signed_interpretation(value: int, bit_length: int, signed: bool) -> int:
    if not signed or bit_length <= 0:
        return value

    sign_mask = 1 << (bit_length - 1)
    full_range = 1 << bit_length
    return value - full_range if (value & sign_mask) else value


def _build_status_bit_states(
    aggregate_value: int,
    status_bits: list[dict[str, object]],
) -> list[dict[str, object]]:
    states: list[dict[str, object]] = []
    for status_bit in status_bits:
        bit = status_bit.get("bit")
        label = status_bit.get("label")
        if not isinstance(bit, int) or not isinstance(label, str):
            continue
        states.append(
            {
                "bit": bit,
                "label": label,
                "active": ((aggregate_value >> bit) & 1) == 1,
            }
        )
    return states


def _build_preview_from_converted_value(
    data_type: SupportedDataType,
    source_registers: list[int],
    converted_value: int | float | str,
) -> dict[str, object]:
    raw_display_value = _format_decoded_value(converted_value, data_type)
    return {
        "displayValue": raw_display_value,
        "rawValue": converted_value,
        "scaledValue": converted_value,
        "mappingComparisonValue": (
            _normalize_comparable_numeric_value(float(converted_value))
            if isinstance(converted_value, (int, float))
            else None
        ),
        "rawDisplayValue": raw_display_value,
        "sourceRegisters": source_registers,
        "error": None,
        "sentinelLabel": None,
        "statusBits": [],
    }


def _get_registers_needed(data_type: SupportedDataType) -> int:
    if data_type in {"uint32", "int32", "float32", "binary"}:
        return 2
    return 1


def _decode_full_word_preview(
    registers: list[int],
    *,
    config: dict[str, object],
    data_type: SupportedDataType,
) -> dict[str, object]:
    register_count = _get_registers_needed(data_type)
    normalized = _normalize_registers(registers)[:register_count]
    if len(normalized) < register_count:
        raise ValueError(f"{data_type} conversion needs {register_count} register(s)")

    source_registers = [
        _swap_register_bytes(word) if config["byteOrder"] == "little" else word
        for word in normalized
    ]

    converted_value = convert_register_value(
        source_registers,
        data_type=data_type,
        word_order=config["wordOrder"],
        word_length=len(source_registers) if data_type == "binary" else None,
    )
    preview = _build_preview_from_converted_value(data_type, source_registers, converted_value)
    ordered_registers = _get_ordered_registers(
        source_registers,
        word_order=config["wordOrder"],
        byte_order="big",
    )
    aggregate_value = 0
    for register_value in ordered_registers:
        aggregate_value = (aggregate_value << 16) | register_value
    preview["statusBits"] = _build_status_bit_states(aggregate_value, config["statusBits"])
    return preview


def _decode_bit_field_preview(
    registers: list[int],
    *,
    config: dict[str, object],
    data_type: SupportedDataType,
) -> dict[str, object]:
    source_word_count = int(config["sourceWordCount"])
    normalized = _normalize_registers(registers)[:source_word_count]
    if len(normalized) < source_word_count:
        raise ValueError(f"Bit-field decode needs {source_word_count} register(s)")

    source_registers = _get_ordered_registers(
        normalized,
        word_order=config["wordOrder"],
        byte_order=config["byteOrder"],
    )
    aggregate_value = 0
    for register_value in source_registers:
        aggregate_value = (aggregate_value << 16) | register_value

    total_bit_length = len(source_registers) * 16
    bit_offset = int(config["bitOffset"])
    bit_length = int(config["bitLength"])
    if bit_offset < 0 or bit_offset >= total_bit_length:
        raise ValueError("Bit offset is outside the available source register range")
    if bit_length < 1 or bit_offset + bit_length > total_bit_length:
        raise ValueError("Bit length exceeds the available source register range")

    field_mask = (1 << bit_length) - 1
    field_value = (aggregate_value >> bit_offset) & field_mask
    status_bits = _build_status_bit_states(aggregate_value, config["statusBits"])

    if data_type == "binary":
        binary_value = format(field_value, f"0{bit_length}b")
        return {
            "displayValue": _format_decoded_value(binary_value, data_type),
            "rawValue": binary_value,
            "scaledValue": binary_value,
            "mappingComparisonValue": None,
            "rawDisplayValue": binary_value,
            "sourceRegisters": source_registers,
            "error": None,
            "sentinelLabel": None,
            "statusBits": status_bits,
        }

    interpreted_value = _apply_signed_interpretation(field_value, bit_length, bool(config["signed"]))
    raw_display_value = _format_numeric_value(interpreted_value)
    return {
        "displayValue": _format_decoded_value(interpreted_value, data_type),
        "rawValue": interpreted_value,
        "scaledValue": interpreted_value,
        "mappingComparisonValue": _normalize_comparable_numeric_value(float(interpreted_value)),
        "rawDisplayValue": raw_display_value,
        "sourceRegisters": source_registers,
        "error": None,
        "sentinelLabel": None,
        "statusBits": status_bits,
    }


def _apply_resolution_to_preview(
    preview: dict[str, object],
    *,
    data_type: SupportedDataType,
    resolution_factor: float,
    mappings: list[dict[str, object]],
) -> dict[str, object]:
    if preview.get("error") is not None or preview.get("rawValue") is None:
        return preview

    raw_value = preview.get("rawValue")
    raw_display_value = preview.get("rawDisplayValue")
    if not isinstance(raw_display_value, str):
        raw_display_value = _format_decoded_value(raw_value, data_type) if raw_value is not None else None

    if preview.get("sentinelLabel"):
        return {
            **preview,
            "rawDisplayValue": raw_display_value,
            "scaledValue": preview["sentinelLabel"],
            "displayValue": preview["sentinelLabel"],
        }

    if not isinstance(raw_value, (int, float)):
        return {
            **preview,
            "rawDisplayValue": raw_display_value,
            "scaledValue": raw_value,
            "mappingComparisonValue": None,
            "displayValue": raw_display_value,
            "sentinelLabel": None,
        }

    scaled_value = _normalize_scaled_number(float(raw_value) * resolution_factor)
    mapping_comparison_value = _normalize_comparable_numeric_value(scaled_value)
    mapped_text_label = _resolve_mapped_text_label(scaled_value, mappings)

    return {
        **preview,
        "rawDisplayValue": raw_display_value,
        "scaledValue": scaled_value,
        "mappingComparisonValue": mapping_comparison_value,
        "displayValue": mapped_text_label or _format_decoded_value(scaled_value, data_type),
        "sentinelLabel": mapped_text_label,
    }


def _build_manual_display_preview(
    registers: list[int],
    config: dict[str, object],
) -> dict[str, object]:
    data_type = config["preferredDecodeType"]
    try:
        if config["fieldMode"] == "bit_field":
            preview = _decode_bit_field_preview(registers, config=config, data_type=data_type)
        else:
            preview = _decode_full_word_preview(registers, config=config, data_type=data_type)
        return _apply_resolution_to_preview(
            preview,
            data_type=data_type,
            resolution_factor=float(config["resolutionFactor"]),
            mappings=config["sentinelMappings"],
        )
    except Exception as error:
        return _build_unavailable_preview(str(error))


def _format_field_bit_range(bit_offset: int, bit_length: int) -> str:
    if bit_length <= 1:
        return f"bit {bit_offset}"
    return f"bits {bit_offset}-{bit_offset + bit_length - 1}"


def _match_enum_label(value: float, mappings: list[dict[str, object]] | None) -> str | None:
    if not mappings:
        return None
    return _resolve_mapped_text_label(value, mappings)


def _parse_process_data_field(
    aggregate_value: int,
    field: dict[str, object],
) -> dict[str, object]:
    bit_offset = int(field["bitOffset"])
    bit_length = int(field["bitLength"])
    field_mask = (1 << bit_length) - 1
    extracted_value = (aggregate_value >> bit_offset) & field_mask
    role = field.get("role") if isinstance(field.get("role"), str) else None
    description = field.get("description") if isinstance(field.get("description"), str) else None
    field_type = field["type"]
    unit = field.get("unit") if isinstance(field.get("unit"), str) else None
    base_payload = {
        "name": field["name"],
        "label": field["label"],
        "type": field_type,
        "role": role,
        "bitOffset": bit_offset,
        "bitLength": bit_length,
        "bitRangeLabel": _format_field_bit_range(bit_offset, bit_length),
        "unit": unit,
        "description": description,
    }

    if field_type == "bool":
        active = extracted_value == 1
        return {
            **base_payload,
            "rawValue": active,
            "rawDisplayValue": "1" if active else "0",
            "scaledValue": active,
            "displayValue": "ON" if active else "OFF",
            "active": active,
            "isMapped": False,
        }

    if field_type == "binary":
        binary_value = format(extracted_value, f"0{bit_length}b")
        return {
            **base_payload,
            "rawValue": binary_value,
            "rawDisplayValue": binary_value,
            "scaledValue": binary_value,
            "displayValue": _format_decoded_value(binary_value, "binary"),
            "active": None,
            "isMapped": False,
        }

    if field_type == "float32":
        raw_numeric_value = struct.unpack(">f", int(extracted_value & 0xFFFFFFFF).to_bytes(4, "big"))[0]
    elif field_type == "int":
        raw_numeric_value = _apply_signed_interpretation(extracted_value, bit_length, True)
    else:
        raw_numeric_value = _apply_signed_interpretation(
            extracted_value,
            bit_length,
            bool(field.get("signed")),
        )

    enum_mappings = field.get("enumMappings")
    mapped_label = _match_enum_label(
        float(raw_numeric_value),
        enum_mappings if isinstance(enum_mappings, list) else None,
    )
    scale_factor = field.get("scaleFactor")
    scaled_numeric_value = (
        _normalize_comparable_numeric_value(float(raw_numeric_value) * float(scale_factor))
        if mapped_label is None and isinstance(scale_factor, (int, float))
        else raw_numeric_value
    )
    display_value = mapped_label or _format_numeric_value(float(scaled_numeric_value))

    return {
        **base_payload,
        "rawValue": raw_numeric_value,
        "rawDisplayValue": _format_numeric_value(float(raw_numeric_value)),
        "scaledValue": scaled_numeric_value,
        "displayValue": display_value,
        "active": None,
        "isMapped": mapped_label is not None,
    }


def _parse_process_data_profile(
    registers: list[int],
    profile: dict[str, object],
    *,
    word_order: WordOrder,
    byte_order: ByteOrder,
    resolution_source: str,
) -> dict[str, object]:
    try:
        source_word_count = int(profile["sourceWordCount"])
        source_registers = _get_ordered_registers(
            registers[:source_word_count],
            word_order=word_order,
            byte_order=byte_order,
        )
        if len(source_registers) < source_word_count:
            return {
                **profile,
                "resolutionSource": resolution_source,
                "sourceRegisters": [],
                "rawHex": "",
                "primaryField": None,
                "fields": [],
                "statusFields": [],
                "qualityFields": [],
                "error": f"Profile needs {source_word_count} source word(s).",
            }

        aggregate_value = 0
        for register_value in source_registers:
            aggregate_value = (aggregate_value << 16) | register_value

        total_bit_length = int(profile["totalBitLength"])
        if total_bit_length > len(source_registers) * 16:
            return {
                **profile,
                "resolutionSource": resolution_source,
                "sourceRegisters": source_registers,
                "rawHex": "",
                "primaryField": None,
                "fields": [],
                "statusFields": [],
                "qualityFields": [],
                "error": "Profile bit length exceeds the available source register window.",
            }

        fields = [
            _parse_process_data_field(aggregate_value, field)
            for field in profile["fields"]
            if isinstance(field, dict)
        ]
        primary_field_name = profile.get("primaryFieldName")
        primary_field = None
        if isinstance(primary_field_name, str):
            primary_field = next((field for field in fields if field["name"] == primary_field_name), None)
        if primary_field is None:
            primary_field = next((field for field in fields if field.get("role") == "primary_value"), None)

        raw_hex = " ".join(f"{((_register >> shift) & 0xFF):02X}" for _register in source_registers for shift in (8, 0))
        status_fields = [field for field in fields if field.get("role") == "status"]
        quality_fields = [field for field in fields if field.get("role") == "quality"]
        return {
            "id": profile.get("id"),
            "name": profile.get("name"),
            "description": profile.get("description"),
            "deviceKey": profile.get("deviceKey"),
            "vendorId": profile.get("vendorId"),
            "deviceId": profile.get("deviceId"),
            "totalBitLength": total_bit_length,
            "sourceWordCount": source_word_count,
            "resolutionSource": resolution_source,
            "sourceRegisters": source_registers,
            "rawHex": raw_hex,
            "primaryField": primary_field,
            "fields": fields,
            "statusFields": status_fields,
            "qualityFields": quality_fields,
            "error": None,
        }
    except Exception as error:
        return {
            "id": profile.get("id"),
            "name": profile.get("name"),
            "description": profile.get("description"),
            "deviceKey": profile.get("deviceKey"),
            "vendorId": profile.get("vendorId"),
            "deviceId": profile.get("deviceId"),
            "totalBitLength": profile.get("totalBitLength"),
            "sourceWordCount": profile.get("sourceWordCount"),
            "resolutionSource": resolution_source,
            "sourceRegisters": [],
            "rawHex": "",
            "primaryField": None,
            "fields": [],
            "statusFields": [],
            "qualityFields": [],
            "error": str(error),
        }


def _build_process_data_preview(parsed_profile: dict[str, object]) -> dict[str, object] | None:
    primary_field = parsed_profile.get("primaryField")
    if not isinstance(primary_field, dict):
        return None

    status_fields = parsed_profile.get("statusFields")
    status_bits = []
    if isinstance(status_fields, list):
        for field in status_fields:
            if not isinstance(field, dict):
                continue
            if field.get("active") is None:
                continue
            status_bits.append(
                {
                    "bit": field.get("bitOffset"),
                    "label": field.get("label"),
                    "active": bool(field.get("active")),
                }
            )

    raw_value = primary_field.get("rawValue")
    scaled_value = primary_field.get("scaledValue")
    return {
        "displayValue": primary_field.get("displayValue"),
        "rawValue": primary_field.get("rawDisplayValue") if isinstance(raw_value, bool) else raw_value,
        "scaledValue": primary_field.get("displayValue") if isinstance(scaled_value, bool) else scaled_value,
        "mappingComparisonValue": (
            _normalize_comparable_numeric_value(float(scaled_value))
            if isinstance(scaled_value, (int, float))
            else None
        ),
        "rawDisplayValue": primary_field.get("rawDisplayValue"),
        "sourceRegisters": parsed_profile.get("sourceRegisters") if isinstance(parsed_profile.get("sourceRegisters"), list) else [],
        "error": None,
        "sentinelLabel": primary_field.get("displayValue") if primary_field.get("isMapped") else None,
        "statusBits": status_bits,
    }


def _normalize_status_bits(raw_status_bits: object) -> list[dict[str, object]]:
    if not isinstance(raw_status_bits, list):
        return []
    normalized: list[dict[str, object]] = []
    for raw_status_bit in raw_status_bits:
        if not isinstance(raw_status_bit, dict):
            continue
        bit = raw_status_bit.get("bit")
        label = raw_status_bit.get("label")
        if isinstance(bit, int) and isinstance(label, str):
            normalized.append({"bit": bit, "label": label})
    return normalized


def _normalize_sentinel_mappings(raw_mappings: object) -> list[dict[str, object]]:
    if not isinstance(raw_mappings, list):
        return []
    normalized: list[dict[str, object]] = []
    for raw_mapping in raw_mappings:
        if not isinstance(raw_mapping, dict):
            continue
        value = raw_mapping.get("value")
        label = raw_mapping.get("label")
        if isinstance(value, (int, float)) and isinstance(label, str):
            normalized.append({"value": float(value), "label": label})
    return normalized


def sanitize_display_config(raw_config: dict[str, object], *, port_number: int) -> dict[str, object]:
    preferred_decode_type = raw_config.get("preferredDecodeType")
    word_order = raw_config.get("wordOrder")
    byte_order = raw_config.get("byteOrder")
    field_mode = raw_config.get("fieldMode")
    process_data_mode = raw_config.get("processDataMode")
    resolution_factor = float(raw_config.get("resolutionFactor", 1))
    source_word_count = int(raw_config.get("sourceWordCount", 2))
    bit_offset = int(raw_config.get("bitOffset", 0))
    bit_length = int(raw_config.get("bitLength", 16))

    if preferred_decode_type not in SUPPORTED_DECODE_TYPES:
        preferred_decode_type = "uint16"
    if word_order not in SUPPORTED_WORD_ORDERS:
        word_order = "big"
    if byte_order not in SUPPORTED_BYTE_ORDERS:
        byte_order = "big"
    if field_mode not in SUPPORTED_FIELD_MODES:
        field_mode = "full_word"
    if process_data_mode not in SUPPORTED_PROCESS_DATA_MODES:
        process_data_mode = "manual"
    if resolution_factor not in SUPPORTED_RESOLUTION_FACTORS:
        resolution_factor = 1.0

    engineering_unit = raw_config.get("engineeringUnit")
    engineering_label = raw_config.get("engineeringLabel")
    return {
        "portNumber": port_number,
        "label": raw_config.get("label") if isinstance(raw_config.get("label"), str) else f"Port {port_number}",
        "profileId": raw_config.get("profileId") if isinstance(raw_config.get("profileId"), str) else "generic",
        "profileLabel": raw_config.get("profileLabel") if isinstance(raw_config.get("profileLabel"), str) else "Generic",
        "engineeringLabel": engineering_label if isinstance(engineering_label, str) else "Value",
        "engineeringUnit": engineering_unit if isinstance(engineering_unit, str) else None,
        "operatorHint": raw_config.get("operatorHint") if isinstance(raw_config.get("operatorHint"), str) else "",
        "preferredDecodeType": preferred_decode_type,
        "wordOrder": word_order,
        "byteOrder": byte_order,
        "resolutionFactor": resolution_factor,
        "sourceWordCount": max(1, min(source_word_count, 8)),
        "fieldMode": field_mode,
        "bitOffset": max(0, bit_offset),
        "bitLength": max(1, bit_length),
        "signed": bool(raw_config.get("signed")),
        "sentinelMappings": _normalize_sentinel_mappings(raw_config.get("sentinelMappings")),
        "statusBits": _normalize_status_bits(raw_config.get("statusBits")),
        "processDataMode": process_data_mode,
        "processDataProfileId": (
            raw_config.get("processDataProfileId")
            if isinstance(raw_config.get("processDataProfileId"), str)
            else None
        ),
        "usesProfileDefaults": bool(raw_config.get("usesProfileDefaults")),
        "isCustomized": bool(raw_config.get("isCustomized")),
    }


def sanitize_process_data_profile(raw_profile: object) -> dict[str, object] | None:
    if not isinstance(raw_profile, dict):
        return None
    fields = raw_profile.get("fields")
    if not isinstance(fields, list):
        return None
    normalized_fields = [field for field in fields if isinstance(field, dict)]
    return {
        "id": raw_profile.get("id"),
        "name": raw_profile.get("name"),
        "description": raw_profile.get("description"),
        "deviceKey": raw_profile.get("deviceKey"),
        "vendorId": raw_profile.get("vendorId"),
        "deviceId": raw_profile.get("deviceId"),
        "totalBitLength": raw_profile.get("totalBitLength"),
        "sourceWordCount": raw_profile.get("sourceWordCount"),
        "fields": normalized_fields,
        "primaryFieldName": raw_profile.get("primaryFieldName"),
    }


def derive_port_severity(snapshot: dict[str, object]) -> str:
    header = snapshot.get("header")
    if not isinstance(header, dict):
        return "normal"
    port_status = header.get("port_status")
    event_code = header.get("event_code")
    if not isinstance(port_status, dict):
        return "normal"
    if bool(port_status.get("fault")):
        return "critical"
    if not bool(port_status.get("pdi_valid")):
        return "warning"
    if isinstance(event_code, dict) and bool(event_code.get("active")):
        return "warning"
    return "normal"


def build_display_state_payload(
    *,
    snapshot: dict[str, object],
    config: dict[str, object],
    process_data_profile: dict[str, object] | None,
) -> dict[str, object]:
    payload = snapshot.get("payload")
    registers = payload.get("registers") if isinstance(payload, dict) else None
    if not isinstance(registers, list):
        return {
            "config": config,
            "featuredPreview": _build_unavailable_preview("Awaiting cached payload"),
            "processData": None,
            "severity": derive_port_severity(snapshot),
            "syncedAt": _utc_now_iso(),
        }

    normalized_registers = [int(register) & 0xFFFF for register in registers]
    process_data = None
    featured_preview = None
    if config["processDataMode"] != "manual" and process_data_profile is not None:
        process_data = _parse_process_data_profile(
            normalized_registers,
            process_data_profile,
            word_order=config["wordOrder"],
            byte_order=config["byteOrder"],
            resolution_source=(
                "manual_selection" if config["processDataMode"] == "profile" else "device_identity"
            ),
        )
        featured_preview = _build_process_data_preview(process_data)

    if featured_preview is None:
        featured_preview = _build_manual_display_preview(normalized_registers, config)

    return {
        "config": config,
        "featuredPreview": featured_preview,
        "processData": process_data,
        "severity": derive_port_severity(snapshot),
        "syncedAt": _utc_now_iso(),
    }


@dataclass(slots=True)
class DisplaySyncState:
    config: dict[str, object]
    process_data_profile: dict[str, object] | None
    synced_at: str

    def to_dict(self) -> dict[str, object]:
        return {
            "config": self.config,
            "processDataProfile": self.process_data_profile,
            "syncedAt": self.synced_at,
        }


class DisplaySyncStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._states: dict[int, DisplaySyncState] = {}
        self._updated_at: str | None = None

    def update(self, states_by_port: dict[int, dict[str, object]]) -> str:
        next_states: dict[int, DisplaySyncState] = {}
        synced_at = _utc_now_iso()
        for port_number, payload in states_by_port.items():
            if not isinstance(payload, dict):
                continue
            config = payload.get("config")
            if not isinstance(config, dict):
                continue
            next_states[port_number] = DisplaySyncState(
                config=sanitize_display_config(config, port_number=port_number),
                process_data_profile=sanitize_process_data_profile(payload.get("processDataProfile")),
                synced_at=synced_at,
            )

        with self._lock:
            self._states = next_states
            self._updated_at = synced_at

        return synced_at

    def get_state(self, port_number: int) -> DisplaySyncState | None:
        with self._lock:
            return self._states.get(port_number)

    def get_all(self) -> dict[int, dict[str, object]]:
        with self._lock:
            return {
                port_number: state.to_dict()
                for port_number, state in self._states.items()
            }

    def get_updated_at(self) -> str | None:
        with self._lock:
            return self._updated_at
