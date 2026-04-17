"""Masterway desktop launcher using pywebview around the local FastAPI backend."""

from __future__ import annotations

import argparse
import atexit
import ctypes
from datetime import datetime
import json
import logging
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import threading
import time
import traceback
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

LOGGER = logging.getLogger("masterway.desktop")
APP_TITLE = "Masterway"
LOCAL_HOST = "127.0.0.1"
PYWEBVIEW_GUI_BACKEND = "qt"
DEFAULT_WINDOW_WIDTH = 1560
DEFAULT_WINDOW_HEIGHT = 920
DEFAULT_WINDOW_MIN_WIDTH = 1180
DEFAULT_WINDOW_MIN_HEIGHT = 720


class DesktopBridge:
    def __init__(self) -> None:
        self._window = None

    def attach_window(self, window: Any) -> None:
        self._window = window

    def save_csv_file(self, suggested_filename: str, content: str) -> dict[str, Any]:
        if self._window is None:
            LOGGER.error("CSV export requested before desktop window was ready")
            return {
                "saved": False,
                "cancelled": False,
                "path": None,
                "error": "Desktop window is not ready yet.",
            }

        try:
            import webview

            dialog_result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_filename,
                file_types=("CSV Files (*.csv)", "All files (*.*)"),
            )

            if not dialog_result:
                LOGGER.info("CSV export cancelled by user: %s", suggested_filename)
                return {
                    "saved": False,
                    "cancelled": True,
                    "path": None,
                    "error": None,
                }

            if isinstance(dialog_result, (list, tuple)):
                destination = dialog_result[0]
            else:
                destination = dialog_result

            destination_path = Path(destination)
            if destination_path.suffix.lower() != ".csv":
                destination_path = destination_path.with_suffix(".csv")

            destination_path.parent.mkdir(parents=True, exist_ok=True)
            destination_path.write_text(content, encoding="utf-8", newline="")

            LOGGER.info("CSV export saved successfully: %s", destination_path)
            return {
                "saved": True,
                "cancelled": False,
                "path": str(destination_path),
                "error": None,
            }
        except Exception as exc:
            LOGGER.exception("CSV export save dialog failed")
            return {
                "saved": False,
                "cancelled": False,
                "path": None,
                "error": str(exc),
            }


class _Rect(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def _safe_console_write(message: str) -> None:
    stream = sys.stderr or sys.stdout
    if stream is None:
        return

    try:
        stream.write(f"{message}\n")
        stream.flush()
    except Exception:
        return


def _emit_startup_status(message: str) -> None:
    LOGGER.info(message)
    _safe_console_write(f"[{APP_TITLE}] {message}")


def _show_fatal_dialog(title: str, message: str) -> None:
    if os.name != "nt":
        return

    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x00000010)
    except Exception:
        return


def _configure_windows_dpi_awareness() -> str:
    if os.name != "nt":
        return "not-windows"

    user32 = getattr(ctypes.windll, "user32", None)
    shcore = getattr(ctypes.windll, "shcore", None)

    if user32 is None:
        return "unavailable"

    try:
        pointer_bits = ctypes.sizeof(ctypes.c_void_p) * 8
        awareness_context = ctypes.c_void_p((1 << pointer_bits) - 4)  # PER_MONITOR_AWARE_V2
        if bool(user32.SetProcessDpiAwarenessContext(awareness_context)):
            return "per-monitor-v2"
    except Exception:
        pass

    if shcore is not None:
        try:
            result = shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
            if result in (0, 0x00000005):
                return "per-monitor"
        except Exception:
            pass

    try:
        if bool(user32.SetProcessDPIAware()):
            return "system-aware"
    except Exception:
        pass

    return "system-default"


def _get_windows_work_area() -> dict[str, int] | None:
    if os.name != "nt":
        return None

    user32 = getattr(ctypes.windll, "user32", None)
    if user32 is None:
        return None

    try:
        rect = _Rect()
        if bool(user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)):
            return {
                "left": int(rect.left),
                "top": int(rect.top),
                "width": int(rect.right - rect.left),
                "height": int(rect.bottom - rect.top),
            }
    except Exception:
        pass

    try:
        return {
            "left": 0,
            "top": 0,
            "width": int(user32.GetSystemMetrics(0)),
            "height": int(user32.GetSystemMetrics(1)),
        }
    except Exception:
        return None


def _resolve_window_geometry() -> dict[str, Any]:
    work_area = _get_windows_work_area()
    if work_area is None:
        return {
            "width": DEFAULT_WINDOW_WIDTH,
            "height": DEFAULT_WINDOW_HEIGHT,
            "min_size": (DEFAULT_WINDOW_MIN_WIDTH, DEFAULT_WINDOW_MIN_HEIGHT),
            "x": None,
            "y": None,
            "maximized": False,
        }

    work_width = max(DEFAULT_WINDOW_MIN_WIDTH, work_area["width"])
    work_height = max(DEFAULT_WINDOW_MIN_HEIGHT, work_area["height"])
    safe_horizontal_margin = 24 if work_width >= 1600 else 12
    safe_vertical_margin = 20 if work_height >= 940 else 10
    target_width = min(DEFAULT_WINDOW_WIDTH, max(DEFAULT_WINDOW_MIN_WIDTH, work_width - (safe_horizontal_margin * 2)))
    target_height = min(DEFAULT_WINDOW_HEIGHT, max(DEFAULT_WINDOW_MIN_HEIGHT, work_height - (safe_vertical_margin * 2)))
    maximized = work_width <= 1560 or work_height <= 860

    min_width = min(DEFAULT_WINDOW_MIN_WIDTH, target_width)
    min_height = min(DEFAULT_WINDOW_MIN_HEIGHT, target_height)

    x = None
    y = None
    if not maximized:
        x = work_area["left"] + max(safe_horizontal_margin, (work_width - target_width) // 2)
        y = work_area["top"] + max(safe_vertical_margin, (work_height - target_height) // 2)

    return {
        "width": target_width,
        "height": target_height,
        "min_size": (min_width, min_height),
        "x": x,
        "y": y,
        "maximized": maximized,
    }


def _resolve_bundle_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()  # type: ignore[attr-defined]

    return Path(__file__).resolve().parents[1]


def _resolve_runtime_data_dir(bundle_root: Path) -> Path:
    local_app_data = os.getenv("LOCALAPPDATA")
    candidate_base_dirs = [
        Path(local_app_data).expanduser() if local_app_data else None,
        Path.home() / "AppData" / "Local",
        Path(os.getenv("TEMP") or Path.cwd()).expanduser(),
        bundle_root / ".desktop-data",
    ]

    for base_dir in candidate_base_dirs:
        if base_dir is None:
            continue

        app_data_dir = base_dir / APP_TITLE
        try:
            app_data_dir.mkdir(parents=True, exist_ok=True)
            return app_data_dir
        except OSError:
            continue

    raise RuntimeError("Could not create a writable desktop runtime data directory.")


def _create_file_handler(log_dir: Path) -> tuple[logging.Handler, Path]:
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    process_id = os.getpid()
    log_path = log_dir / f"masterway-desktop-{timestamp}-{process_id}.log"
    return logging.FileHandler(log_path, encoding="utf-8"), log_path


def _configure_logging(log_dir: Path, *, debug: bool) -> Path:
    handlers: list[logging.Handler] = []
    log_path: Path | None = None

    try:
      file_handler, log_path = _create_file_handler(log_dir)
      handlers.append(file_handler)
    except Exception as exc:
      fallback_log_dir = Path(tempfile.gettempdir()) / APP_TITLE / "logs"
      fallback_log_dir.mkdir(parents=True, exist_ok=True)
      file_handler, log_path = _create_file_handler(fallback_log_dir)
      handlers.append(file_handler)
      _safe_console_write(
          f"[{APP_TITLE}] Primary log directory unavailable ({exc}). Falling back to {log_path}"
      )

    if not getattr(sys, "frozen", False) or bool(sys.stderr) or debug:
        handlers.append(logging.StreamHandler())

    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        handlers=handlers,
        force=True,
    )

    LOGGER.info("Desktop logging initialized: %s", log_path)
    return log_path


def _seed_iodd_library(bundle_root: Path, target_library_dir: Path) -> None:
    source_library_dir = bundle_root / "backend" / "data" / "iodd_library"
    target_library_dir.mkdir(parents=True, exist_ok=True)

    if not source_library_dir.is_dir():
        LOGGER.info("No bundled IODD seed library found at %s", source_library_dir)
        return

    copied_files = 0
    for source_file in source_library_dir.iterdir():
        if not source_file.is_file():
            continue

        destination_file = target_library_dir / source_file.name
        if destination_file.exists():
            continue

        shutil.copy2(source_file, destination_file)
        copied_files += 1

    LOGGER.info(
        "IODD library seed completed: source=%s target=%s copied=%s",
        source_library_dir,
        target_library_dir,
        copied_files,
    )


def _configure_runtime_environment(bundle_root: Path, *, app_data_dir: Path) -> dict[str, Path]:
    frontend_dist_dir = (bundle_root / "frontend" / "dist").resolve()
    if not (frontend_dist_dir / "index.html").is_file():
        raise RuntimeError(
            "Production frontend assets were not found. Run `npm run build` in the frontend first."
        )

    logs_dir = app_data_dir / "logs"
    iodd_library_dir = app_data_dir / "iodd_library"
    runtime_settings_file = app_data_dir / "runtime_settings.local.json"
    _seed_iodd_library(bundle_root, iodd_library_dir)

    os.environ["FRONTEND_DIST_DIR"] = str(frontend_dist_dir)
    os.environ["IODD_LIBRARY_DIR"] = str(iodd_library_dir)
    os.environ["MASTERWAY_RUNTIME_SETTINGS_FILE"] = str(runtime_settings_file)

    return {
        "frontend_dist_dir": frontend_dist_dir,
        "app_data_dir": app_data_dir,
        "logs_dir": logs_dir,
        "iodd_library_dir": iodd_library_dir,
        "runtime_settings_file": runtime_settings_file,
    }


def _prepare_import_paths(bundle_root: Path) -> None:
    backend_dir = bundle_root / "backend"
    desktop_dir = bundle_root / "desktop"

    for candidate in (backend_dir, bundle_root, desktop_dir):
        candidate_str = str(candidate)
        if candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe_socket:
        probe_socket.bind((LOCAL_HOST, 0))
        return int(probe_socket.getsockname()[1])


def _read_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=2.0) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


class LocalBackendServer:
    def __init__(self, *, port: int, log_level: str) -> None:
        self.port = port
        self.log_level = log_level
        self._server = None
        self._thread: threading.Thread | None = None
        self._startup_error: BaseException | None = None

    @property
    def base_url(self) -> str:
        return f"http://{LOCAL_HOST}:{self.port}"

    def _run_server(self) -> None:
        try:
            assert self._server is not None
            self._server.run()
        except BaseException as exc:
            self._startup_error = exc
            _safe_console_write(f"[{APP_TITLE}] Backend server thread crashed: {exc}")
            _safe_console_write(traceback.format_exc())
            LOGGER.exception("Backend server thread crashed before readiness")
            raise

    def start(self, *, startup_timeout_seconds: float = 20.0) -> dict[str, Any]:
        if self._thread is not None:
            raise RuntimeError("Backend server is already running.")

        _emit_startup_status(f"Starting backend on {self.base_url}...")
        import uvicorn

        LOGGER.info("Backend startup attempt: import FastAPI app")
        from app import app as backend_app

        config = uvicorn.Config(
            backend_app,
            host=LOCAL_HOST,
            port=self.port,
            log_level=self.log_level,
            reload=False,
            access_log=False,
            log_config=None,
            use_colors=False,
            timeout_graceful_shutdown=2,
        )
        server = uvicorn.Server(config)
        server.install_signal_handlers = lambda: None
        self._startup_error = None
        self._server = server

        thread = threading.Thread(
            target=self._run_server,
            name="MasterwayBackend",
            daemon=True,
        )
        self._thread = thread
        thread.start()
        LOGGER.info("Backend server thread started on %s", self.base_url)
        _emit_startup_status(f"Waiting for server at {self.base_url}/health ...")
        return self.wait_until_ready(timeout_seconds=startup_timeout_seconds)

    def wait_until_ready(self, *, timeout_seconds: float = 20.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        last_error: Exception | None = None

        while time.monotonic() < deadline:
            if self._thread is not None and not self._thread.is_alive():
                if self._startup_error is not None:
                    _emit_startup_status("Startup failed before health check completed.")
                    raise RuntimeError(
                        f"Backend server thread exited before startup completed: {self._startup_error}"
                    ) from self._startup_error

                _emit_startup_status("Startup failed before health check completed.")
                raise RuntimeError("Backend server thread exited before startup completed.")

            try:
                health_payload = _read_json(f"{self.base_url}/health")
                LOGGER.info("Backend health check succeeded: %s", health_payload.get("status"))
                _emit_startup_status("Server ready.")
                return health_payload
            except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                time.sleep(0.2)

        _emit_startup_status("Startup failed: backend did not become reachable before timeout.")
        raise RuntimeError(
            f"Timed out waiting for backend startup at {self.base_url}/health"
            + (f": {last_error}" if last_error else "")
        )

    def stop(self) -> None:
        if self._server is not None:
            LOGGER.info("Stopping backend server")
            self._server.should_exit = True

        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=0.25)
            if self._thread.is_alive():
                LOGGER.warning(
                    "Backend server thread is still running after stop request; launcher exit will terminate it."
                )

        self._server = None
        self._thread = None


def _run_headless_smoke_check(server: LocalBackendServer) -> None:
    root_url = f"{server.base_url}/"
    api_health_url = f"{server.base_url}/api/health"
    library_url = f"{server.base_url}/api/iodd/library"

    with urlopen(root_url, timeout=2.0) as response:
        LOGGER.info("Frontend root smoke check status=%s", response.status)

    _read_json(api_health_url)
    _read_json(library_url)
    LOGGER.info("Headless desktop smoke check passed")


def _run_desktop_window(*, base_url: str, debug: bool) -> None:
    try:
        LOGGER.info("Desktop window startup: import pywebview")
        import webview
    except ImportError as exc:
        raise RuntimeError(
            "pywebview is not installed. Install desktop/requirements.txt before running the desktop launcher."
        ) from exc

    try:
        import qtpy  # noqa: F401
        import PySide6  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "The desktop launcher is configured to use pywebview with the Qt backend. "
            "Install desktop/requirements.txt and pywebview without WinForms dependencies "
            "so the app does not rely on pythonnet."
        ) from exc

    os.environ["PYWEBVIEW_GUI"] = PYWEBVIEW_GUI_BACKEND
    LOGGER.info(
        "Desktop window startup: forcing pywebview gui=%s to avoid the Windows WinForms/pythonnet backend",
        PYWEBVIEW_GUI_BACKEND,
    )

    window_geometry = _resolve_window_geometry()
    runtime_url = f"{base_url}?desktop=1"
    LOGGER.info(
        "Desktop window geometry: width=%s height=%s min=%s x=%s y=%s maximized=%s",
        window_geometry["width"],
        window_geometry["height"],
        window_geometry["min_size"],
        window_geometry["x"],
        window_geometry["y"],
        window_geometry["maximized"],
    )

    desktop_bridge = DesktopBridge()

    LOGGER.info("Desktop window startup: create native window url=%s", runtime_url)
    window = webview.create_window(
        APP_TITLE,
        runtime_url,
        width=window_geometry["width"],
        height=window_geometry["height"],
        x=window_geometry["x"],
        y=window_geometry["y"],
        min_size=window_geometry["min_size"],
        maximized=window_geometry["maximized"],
        confirm_close=True,
        background_color="#061018",
        js_api=desktop_bridge,
    )
    desktop_bridge.attach_window(window)
    LOGGER.info("Desktop window startup: entering pywebview event loop")
    webview.start(gui=PYWEBVIEW_GUI_BACKEND, debug=debug, private_mode=False)
    LOGGER.info("Desktop window shutdown: event loop exited")


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Masterway desktop launcher")
    parser.add_argument(
        "--backend-port",
        type=int,
        default=0,
        help="Override the local backend port. Default uses a free ephemeral port.",
    )
    parser.add_argument(
        "--backend-timeout",
        type=float,
        default=5.0,
        help="Seconds to wait for backend startup before failing.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable extra launcher logging and pywebview debug mode.",
    )
    parser.add_argument(
        "--headless-check",
        action="store_true",
        help="Start the local backend, verify the packaged frontend/API path, then exit without opening a window.",
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="Run the backend without opening a desktop window (useful for smoke tests).",
    )
    parser.add_argument(
        "--run-seconds",
        type=float,
        default=0.0,
        help="When --no-gui is set, keep the backend running for this many seconds before exiting.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_argument_parser()
    args = parser.parse_args(argv)

    log_path: Path | None = None

    backend_server: LocalBackendServer | None = None

    try:
        bundle_root = _resolve_bundle_root()
        app_data_dir = _resolve_runtime_data_dir(bundle_root)
        log_path = _configure_logging(app_data_dir / "logs", debug=args.debug)
        LOGGER.info("Launcher start: frozen=%s pid=%s", getattr(sys, "frozen", False), os.getpid())
        LOGGER.info("Desktop DPI awareness=%s", _configure_windows_dpi_awareness())
        LOGGER.info("Launcher paths: bundle_root=%s app_data_dir=%s", bundle_root, app_data_dir)

        runtime_paths = _configure_runtime_environment(bundle_root, app_data_dir=app_data_dir)
        LOGGER.info(
            "Runtime assets resolved: frontend=%s iodd_library=%s",
            runtime_paths["frontend_dist_dir"],
            runtime_paths["iodd_library_dir"],
        )
        _prepare_import_paths(bundle_root)
        LOGGER.info("Import paths prepared")

        backend_port = args.backend_port or _find_free_port()
        LOGGER.info("Selected local backend port=%s", backend_port)
        backend_server = LocalBackendServer(
            port=backend_port,
            log_level="debug" if args.debug else "info",
        )
        atexit.register(backend_server.stop)

        health_payload = backend_server.start(startup_timeout_seconds=args.backend_timeout)
        LOGGER.info(
            "Desktop runtime ready: backend=%s frontend=%s iodd_library=%s",
            backend_server.base_url,
            runtime_paths["frontend_dist_dir"],
            runtime_paths["iodd_library_dir"],
        )
        LOGGER.info("Initial backend mode=%s", health_payload.get("backend_mode"))

        if args.headless_check:
            _run_headless_smoke_check(backend_server)
            return 0

        if args.no_gui:
            _emit_startup_status("Running without desktop UI.")
            if args.run_seconds and args.run_seconds > 0:
                time.sleep(args.run_seconds)
            else:
                try:
                    while True:
                        time.sleep(0.5)
                except KeyboardInterrupt:
                    _emit_startup_status("Headless run interrupted.")
            return 0

        _run_desktop_window(base_url=f"{backend_server.base_url}/", debug=args.debug)
        return 0
    except Exception as exc:
        error_trace = traceback.format_exc()
        failure_message = (
            f"{APP_TITLE} failed during startup.\n\n"
            f"{exc}\n\n"
            f"See log for details:\n{log_path if log_path else 'log unavailable'}"
        )
        if log_path is not None:
            try:
                with log_path.open("a", encoding="utf-8") as log_file:
                    log_file.write("\n[FATAL STARTUP FAILURE]\n")
                    log_file.write(error_trace)
                    log_file.write("\n")
            except Exception:
                pass

        if logging.getLogger().handlers:
            LOGGER.exception("Masterway desktop launcher failed")
        else:
            _safe_console_write(error_trace)

        _safe_console_write(failure_message)
        _show_fatal_dialog(APP_TITLE, failure_message)
        return 1
    finally:
        if backend_server is not None:
            backend_server.stop()


if __name__ == "__main__":
    exit_code = main()
    logging.shutdown()
    os._exit(exit_code)
