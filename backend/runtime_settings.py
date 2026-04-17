"""Local runtime settings persistence for product deployment.

The backend still accepts environment defaults, but operator changes made from
the UI need to survive app restarts. This store keeps those mutable settings in
one small JSON file and writes atomically to avoid corrupted config after power
loss or process termination.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("ice2.backend.runtime_settings")


class RuntimeSettingsStore:
    """Atomic JSON store for user-applied runtime settings."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {}

        try:
            raw = json.loads(self.path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            logger.warning("Ignoring invalid runtime settings JSON: %s", self.path)
            return {}
        except OSError as exc:
            logger.warning("Unable to read runtime settings %s: %s", self.path, exc)
            return {}

        if not isinstance(raw, dict):
            logger.warning("Ignoring non-object runtime settings JSON: %s", self.path)
            return {}

        return raw

    def save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            **data,
            "schemaVersion": 1,
            "savedAt": datetime.now(timezone.utc).isoformat(),
        }
        tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        content = json.dumps(payload, indent=2, sort_keys=True)
        tmp_path.write_text(content, encoding="utf-8")

        try:
            tmp_path.replace(self.path)
        except OSError as exc:
            # Windows desktop/security tooling can briefly lock local JSON files.
            # Preserve the operator's Apply action by falling back to a direct
            # write instead of failing the whole integration configuration route.
            logger.warning(
                "Atomic runtime settings replace failed for %s; falling back to direct write: %s",
                self.path,
                exc,
            )
            self.path.write_text(content, encoding="utf-8")
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                logger.debug("Unable to remove runtime settings temp file %s", tmp_path)

    def update_section(self, section: str, values: dict[str, Any]) -> dict[str, Any]:
        current = self.load()
        current[section] = values
        self.save(current)
        return current

    def get_status(self) -> dict[str, Any]:
        current = self.load()
        return {
            "path": str(self.path),
            "exists": self.path.is_file(),
            "savedAt": current.get("savedAt") if isinstance(current.get("savedAt"), str) else None,
            "sections": sorted(
                key
                for key, value in current.items()
                if key not in {"schemaVersion", "savedAt"} and isinstance(value, dict)
            ),
        }
