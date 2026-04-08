"""IODD upload, parsing, and local library persistence helpers."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
from typing import Any
import xml.etree.ElementTree as ET

logger = logging.getLogger("ice2.backend.iodd")
_IODD_PROFILE_SCHEMA_VERSION = 2

_INDEX_KEYS = ("index", "Index", "indexId", "IndexId", "indexNo", "IndexNo")
_SUBINDEX_KEYS = (
    "subindex",
    "Subindex",
    "subIndex",
    "SubIndex",
    "subindexId",
    "SubindexId",
)
_BIT_OFFSET_KEYS = ("bitOffset", "BitOffset", "bitPosition", "BitPosition", "offset", "Offset")
_BIT_LENGTH_KEYS = ("bitLength", "BitLength", "bitCount", "BitCount", "length", "Length")
_DATA_TYPE_KEYS = ("dataType", "DataType", "datatype", "Datatype", "type", "Type")
_ACCESS_KEYS = (
    "accessRights",
    "AccessRights",
    "access",
    "Access",
    "readWrite",
    "ReadWrite",
)
_UNIT_KEYS = ("unit", "Unit", "unitCode", "UnitCode")
_NAME_KEYS = (
    "name",
    "Name",
    "label",
    "Label",
    "displayName",
    "DisplayName",
    "textId",
    "TextId",
    "id",
    "Id",
)
_DESCRIPTION_KEYS = ("description", "Description", "comment", "Comment", "note", "Note")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _safe_text(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "profile"


def _parse_integer(value: str | None) -> int | None:
    if not value:
        return None

    candidate = value.strip()
    if not candidate:
        return None

    try:
        if candidate.lower() == "true":
            return 1
        if candidate.lower() == "false":
            return 0
        if candidate.lower().startswith("0x"):
            return int(candidate, 16)
        return int(candidate)
    except ValueError:
        return None


def _extract_attr_by_local_name(node: ET.Element, attribute_names: tuple[str, ...]) -> str | None:
    normalized_names = {attribute_name.lower() for attribute_name in attribute_names}

    for attribute_key, attribute_value in node.attrib.items():
        if _local_name(attribute_key).lower() not in normalized_names:
            continue

        value = _safe_text(attribute_value)
        if value:
            return value

    return None


def _build_text_lookup(root: ET.Element) -> dict[str, str]:
    lookup: dict[str, str] = {}

    for node in root.iter():
        node_id = None
        for key in ("id", "Id", "textId", "TextId"):
            node_id = _safe_text(node.attrib.get(key))
            if node_id:
                break

        if not node_id:
            continue

        value = None
        for key in ("value", "Value", "name", "Name", "text", "Text", "default", "Default"):
            value = _safe_text(node.attrib.get(key))
            if value:
                break

        if value is None:
            value = _safe_text(node.text)

        if value:
            lookup[node_id] = value

    return lookup


def _build_datatype_lookup(root: ET.Element) -> dict[str, ET.Element]:
    lookup: dict[str, ET.Element] = {}

    for node in root.iter():
        local_name = _local_name(node.tag).lower()
        if local_name not in {"datatype", "simpledatatype"}:
            continue

        datatype_id = _safe_text(node.attrib.get("id") or node.attrib.get("Id"))
        if datatype_id:
            lookup[datatype_id] = node

    return lookup


def _resolve_text(candidate: str | None, text_lookup: dict[str, str]) -> str | None:
    if not candidate:
        return None

    return text_lookup.get(candidate, candidate)


def _find_first_text(root: ET.Element, tag_names: tuple[str, ...], text_lookup: dict[str, str]) -> str | None:
    lowered = {name.lower() for name in tag_names}

    for node in root.iter():
        if _local_name(node.tag).lower() not in lowered:
            continue

        value = _resolve_text(_safe_text(node.text), text_lookup)
        if value:
            return value

        for key in _NAME_KEYS:
            value = _resolve_text(_safe_text(node.attrib.get(key)), text_lookup)
            if value:
                return value

    return None


def _extract_text_value(node: ET.Element, keys: tuple[str, ...], text_lookup: dict[str, str]) -> str | None:
    for key in keys:
        value = _resolve_text(_safe_text(node.attrib.get(key)), text_lookup)
        if value:
            return value

    lowered = {key.lower() for key in keys}
    for child in node:
        if _local_name(child.tag).lower() not in lowered:
            continue

        value = _resolve_text(_safe_text(child.text), text_lookup)
        if value:
            return value

        for key in _NAME_KEYS:
            value = _resolve_text(_safe_text(child.attrib.get(key)), text_lookup)
            if value:
                return value

    return None


def _extract_integer_value(node: ET.Element, keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = _parse_integer(_safe_text(node.attrib.get(key)))
        if value is not None:
            return value

    lowered = {key.lower() for key in keys}
    for child in node:
        if _local_name(child.tag).lower() not in lowered:
            continue

        value = _parse_integer(_safe_text(child.text))
        if value is not None:
            return value

    return None


def _extract_name(node: ET.Element, text_lookup: dict[str, str]) -> str | None:
    return _extract_text_value(node, _NAME_KEYS, text_lookup)


def _extract_description(node: ET.Element, text_lookup: dict[str, str]) -> str | None:
    return _extract_text_value(node, _DESCRIPTION_KEYS, text_lookup)


def _extract_enum_mappings(node: ET.Element, text_lookup: dict[str, str]) -> list[dict[str, Any]]:
    mappings: list[dict[str, Any]] = []
    seen_values: set[int] = set()

    for child in node.iter():
        local_name = _local_name(child.tag).lower()
        if "singlevalue" not in local_name and "enum" not in local_name:
            continue

        numeric_value = _extract_integer_value(
            child,
            ("value", "Value", "code", "Code", "id", "Id"),
        )
        if numeric_value is None:
            numeric_value = _parse_integer(_safe_text(child.text))
        label = _extract_name(child, text_lookup) or _extract_description(child, text_lookup)

        if numeric_value is None or not label or numeric_value in seen_values:
            continue

        mappings.append({"value": numeric_value, "label": label})
        seen_values.add(numeric_value)

    return mappings


def _resolve_datatype_node(node: ET.Element, datatype_lookup: dict[str, ET.Element]) -> ET.Element | None:
    local_name = _local_name(node.tag).lower()
    if local_name in {"datatype", "simpledatatype"}:
        return node

    for child in node:
        child_local_name = _local_name(child.tag).lower()
        if child_local_name == "simpledatatype":
            return child

        if child_local_name != "datatyperef":
            continue

        datatype_id = _safe_text(child.attrib.get("datatypeId") or child.attrib.get("DatatypeId"))
        if datatype_id and datatype_id in datatype_lookup:
            return datatype_lookup[datatype_id]

    return None


def _extract_effective_data_type(
    node: ET.Element,
    datatype_lookup: dict[str, ET.Element],
) -> str | None:
    direct_data_type = _extract_attr_by_local_name(node, ("type",))
    if direct_data_type:
        return direct_data_type

    direct_data_type = _safe_text(node.attrib.get("dataType") or node.attrib.get("Datatype"))
    if direct_data_type:
        return direct_data_type

    datatype_node = _resolve_datatype_node(node, datatype_lookup)
    if datatype_node is None or datatype_node is node:
        return None

    return (
        _extract_attr_by_local_name(datatype_node, ("type",))
        or _safe_text(datatype_node.attrib.get("dataType") or datatype_node.attrib.get("Datatype"))
    )


def _estimate_node_bit_length(node: ET.Element, datatype_lookup: dict[str, ET.Element]) -> int | None:
    explicit_bit_length = _extract_integer_value(node, _BIT_LENGTH_KEYS)
    if explicit_bit_length is not None:
        return explicit_bit_length

    datatype_node = _resolve_datatype_node(node, datatype_lookup)
    if datatype_node is not None and datatype_node is not node:
        resolved_bit_length = _extract_integer_value(datatype_node, _BIT_LENGTH_KEYS)
        if resolved_bit_length is not None:
            return resolved_bit_length

        record_item_lengths = []
        for child in datatype_node:
            if _local_name(child.tag).lower() != "recorditem":
                continue

            child_length = _estimate_node_bit_length(child, datatype_lookup)
            child_offset = _extract_integer_value(child, _BIT_OFFSET_KEYS) or 0
            if child_length is not None:
                record_item_lengths.append(child_offset + child_length)

        if record_item_lengths:
            return max(record_item_lengths)

    data_type = _extract_effective_data_type(node, datatype_lookup)
    if data_type and "bool" in data_type.lower():
        return 1

    return None


def _extract_effective_bit_length(
    node: ET.Element,
    datatype_lookup: dict[str, ET.Element],
) -> int | None:
    return _estimate_node_bit_length(node, datatype_lookup)


def _extract_effective_text_value(
    node: ET.Element,
    keys: tuple[str, ...],
    *,
    text_lookup: dict[str, str],
    datatype_lookup: dict[str, ET.Element],
) -> str | None:
    direct_value = _extract_text_value(node, keys, text_lookup)
    if direct_value:
        return direct_value

    datatype_node = _resolve_datatype_node(node, datatype_lookup)
    if datatype_node is None or datatype_node is node:
        return None

    return _extract_text_value(datatype_node, keys, text_lookup)


def _extract_effective_enum_mappings(
    node: ET.Element,
    *,
    text_lookup: dict[str, str],
    datatype_lookup: dict[str, ET.Element],
) -> list[dict[str, Any]]:
    direct_mappings = _extract_enum_mappings(node, text_lookup)
    if direct_mappings:
        return direct_mappings

    datatype_node = _resolve_datatype_node(node, datatype_lookup)
    if datatype_node is None or datatype_node is node:
        return []

    return _extract_enum_mappings(datatype_node, text_lookup)


def _collect_process_data_candidates(
    node: ET.Element,
    *,
    datatype_lookup: dict[str, ET.Element],
    text_lookup: dict[str, str],
    base_offset: int = 0,
) -> list[dict[str, Any]]:
    datatype_node = _resolve_datatype_node(node, datatype_lookup)
    record_container = None

    if datatype_node is not None:
        if any(_local_name(child.tag).lower() == "recorditem" for child in datatype_node):
            record_container = datatype_node
    elif any(_local_name(child.tag).lower() == "recorditem" for child in node):
        record_container = node

    if record_container is not None:
        candidates: list[dict[str, Any]] = []
        pending_offset = 0

        for child in record_container:
            if _local_name(child.tag).lower() != "recorditem":
                continue

            relative_offset = _extract_integer_value(child, _BIT_OFFSET_KEYS)
            child_offset = base_offset + (relative_offset if relative_offset is not None else pending_offset)
            child_candidates = _collect_process_data_candidates(
                child,
                datatype_lookup=datatype_lookup,
                text_lookup=text_lookup,
                base_offset=child_offset,
            )
            child_bit_length = _estimate_node_bit_length(child, datatype_lookup) or 0
            pending_offset = max(
                pending_offset,
                (relative_offset if relative_offset is not None else pending_offset) + child_bit_length,
            )

            if child_candidates:
                candidates.extend(child_candidates)
                continue

            if child_bit_length <= 0:
                continue

            resolved_name = _extract_name(child, text_lookup) or f"Field {child_offset}"
            candidates.append(
                {
                    "name": resolved_name,
                    "label": resolved_name.replace("_", " "),
                    "bitOffset": child_offset,
                    "bitLength": child_bit_length,
                    "dataType": _extract_effective_data_type(child, datatype_lookup),
                    "description": _extract_description(child, text_lookup)
                    or _extract_effective_text_value(
                        child,
                        _DESCRIPTION_KEYS,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                    "unit": _extract_effective_text_value(
                        child,
                        _UNIT_KEYS,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                    "enumMappings": _extract_effective_enum_mappings(
                        child,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                }
            )

        return candidates

    bit_length = _extract_effective_bit_length(node, datatype_lookup)
    if bit_length is None or bit_length <= 0:
        return []

    resolved_name = _extract_name(node, text_lookup) or f"Field {base_offset}"
    return [
        {
            "name": resolved_name,
            "label": resolved_name.replace("_", " "),
            "bitOffset": base_offset,
            "bitLength": bit_length,
            "dataType": _extract_effective_data_type(node, datatype_lookup),
            "description": _extract_description(node, text_lookup)
            or _extract_effective_text_value(
                node,
                _DESCRIPTION_KEYS,
                text_lookup=text_lookup,
                datatype_lookup=datatype_lookup,
            ),
            "unit": _extract_effective_text_value(
                node,
                _UNIT_KEYS,
                text_lookup=text_lookup,
                datatype_lookup=datatype_lookup,
            ),
            "enumMappings": _extract_effective_enum_mappings(
                node,
                text_lookup=text_lookup,
                datatype_lookup=datatype_lookup,
            ),
        }
    ]


def _infer_field_type(
    data_type: str | None,
    bit_length: int,
    enum_mappings: list[dict[str, Any]],
    name: str,
) -> str:
    normalized_data_type = (data_type or "").lower()
    normalized_name = name.lower()

    if bit_length == 1 or "bool" in normalized_data_type or normalized_name.startswith("is_"):
        return "bool"

    if "float" in normalized_data_type or "real" in normalized_data_type:
        return "float32"

    if bit_length > 32:
        return "binary"

    if enum_mappings and bit_length <= 8:
        return "enum"

    if any(token in normalized_data_type for token in ("uinteger", "uint", "unsigned")):
        return "uint"

    if any(token in normalized_data_type for token in ("integer", "int", "signed")):
        return "int"

    return "uint"


def _infer_field_role(name: str, field_type: str, has_primary_value: bool) -> str:
    normalized_name = name.lower()

    if any(keyword in normalized_name for keyword in ("quality", "confidence", "reliability", "sqi")):
        return "quality"

    if any(keyword in normalized_name for keyword in ("status", "switch", "signal", "alarm", "warning", "ready", "valid", "state")):
        return "status"

    if any(keyword in normalized_name for keyword in ("scale", "factor", "resolution")):
        return "scale"

    if any(keyword in normalized_name for keyword in ("fault", "error", "diagnostic")):
        return "diagnostic"

    if not has_primary_value and field_type in {"uint", "int", "float32", "enum"}:
        return "primary_value"

    return "meta"


def _estimate_total_bit_length(process_data_node: ET.Element) -> int:
    total_bit_length = _extract_integer_value(
        process_data_node,
        ("bitLength", "BitLength", "bitCount", "BitCount", "length", "Length"),
    )
    if total_bit_length is not None:
        return total_bit_length

    max_bit = 0
    for child in process_data_node.iter():
        bit_length = _extract_integer_value(child, _BIT_LENGTH_KEYS)
        if bit_length is None:
            continue

        bit_offset = _extract_integer_value(child, _BIT_OFFSET_KEYS)
        if bit_offset is None:
            max_bit += bit_length
        else:
            max_bit = max(max_bit, bit_offset + bit_length)

    return max_bit


def _parse_process_data_profile(
    root: ET.Element,
    *,
    profile_id: str,
    profile_name: str,
    description: str,
    device_key: str | None,
    vendor_id: int | None,
    device_id: int | None,
    text_lookup: dict[str, str],
) -> dict[str, Any] | None:
    datatype_lookup = _build_datatype_lookup(root)
    process_data_in_node = None
    for preferred_tag_names in ({"processdatain", "processdatainput"}, {"processdata"}):
        for node in root.iter():
            local_name = _local_name(node.tag).lower()
            if local_name in preferred_tag_names:
                process_data_in_node = node
                break
        if process_data_in_node is not None:
            break

    if process_data_in_node is None:
        return {
            "id": profile_id,
            "name": profile_name,
            "description": description,
            "deviceKey": device_key,
            "vendorId": vendor_id,
            "deviceId": device_id,
            "totalBitLength": 0,
            "sourceWordCount": 0,
            "fields": [],
            "primaryFieldName": None,
        }

    total_bit_length = _estimate_total_bit_length(process_data_in_node)
    fields: list[dict[str, Any]] = []
    pending_offset = 0
    seen_fields: set[tuple[int, int, str]] = set()

    candidates = _collect_process_data_candidates(
        process_data_in_node,
        datatype_lookup=datatype_lookup,
        text_lookup=text_lookup,
    )

    if not candidates:
        for node in process_data_in_node.iter():
            if node is process_data_in_node:
                continue

            bit_length = _extract_effective_bit_length(node, datatype_lookup)
            bit_offset = _extract_integer_value(node, _BIT_OFFSET_KEYS)
            data_type = _extract_effective_data_type(node, datatype_lookup)
            name = _extract_name(node, text_lookup)

            if bit_length is None and bit_offset is None:
                continue

            if bit_length is None:
                bit_length = 1 if data_type and "bool" in data_type.lower() else None

            if bit_length is None or bit_length <= 0:
                continue

            resolved_name = name or f"Field {len(candidates) + 1}"
            resolved_offset = bit_offset if bit_offset is not None else pending_offset
            pending_offset = max(pending_offset, resolved_offset + bit_length)
            candidates.append(
                {
                    "name": resolved_name,
                    "label": resolved_name.replace("_", " "),
                    "bitOffset": resolved_offset,
                    "bitLength": bit_length,
                    "dataType": data_type,
                    "description": _extract_description(node, text_lookup)
                    or _extract_effective_text_value(
                        node,
                        _DESCRIPTION_KEYS,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                    "unit": _extract_effective_text_value(
                        node,
                        _UNIT_KEYS,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                    "enumMappings": _extract_effective_enum_mappings(
                        node,
                        text_lookup=text_lookup,
                        datatype_lookup=datatype_lookup,
                    ),
                }
            )

    candidates.sort(key=lambda candidate: (candidate["bitOffset"], candidate["bitLength"], candidate["name"]))

    has_primary_value = False
    for candidate in candidates:
        field_key = (
            candidate["bitOffset"],
            candidate["bitLength"],
            candidate["name"].lower(),
        )
        if field_key in seen_fields:
            continue

        field_type = _infer_field_type(
            candidate["dataType"],
            candidate["bitLength"],
            candidate["enumMappings"],
            candidate["name"],
        )
        role = _infer_field_role(candidate["name"], field_type, has_primary_value)
        if role == "primary_value":
            has_primary_value = True

        field_definition = {
            "name": _slugify(candidate["name"]),
            "label": candidate["label"],
            "bitOffset": candidate["bitOffset"],
            "bitLength": candidate["bitLength"],
            "type": field_type,
            "role": role,
            "unit": candidate["unit"],
            "description": candidate["description"],
            "enumMappings": candidate["enumMappings"],
        }
        fields.append(field_definition)
        seen_fields.add(field_key)

    if not fields and total_bit_length > 0:
        fields.append(
            {
                "name": "process_value",
                "label": "Process value",
                "bitOffset": 0,
                "bitLength": min(total_bit_length, 32),
                "type": "binary" if total_bit_length > 32 else "uint",
                "role": "primary_value",
                "unit": None,
                "description": "Generic process-data payload derived from uploaded IODD metadata.",
                "enumMappings": [],
            }
        )

    if total_bit_length <= 0 and not fields:
        return None

    primary_field = next((field for field in fields if field["role"] == "primary_value"), None)

    resolved_total_bit_length = max(
        total_bit_length,
        max((field["bitOffset"] + field["bitLength"] for field in fields), default=0),
    )

    return {
        "id": profile_id,
        "name": profile_name,
        "description": description,
        "deviceKey": device_key,
        "vendorId": vendor_id,
        "deviceId": device_id,
        "totalBitLength": resolved_total_bit_length,
        "sourceWordCount": (resolved_total_bit_length + 15) // 16,
        "fields": fields,
        "primaryFieldName": primary_field["name"] if primary_field else None,
    }


def _parse_isdu_variables(root: ET.Element, text_lookup: dict[str, str]) -> list[dict[str, Any]]:
    variables: list[dict[str, Any]] = []
    seen_keys: set[tuple[int, int, str]] = set()

    for node in root.iter():
        index = _extract_integer_value(node, _INDEX_KEYS)
        if index is None:
            continue

        subindex = _extract_integer_value(node, _SUBINDEX_KEYS) or 0
        name = _extract_name(node, text_lookup)
        access_rights = _extract_text_value(node, _ACCESS_KEYS, text_lookup)
        data_type = _extract_text_value(node, _DATA_TYPE_KEYS, text_lookup)
        bit_length = _extract_integer_value(node, _BIT_LENGTH_KEYS)
        unit = _extract_text_value(node, _UNIT_KEYS, text_lookup)
        description = _extract_description(node, text_lookup)
        enum_mappings = _extract_enum_mappings(node, text_lookup)

        if not any((name, access_rights, data_type, bit_length, unit, description, enum_mappings)):
            continue

        resolved_name = name or f"Index {index}:{subindex}"
        variable_key = (index, subindex, resolved_name.lower())
        if variable_key in seen_keys:
            continue

        variables.append(
            {
                "key": f"{index}:{subindex}:{_slugify(resolved_name)}",
                "name": resolved_name,
                "index": index,
                "subindex": subindex,
                "accessRights": access_rights,
                "dataType": data_type,
                "bitLength": bit_length,
                "unit": unit,
                "description": description,
                "enumMappings": enum_mappings,
            }
        )
        seen_keys.add(variable_key)

    variables.sort(key=lambda variable: (variable["index"], variable["subindex"], variable["name"].lower()))
    return variables


def parse_iodd_xml(xml_text: str, *, file_name: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"Failed to parse IODD XML: {exc}") from exc

    text_lookup = _build_text_lookup(root)
    vendor_name = _find_first_text(root, ("VendorName",), text_lookup)
    vendor_id = _parse_integer(_find_first_text(root, ("VendorId", "VendorID"), text_lookup))
    device_name = _find_first_text(root, ("DeviceName", "ProductName"), text_lookup)
    device_id = _parse_integer(_find_first_text(root, ("DeviceId", "DeviceID"), text_lookup))
    product_id = _find_first_text(root, ("ProductId", "ProductID"), text_lookup)
    device_family = _find_first_text(root, ("DeviceFamily", "ProductFamily", "Family"), text_lookup)

    file_stem = Path(file_name).stem
    resolved_device_name = device_name or file_stem
    description = (
        f"IODD-derived profile for {resolved_device_name}"
        + (f" ({vendor_name})" if vendor_name else "")
    )
    stable_key = ":".join(
        [
            "iodd",
            str(vendor_id) if vendor_id is not None else _slugify(vendor_name or "vendor"),
            str(device_id) if device_id is not None else _slugify(product_id or resolved_device_name),
        ]
    )
    profile_id = stable_key
    process_data_profile = _parse_process_data_profile(
        root,
        profile_id=profile_id,
        profile_name=resolved_device_name,
        description=description,
        device_key=product_id or resolved_device_name,
        vendor_id=vendor_id,
        device_id=device_id,
        text_lookup=text_lookup,
    )
    process_data_in_bit_length = (
        process_data_profile["totalBitLength"] if process_data_profile is not None else None
    )

    return {
        "profileId": profile_id,
        "parserVersion": _IODD_PROFILE_SCHEMA_VERSION,
        "source": "iodd",
        "fileName": file_name,
        "uploadedAtUtc": datetime.now(timezone.utc).isoformat(),
        "vendorId": vendor_id,
        "vendorName": vendor_name,
        "deviceId": device_id,
        "deviceName": resolved_device_name,
        "deviceFamily": device_family,
        "productId": product_id,
        "processDataInBitLength": process_data_in_bit_length,
        "processDataOutBitLength": None,
        "processDataProfile": process_data_profile,
        "isduVariables": _parse_isdu_variables(root, text_lookup),
    }


class IODDLibraryService:
    """Persist uploaded IODD files and expose parsed generic device profiles."""

    def __init__(self, storage_dir: Path) -> None:
        self._storage_dir = storage_dir
        self._storage_dir.mkdir(parents=True, exist_ok=True)

    def _profile_json_path(self, profile_id: str) -> Path:
        return self._storage_dir / f"{_slugify(profile_id)}.json"

    def _profile_xml_path(self, profile_id: str) -> Path:
        return self._storage_dir / f"{_slugify(profile_id)}.xml"

    def _load_profile_json(self, json_path: Path) -> dict[str, Any] | None:
        if not json_path.exists():
            return None

        try:
            return json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping unreadable IODD profile '%s': %s", json_path, exc)
            return None

    def _refresh_profile_from_xml(
        self,
        *,
        xml_path: Path,
        preferred_file_name: str | None,
    ) -> dict[str, Any] | None:
        if not xml_path.exists():
            return None

        try:
            xml_text = xml_path.read_text(encoding="utf-8")
            profile = parse_iodd_xml(xml_text, file_name=preferred_file_name or xml_path.name)
            self._profile_json_path(str(profile["profileId"])).write_text(
                json.dumps(profile, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            return profile
        except (OSError, ValueError) as exc:
            logger.warning("Failed to refresh IODD profile from '%s': %s", xml_path, exc)
            return None

    def _load_profile_from_storage(self, profile_slug: str) -> dict[str, Any] | None:
        json_path = self._storage_dir / f"{profile_slug}.json"
        xml_path = self._storage_dir / f"{profile_slug}.xml"
        cached_profile = self._load_profile_json(json_path)

        needs_refresh = cached_profile is None or (
            cached_profile.get("parserVersion") != _IODD_PROFILE_SCHEMA_VERSION
        )

        if needs_refresh and xml_path.exists():
            refreshed_profile = self._refresh_profile_from_xml(
                xml_path=xml_path,
                preferred_file_name=(
                    str(cached_profile.get("fileName"))
                    if isinstance(cached_profile, dict) and cached_profile.get("fileName")
                    else None
                ),
            )
            if refreshed_profile is not None:
                return refreshed_profile

        return cached_profile

    def list_profiles(self) -> list[dict[str, Any]]:
        profiles: list[dict[str, Any]] = []
        profile_slugs = {
            profile_path.stem for profile_path in self._storage_dir.glob("*.json")
        } | {
            profile_path.stem for profile_path in self._storage_dir.glob("*.xml")
        }

        for profile_slug in sorted(profile_slugs):
            profile = self._load_profile_from_storage(profile_slug)
            if profile is not None:
                profiles.append(profile)

        profiles.sort(
            key=lambda profile: (
                str(profile.get("vendorName") or "").lower(),
                str(profile.get("deviceName") or "").lower(),
                str(profile.get("profileId") or "").lower(),
            )
        )
        return profiles

    def get_profile(self, profile_id: str) -> dict[str, Any] | None:
        return self._load_profile_from_storage(_slugify(profile_id))

    def save_uploaded_xml(self, *, file_name: str, xml_bytes: bytes) -> dict[str, Any]:
        if not file_name.lower().endswith(".xml"):
            raise ValueError("Only XML IODD uploads are supported in this first pass.")

        xml_text = xml_bytes.decode("utf-8-sig", errors="replace")
        profile = parse_iodd_xml(xml_text, file_name=file_name)
        profile_id = str(profile["profileId"])

        self._profile_xml_path(profile_id).write_text(xml_text, encoding="utf-8")
        self._profile_json_path(profile_id).write_text(
            json.dumps(profile, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        logger.info(
            "Stored IODD profile: profile_id=%s vendor=%s device=%s file=%s",
            profile_id,
            profile.get("vendorName"),
            profile.get("deviceName"),
            file_name,
        )
        return profile
