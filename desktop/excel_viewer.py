"""Masterway OPC UA Excel Viewer.

Operator-facing desktop utility for:
- entering an OPC UA host/IP or manual endpoint
- connecting/disconnecting on demand
- choosing which PDI fields enter history logging
- trimming workbook history with optional archive export
- opening the Excel live workbook and CSV outputs
"""

from __future__ import annotations

import csv
import os
import queue
import threading
import time
import traceback
import tkinter as tk
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

from tools.masterway_excel_bridge import (
    CsvHistoryWriter,
    ExcelWorkbookBridge,
    OpcUaReader,
    classify_port_view,
    sanitize_excel_value,
)


APP_TITLE = "Masterway OPC UA Excel Viewer"
LINKEDIN_URL = "https://www.linkedin.com/in/hyein-woo-615a0a20b/?locale=en"
HISTORY_RETENTION_OPTIONS: list[tuple[str, int | None]] = [
    ("No auto-delete", None),
    ("30 sec", 30),
    ("1 min", 60),
    ("5 min", 300),
    ("15 min", 900),
    ("30 min", 1800),
    ("1 hour", 3600),
    ("6 hours", 21600),
]
HISTORY_RETENTION_MAP = {label: seconds for label, seconds in HISTORY_RETENTION_OPTIONS}
PERF_LOG_HEADER = [
    "timestamp_utc",
    "endpoint",
    "nodes",
    "history_rows",
    "read_ms",
    "excel_live_ms",
    "history_write_ms",
    "prune_ms",
    "save_ms",
    "loop_ms",
    "port_sheet_write",
]


@dataclass(slots=True)
class ViewerConfig:
    endpoint: str
    visible_excel: bool
    workbook_path: Path
    csv_path: Path
    archive_dir: Path | None
    history_retention_seconds: int | None = None
    poll_ms: int = 30
    excel_ms: int = 140
    port_sheet_ms: int = 1000
    history_ms: int = 500
    save_ms: int = 120000
    reconnect_ms: int = 2000


def append_perf_log(perf_path: Path, payload: dict[str, Any], header_written: bool) -> bool:
    perf_path.parent.mkdir(parents=True, exist_ok=True)
    with perf_path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if not header_written:
            writer.writerow(PERF_LOG_HEADER)
        writer.writerow(
            [
                payload.get("timestamp_utc", ""),
                payload.get("endpoint", ""),
                payload.get("nodes", 0),
                payload.get("history_rows", 0),
                payload.get("read_ms", 0.0),
                payload.get("excel_live_ms", 0.0),
                payload.get("history_write_ms", 0.0),
                payload.get("prune_ms", 0.0),
                payload.get("save_ms", 0.0),
                payload.get("loop_ms", 0.0),
                int(bool(payload.get("port_sheet_write", False))),
            ]
        )
    return True


class ViewerApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("1360x820")
        self.root.minsize(1220, 720)
        self.root.configure(bg="#0b1520")

        self.output_dir = Path(os.environ.get("LOCALAPPDATA", ".")) / "Masterway" / "excel"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.host_var = tk.StringVar(value="")
        self.port_var = tk.StringVar(value="4840")
        self.path_var = tk.StringVar(value="")
        self.manual_endpoint_var = tk.StringVar(value="")
        self.endpoint_var = tk.StringVar(value="")
        self.visible_excel_var = tk.BooleanVar(value=True)

        self.status_var = tk.StringVar(value="Idle")
        self.detail_var = tk.StringVar(value="Enter IP or endpoint, then click Connect.")
        self.nodes_var = tk.StringVar(value="Nodes: --")
        self.history_filter_var = tk.StringVar(value="History: connect to discover fields")
        self.history_selection_var = tk.StringVar(value="Selection: --")
        self.history_retention_var = tk.StringVar(value=HISTORY_RETENTION_OPTIONS[0][0])
        self.archive_dir_var = tk.StringVar(value=str(self.output_dir / "retention-archive"))
        self.workbook_var = tk.StringVar(value=str(self.output_dir / "Masterway_OPCUA_Live.xlsx"))
        self.csv_var = tk.StringVar(value=str(self.output_dir / f"masterway_opcua_{datetime.now():%Y%m%d}.csv"))
        self.last_archive_var = tk.StringVar(value="Archive: no trimmed rows exported yet")
        self.perf_log_path = self.output_dir / f"masterway_perf_{datetime.now():%Y%m%d}.csv"
        self.perf_var = tk.StringVar(value="Perf: waiting for live session")
        self.perf_log_var = tk.StringVar(value=f"Perf log: {self.perf_log_path.name}")

        self._queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self._command_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self._worker_thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self._connected = False
        self._logging_active = False
        self._history_paths: list[str] = []
        self._selected_history_paths: set[str] = set()
        self._history_filter_explicit = False
        self._available_history_paths_cache: list[str] = []
        self._selected_history_paths_cache: list[str] = []
        self._status_badges: list[tk.Label] = []
        self._brand_image: tk.PhotoImage | None = None

        self._configure_style()
        self._bind_updates()
        self._build_ui()
        self._refresh_endpoint_preview()
        self._update_history_filter_summary()
        self._set_running_state()
        self.root.after(120, self._drain_queue)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _configure_style(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(".", background="#0b1520", foreground="#eef4fb", fieldbackground="#1a2a3c", font=("Segoe UI", 9))
        style.configure("TFrame", background="#0b1520")
        style.configure("Card.TFrame", background="#15212d", relief="flat")
        style.configure("TLabel", background="#0b1520", foreground="#eef4fb", font=("Segoe UI", 9))
        style.configure("Muted.TLabel", background="#15212d", foreground="#adc0ce", font=("Segoe UI", 9))
        style.configure("Header.TLabel", background="#15212d", foreground="#8ae8ff", font=("Segoe UI Semibold", 10))
        style.configure("Title.TLabel", background="#101b27", foreground="#fbfdff", font=("Segoe UI Semibold", 18))
        style.configure("Eyebrow.TLabel", background="#101b27", foreground="#8ce8ff", font=("Consolas", 9, "bold"))
        style.configure("TEntry", padding=(9, 7), foreground="#f3f7fb", fieldbackground="#1a2a3c", bordercolor="#3f6078", lightcolor="#bfeeff", darkcolor="#294356")
        style.configure("Dark.TCombobox", padding=(9, 7), foreground="#eef4fb", fieldbackground="#1a2a3c", background="#36516a")
        style.map("Dark.TCombobox", fieldbackground=[("readonly", "#1a2a3c")], foreground=[("readonly", "#f2f6fb")])
        style.configure("TCheckbutton", background="#15212d", foreground="#dce7f0", font=("Segoe UI", 9))
        style.configure(
            "Primary.TButton",
            padding=(14, 8),
            font=("Segoe UI Semibold", 9),
            background="#60cbff",
            foreground="#04141d",
            bordercolor="#9deaff",
            darkcolor="#2a84ac",
            lightcolor="#e6fbff",
            focuscolor="#82e5ff",
        )
        style.map(
            "Primary.TButton",
            background=[
                ("disabled", "#1b2732"),
                ("pressed", "#2f8fbb"),
                ("active", "#95e6ff"),
                ("!disabled", "#60cbff"),
            ],
            foreground=[
                ("disabled", "#6f8392"),
                ("pressed", "#ffffff"),
                ("active", "#031019"),
                ("!disabled", "#04141d"),
            ],
            bordercolor=[
                ("pressed", "#58bfe8"),
                ("active", "#d9f8ff"),
                ("!disabled", "#92e5ff"),
            ],
            darkcolor=[
                ("pressed", "#1d5f7f"),
                ("active", "#51afd9"),
                ("!disabled", "#2a84ac"),
            ],
            lightcolor=[
                ("pressed", "#4ea9d0"),
                ("active", "#ffffff"),
                ("!disabled", "#e6fbff"),
            ],
        )
        style.configure(
            "Secondary.TButton",
            padding=(12, 8),
            font=("Segoe UI Semibold", 9),
            background="#2d9fd2",
            foreground="#eefbff",
            bordercolor="#73d7ff",
            darkcolor="#1c5b7a",
            lightcolor="#bfefff",
            focuscolor="#73d7ff",
        )
        style.map(
            "Secondary.TButton",
            background=[
                ("disabled", "#16202a"),
                ("pressed", "#246f94"),
                ("active", "#4bc4f5"),
                ("!disabled", "#2d9fd2"),
            ],
            foreground=[
                ("disabled", "#728595"),
                ("pressed", "#ffffff"),
                ("active", "#031019"),
                ("!disabled", "#eefbff"),
            ],
            bordercolor=[
                ("pressed", "#4bbde8"),
                ("active", "#a2ebff"),
                ("!disabled", "#73d7ff"),
            ],
            darkcolor=[
                ("pressed", "#163f55"),
                ("active", "#338db3"),
                ("!disabled", "#1c5b7a"),
            ],
            lightcolor=[
                ("pressed", "#3c8db2"),
                ("active", "#dff9ff"),
                ("!disabled", "#bfefff"),
            ],
        )
        style.configure(
            "Connect.TButton",
            padding=(16, 8),
            font=("Segoe UI Semibold", 9),
            background="#73c8f6",
            foreground="#04111a",
            bordercolor="#ccefff",
            darkcolor="#3c6c90",
            lightcolor="#eef9ff",
            focuscolor="#c2ecff",
        )
        style.map(
            "Connect.TButton",
            background=[
                ("disabled", "#2b3c4b"),
                ("pressed", "#5fa8d3"),
                ("active", "#92dbff"),
                ("!disabled", "#73c8f6"),
            ],
            foreground=[
                ("disabled", "#7d8f9d"),
                ("pressed", "#ffffff"),
                ("active", "#04111a"),
                ("!disabled", "#04111a"),
            ],
            bordercolor=[
                ("pressed", "#b7e6fb"),
                ("active", "#eef9ff"),
                ("!disabled", "#ccefff"),
            ],
            darkcolor=[
                ("pressed", "#497da0"),
                ("active", "#69afd8"),
                ("!disabled", "#3c6c90"),
            ],
            lightcolor=[
                ("pressed", "#8fd0f0"),
                ("active", "#ffffff"),
                ("!disabled", "#eef9ff"),
            ],
        )
        style.configure(
            "Start.TButton",
            padding=(16, 8),
            font=("Segoe UI Semibold", 9),
            background="#66bee8",
            foreground="#04111a",
            bordercolor="#c7ecff",
            darkcolor="#386684",
            lightcolor="#eef8ff",
            focuscolor="#bde8ff",
        )
        style.map(
            "Start.TButton",
            background=[
                ("disabled", "#2a3b49"),
                ("pressed", "#5697be"),
                ("active", "#87d3f8"),
                ("!disabled", "#66bee8"),
            ],
            foreground=[
                ("disabled", "#7d8f9d"),
                ("pressed", "#ffffff"),
                ("active", "#04111a"),
                ("!disabled", "#04111a"),
            ],
            bordercolor=[
                ("pressed", "#b2e0f6"),
                ("active", "#ebf8ff"),
                ("!disabled", "#c7ecff"),
            ],
            darkcolor=[
                ("pressed", "#466f89"),
                ("active", "#60a7cb"),
                ("!disabled", "#386684"),
            ],
            lightcolor=[
                ("pressed", "#88c7e7"),
                ("active", "#ffffff"),
                ("!disabled", "#eef8ff"),
            ],
        )
        style.configure(
            "Utility.TButton",
            padding=(12, 8),
            font=("Segoe UI Semibold", 9),
            background="#4d7999",
            foreground="#edf9ff",
            bordercolor="#b9e4f8",
            darkcolor="#36546d",
            lightcolor="#e4f6ff",
            focuscolor="#b8e8ff",
        )
        style.map(
            "Utility.TButton",
            background=[
                ("disabled", "#293744"),
                ("pressed", "#426680"),
                ("active", "#618eaf"),
                ("!disabled", "#4d7999"),
            ],
            foreground=[
                ("disabled", "#7c8a96"),
                ("pressed", "#ffffff"),
                ("active", "#ffffff"),
                ("!disabled", "#edf9ff"),
            ],
            bordercolor=[
                ("pressed", "#a6d9ef"),
                ("active", "#edf9ff"),
                ("!disabled", "#b9e4f8"),
            ],
            darkcolor=[
                ("pressed", "#335065"),
                ("active", "#517b99"),
                ("!disabled", "#36546d"),
            ],
            lightcolor=[
                ("pressed", "#648ca9"),
                ("active", "#ffffff"),
                ("!disabled", "#e4f6ff"),
            ],
        )
        style.configure(
            "Danger.TButton",
            padding=(14, 8),
            font=("Segoe UI Semibold", 9),
            background="#435a6d",
            foreground="#f5f9fd",
            bordercolor="#b8cfdd",
            darkcolor="#32424f",
            lightcolor="#ddebf3",
            focuscolor="#c5dbe8",
        )
        style.map(
            "Danger.TButton",
            background=[
                ("disabled", "#26323c"),
                ("pressed", "#516778"),
                ("active", "#5f7890"),
                ("!disabled", "#435a6d"),
            ],
            foreground=[
                ("disabled", "#7d8790"),
                ("pressed", "#ffffff"),
                ("active", "#ffffff"),
                ("!disabled", "#f5f9fd"),
            ],
            bordercolor=[
                ("pressed", "#a9c1d1"),
                ("active", "#eaf5fb"),
                ("!disabled", "#b8cfdd"),
            ],
            darkcolor=[
                ("pressed", "#3b4d5b"),
                ("active", "#4b6376"),
                ("!disabled", "#32424f"),
            ],
            lightcolor=[
                ("pressed", "#688193"),
                ("active", "#f6fbff"),
                ("!disabled", "#ddebf3"),
            ],
        )
        self.root.option_add("*TCombobox*Listbox.background", "#101d2a")
        self.root.option_add("*TCombobox*Listbox.foreground", "#f2f6fb")
        self.root.option_add("*TCombobox*Listbox.selectBackground", "#1f5f8b")
        self.root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")
        self.root.option_add("*TCombobox*Listbox.font", "{Segoe UI} 9")
        self.root.option_add("*TEntry*insertBackground", "#ffffff")
        self.root.option_add("*Menu.background", "#09141f")
        self.root.option_add("*Menu.foreground", "#f4fbff")
        self.root.option_add("*Menu.activeBackground", "#5cd4ff")
        self.root.option_add("*Menu.activeForeground", "#04121b")
        self.root.option_add("*Menu.font", "{Segoe UI} 9")

    @staticmethod
    def _make_surface(parent: tk.Misc, *, bg: str, border: str, padx: int, pady: int) -> tk.Frame:
        return tk.Frame(parent, bg=bg, highlightbackground=border, highlightcolor=border, highlightthickness=1, bd=0, padx=padx, pady=pady)

    @staticmethod
    def _make_metric_tile(parent: tk.Misc, title: str, *, value_variable: tk.StringVar | None = None, value_text: str | None = None) -> tk.Frame:
        tile = tk.Frame(parent, bg="#1a2a3b", width=172, height=76, highlightbackground="#33556c", highlightcolor="#33556c", highlightthickness=1, bd=0, padx=10, pady=8)
        tile.grid_propagate(False)
        tk.Label(tile, text=title, bg="#1a2a3b", fg="#9be8ff", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        if value_variable is not None:
            tk.Label(tile, textvariable=value_variable, bg="#1a2a3b", fg="#f6f9fc", justify="left", font=("Segoe UI Semibold", 10), wraplength=180).pack(anchor="w", pady=(4, 0))
        elif value_text is not None:
            tk.Label(tile, text=value_text, bg="#1a2a3b", fg="#f6f9fc", justify="left", font=("Segoe UI Semibold", 10), wraplength=180).pack(anchor="w", pady=(4, 0))
        return tile

    @staticmethod
    def _style_history_listbox(listbox: tk.Listbox) -> None:
        listbox.configure(bg="#1a2a3b", fg="#f2f6fb", selectbackground="#2a668f", selectforeground="#ffffff", highlightbackground="#365870", highlightcolor="#7ce3ff", relief="flat", bd=0, activestyle="none", font=("Segoe UI", 9))

    @staticmethod
    def _style_option_menu(option_menu: tk.OptionMenu, *, width: int = 18) -> None:
        option_menu.configure(
            width=width,
            anchor="w",
            bg="#102638",
            fg="#eefbff",
            activebackground="#81e3ff",
            activeforeground="#03131c",
            relief="flat",
            bd=1,
            padx=8,
            pady=4,
            cursor="hand2",
            highlightthickness=1,
            highlightbackground="#72d9ff",
            highlightcolor="#b7f1ff",
            font=("Segoe UI Semibold", 9),
        )
        menu = option_menu["menu"]
        menu.configure(
            tearoff=0,
            bg="#09141f",
            fg="#f4fbff",
            activebackground="#5cd4ff",
            activeforeground="#04121b",
            relief="solid",
            bd=1,
            cursor="hand2",
            font=("Segoe UI", 9),
        )

    def _build_logo_widget(self, parent: tk.Misc, width: int, height: int, bg: str) -> None:
        assets_dir = Path(__file__).resolve().parent / "assets"
        preferred_assets = [
            assets_dir / "masterway-brand-ui2.png",
            assets_dir / "masterway-brand.png",
            assets_dir / "masterway-icon-256.png",
        ]
        try:
            for asset_path in preferred_assets:
                if not asset_path.exists():
                    continue
                image = tk.PhotoImage(file=str(asset_path))
                scale_x = max(1, (image.width() + max(width, 1) - 1) // max(width, 1))
                scale_y = max(1, (image.height() + max(height, 1) - 1) // max(height, 1))
                scale = max(scale_x, scale_y)
                self._brand_image = image.subsample(scale, scale)
                tk.Label(parent, image=self._brand_image, bg=bg).pack(fill="both", expand=True)
                return
        except Exception:
            self._brand_image = None
        fallback = tk.Canvas(parent, width=width, height=height, bg=bg, bd=0, highlightthickness=0)
        fallback.pack(fill="both", expand=True)
        fallback.create_oval(2, 2, width - 2, height - 2, fill="#102030", outline="#2a8fd3", width=2)
        fallback.create_text(width / 2, height / 2, text="M", fill="#ffffff", font=("Segoe UI", 18, "bold"))

    @staticmethod
    def _draw_linkedin_logo(canvas: tk.Canvas) -> None:
        canvas.delete("all")
        canvas.create_rectangle(2, 2, 20, 20, outline="#0A66C2", fill="#0A66C2", width=1)
        canvas.create_text(11, 11, text="in", fill="#ffffff", font=("Segoe UI", 8, "bold"))

    @staticmethod
    def _make_sidebar_step(parent: tk.Misc, step: str, title: str) -> None:
        row = tk.Frame(parent, bg="#0a121b")
        row.pack(fill="x", pady=(12, 0))
        tk.Label(row, text=step, bg="#14304a", fg="#8eeeff", width=4, font=("Consolas", 10, "bold"), padx=6, pady=8).pack(side="left")
        tk.Label(row, text=title, bg="#0a121b", fg="#eef5fb", font=("Segoe UI", 10, "bold")).pack(side="left", padx=(12, 0))

    def _build_ui(self) -> None:
        self.content_canvas = None

        shell = tk.Frame(self.root, bg="#0b1520", padx=14, pady=14)
        shell.pack(fill="both", expand=True)
        shell.grid_columnconfigure(0, weight=1)
        shell.grid_rowconfigure(1, weight=1)

        header_card = self._make_surface(shell, bg="#101b27", border="#34566d", padx=16, pady=14)
        header_card.grid(row=0, column=0, sticky="ew")
        header_card.grid_columnconfigure(1, weight=1)

        brand_block = tk.Frame(header_card, bg="#101b27")
        brand_block.grid(row=0, column=0, sticky="w")

        brand_row = tk.Frame(brand_block, bg="#101b27")
        brand_row.pack(anchor="w")
        logo_host = tk.Frame(brand_row, bg="#101b27", width=82, height=82)
        logo_host.pack(side="left")
        logo_host.pack_propagate(False)
        self._build_logo_widget(logo_host, 82, 82, "#101b27")

        brand_copy = tk.Frame(brand_row, bg="#101b27")
        brand_copy.pack(side="left", padx=(12, 0))
        ttk.Label(brand_copy, text="MASTERWAY", style="Eyebrow.TLabel").pack(anchor="w")
        ttk.Label(brand_copy, text="Excel logging workspace", style="Title.TLabel").pack(anchor="w", pady=(2, 0))
        tk.Label(
            brand_block,
            text="One compact workspace for connection, staged history, live logging, and retention export.",
            bg="#101b27",
            fg="#b7c8d5",
            font=("Segoe UI", 9),
            justify="left",
        ).pack(anchor="w", pady=(8, 0))

        summary_frame = tk.Frame(header_card, bg="#101b27")
        summary_frame.grid(row=0, column=1, sticky="ew", padx=(18, 18))
        for column in range(3):
            summary_frame.grid_columnconfigure(column, weight=1, uniform="header_metrics")
        self._make_metric_tile(summary_frame, "Nodes", value_variable=self.nodes_var).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self._make_metric_tile(summary_frame, "Retention", value_variable=self.history_retention_var).grid(row=0, column=1, sticky="ew", padx=(0, 8))
        self._make_metric_tile(summary_frame, "Archive", value_text="CSV export").grid(row=0, column=2, sticky="ew")

        credit_card = self._make_surface(header_card, bg="#182635", border="#456b84", padx=12, pady=10)
        credit_card.grid(row=0, column=2, sticky="e")
        credit_row = tk.Frame(credit_card, bg="#182635")
        credit_row.pack(fill="x")
        linkedin_canvas = tk.Canvas(credit_row, width=22, height=22, bg="#182635", bd=0, highlightthickness=0, cursor="hand2")
        linkedin_canvas.pack(side="left", padx=(0, 10))
        self._draw_linkedin_logo(linkedin_canvas)
        linkedin_canvas.bind("<Button-1>", lambda _event: self._open_linkedin())
        tk.Label(credit_row, text="Developed by Hye In, Woo (Wayne)", bg="#182635", fg="#f2f7fb", font=("Segoe UI Semibold", 9)).pack(side="left")

        main = tk.Frame(shell, bg="#0b1520")
        main.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        main.grid_columnconfigure(0, weight=5, uniform="workspace")
        main.grid_columnconfigure(1, weight=6, uniform="workspace")
        main.grid_rowconfigure(1, weight=1)

        control_card = ttk.Frame(main, style="Card.TFrame", padding=14)
        control_card.grid(row=0, column=0, columnspan=2, sticky="ew")
        ttk.Label(control_card, text="Connection & Control", style="Header.TLabel").grid(row=0, column=0, sticky="w")
        self.visible_check = ttk.Checkbutton(control_card, text="Open Excel while connected", variable=self.visible_excel_var)
        self.visible_check.grid(row=0, column=3, sticky="e", padx=(12, 0))
        button_row = ttk.Frame(control_card, style="Card.TFrame")
        button_row.grid(row=0, column=4, sticky="e", padx=(14, 0))
        self.connect_button = ttk.Button(button_row, text="Connect", style="Connect.TButton", width=14, command=self._start_connection)
        self.connect_button.pack(side="left")
        self.start_button = ttk.Button(button_row, text="Start Logging", style="Start.TButton", width=14, command=self._start_logging)
        self.start_button.pack(side="left", padx=(8, 0))
        self.disconnect_button = ttk.Button(button_row, text="Disconnect", style="Danger.TButton", width=14, command=self._stop_connection)
        self.disconnect_button.pack(side="left", padx=(8, 0))

        ttk.Label(control_card, text="Host / IP", style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(10, 4))
        ttk.Label(control_card, text="Port", style="Muted.TLabel").grid(row=1, column=1, sticky="w", pady=(10, 4))
        ttk.Label(control_card, text="Path", style="Muted.TLabel").grid(row=1, column=2, sticky="w", pady=(10, 4))
        ttk.Label(control_card, text="Manual Endpoint Override (optional)", style="Muted.TLabel").grid(row=1, column=3, sticky="w", pady=(10, 4), padx=(10, 0))

        self.host_entry = ttk.Entry(control_card, textvariable=self.host_var, width=22)
        self.host_entry.grid(row=2, column=0, sticky="ew", padx=(0, 8))
        self.port_entry = ttk.Entry(control_card, textvariable=self.port_var, width=8)
        self.port_entry.grid(row=2, column=1, sticky="ew", padx=(0, 8))
        self.path_entry = ttk.Entry(control_card, textvariable=self.path_var, width=16)
        self.path_entry.grid(row=2, column=2, sticky="ew", padx=(0, 8))
        self.manual_endpoint_entry = ttk.Entry(control_card, textvariable=self.manual_endpoint_var)
        self.manual_endpoint_entry.grid(row=2, column=3, sticky="ew", padx=(10, 0))

        ttk.Label(control_card, text="Endpoint Preview", style="Muted.TLabel").grid(row=3, column=0, sticky="w", pady=(10, 4))
        ttk.Entry(control_card, textvariable=self.endpoint_var, state="readonly").grid(row=4, column=0, columnspan=4, sticky="ew")

        control_card.columnconfigure(0, weight=3)
        control_card.columnconfigure(1, weight=1)
        control_card.columnconfigure(2, weight=2)
        control_card.columnconfigure(3, weight=3)

        session_card = ttk.Frame(main, style="Card.TFrame", padding=14)
        session_card.grid(row=1, column=0, sticky="nsew", pady=(12, 0), padx=(0, 12))
        session_card.columnconfigure(0, weight=1)
        ttk.Label(session_card, text="Runtime & Output", style="Header.TLabel").grid(row=0, column=0, sticky="w")
        self.runtime_badge = tk.Label(session_card, textvariable=self.status_var, bg="#42637b", fg="#eef7fc", font=("Segoe UI Semibold", 9), padx=10, pady=4)
        self.runtime_badge.grid(row=0, column=1, sticky="e")
        self._status_badges.append(self.runtime_badge)

        ttk.Label(session_card, textvariable=self.detail_var, style="Muted.TLabel", justify="left", wraplength=420).grid(row=1, column=0, columnspan=2, sticky="w", pady=(8, 0))
        ttk.Label(session_card, textvariable=self.perf_var, style="Muted.TLabel", justify="left", wraplength=420).grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))

        session_metrics = tk.Frame(session_card, bg="#15212d")
        session_metrics.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        for column in range(2):
            session_metrics.grid_columnconfigure(column, weight=1, uniform="session_metrics")
        self._make_metric_tile(session_metrics, "Nodes", value_variable=self.nodes_var).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self._make_metric_tile(session_metrics, "History", value_variable=self.history_selection_var).grid(row=0, column=1, sticky="ew")

        policy_panel = tk.Frame(session_card, bg="#1a2a3b", highlightbackground="#365870", highlightcolor="#365870", highlightthickness=1, bd=0, padx=10, pady=10)
        policy_panel.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        ttk.Label(policy_panel, text="Retention", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        retention_labels = [label for label, _ in HISTORY_RETENTION_OPTIONS]
        self.history_retention_menu = tk.OptionMenu(policy_panel, self.history_retention_var, retention_labels[0], *retention_labels[1:])
        self._style_option_menu(self.history_retention_menu, width=14)
        self.history_retention_menu.grid(row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Label(policy_panel, text="Archive Folder", style="Muted.TLabel").grid(row=0, column=1, sticky="w", padx=(12, 0))
        ttk.Entry(policy_panel, textvariable=self.archive_dir_var, state="readonly").grid(row=1, column=1, sticky="ew", padx=(12, 8), pady=(6, 0))
        ttk.Button(policy_panel, text="Browse", style="Utility.TButton", width=10, command=self._browse_archive_dir).grid(row=1, column=2, sticky="e", pady=(6, 0))
        ttk.Button(policy_panel, text="Open", style="Utility.TButton", width=10, command=self._open_archive_folder).grid(row=1, column=3, sticky="e", padx=(8, 0), pady=(6, 0))
        policy_panel.columnconfigure(1, weight=1)

        outputs_row = ttk.Frame(session_card, style="Card.TFrame")
        outputs_row.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        ttk.Button(outputs_row, text="Open Workbook", style="Utility.TButton", width=14, command=self._open_workbook).pack(side="left")
        ttk.Button(outputs_row, text="Output Folder", style="Utility.TButton", width=14, command=self._open_output_folder).pack(side="left", padx=(8, 0))
        ttk.Button(outputs_row, text="Archive Folder", style="Utility.TButton", width=14, command=self._open_archive_folder).pack(side="left", padx=(8, 0))

        ttk.Label(session_card, textvariable=self.last_archive_var, style="Muted.TLabel", justify="left", wraplength=420).grid(row=6, column=0, columnspan=2, sticky="w", pady=(12, 0))
        ttk.Label(session_card, textvariable=self.perf_log_var, style="Muted.TLabel", justify="left", wraplength=420).grid(row=7, column=0, columnspan=2, sticky="w", pady=(6, 0))

        history_card = ttk.Frame(main, style="Card.TFrame", padding=14)
        history_card.grid(row=1, column=1, sticky="nsew", pady=(12, 0))
        history_card.columnconfigure(0, weight=1)
        history_card.rowconfigure(2, weight=1)

        ttk.Label(history_card, text="History Fields", style="Header.TLabel").grid(row=0, column=0, sticky="w")
        hint_strip = tk.Frame(history_card, bg="#1a2a3b", highlightbackground="#365870", highlightcolor="#365870", highlightthickness=1, bd=0, padx=10, pady=8)
        hint_strip.grid(row=1, column=0, sticky="ew", pady=(8, 10))
        tk.Label(
            hint_strip,
            text="Live sheet can show all discovered nodes. History and per-port sheets only use the fields you stage here.",
            bg="#1a2a3b",
            fg="#b5c6d2",
            font=("Segoe UI", 9),
            justify="left",
            wraplength=640,
        ).pack(anchor="w")
        tk.Label(hint_strip, textvariable=self.history_filter_var, bg="#1a2a3b", fg="#92f3dd", font=("Segoe UI Semibold", 9)).pack(anchor="w", pady=(6, 0))

        dual_list_frame = ttk.Frame(history_card, style="Card.TFrame")
        dual_list_frame.grid(row=2, column=0, sticky="nsew")
        dual_list_frame.columnconfigure(0, weight=1)
        dual_list_frame.columnconfigure(2, weight=1)
        dual_list_frame.rowconfigure(0, weight=1)

        available_panel = ttk.Frame(dual_list_frame, style="Card.TFrame")
        available_panel.grid(row=0, column=0, sticky="nsew")
        ttk.Label(available_panel, text="Available", style="Muted.TLabel").pack(anchor="w", pady=(0, 6))
        available_list_frame = ttk.Frame(available_panel, style="Card.TFrame")
        available_list_frame.pack(fill="both", expand=True)
        self.available_history_listbox = tk.Listbox(available_list_frame, selectmode=tk.EXTENDED, exportselection=False, height=14)
        self._style_history_listbox(self.available_history_listbox)
        self.available_history_listbox.pack(side="left", fill="both", expand=True)
        available_scrollbar = ttk.Scrollbar(available_list_frame, orient="vertical", command=self.available_history_listbox.yview)
        available_scrollbar.pack(side="right", fill="y")
        self.available_history_listbox.configure(yscrollcommand=available_scrollbar.set)

        move_panel = ttk.Frame(dual_list_frame, style="Card.TFrame")
        move_panel.grid(row=0, column=1, sticky="ns", padx=10)
        self.add_history_button = ttk.Button(move_panel, text="Add >", style="Utility.TButton", width=10, command=self._move_available_to_selected)
        self.add_history_button.pack(fill="x", pady=(40, 8))
        self.remove_history_button = ttk.Button(move_panel, text="< Remove", style="Utility.TButton", width=10, command=self._move_selected_to_available)
        self.remove_history_button.pack(fill="x")
        self.select_all_history_button = ttk.Button(move_panel, text="All", style="Utility.TButton", width=10, command=self._select_all_history_fields)
        self.select_all_history_button.pack(fill="x", pady=(12, 8))
        self.clear_history_button = ttk.Button(move_panel, text="Clear", style="Utility.TButton", width=10, command=self._clear_history_fields)
        self.clear_history_button.pack(fill="x")

        selected_panel = ttk.Frame(dual_list_frame, style="Card.TFrame")
        selected_panel.grid(row=0, column=2, sticky="nsew")
        ttk.Label(selected_panel, text="Selected For History", style="Muted.TLabel").pack(anchor="w", pady=(0, 6))
        selected_list_frame = ttk.Frame(selected_panel, style="Card.TFrame")
        selected_list_frame.pack(fill="both", expand=True)
        self.selected_history_listbox = tk.Listbox(selected_list_frame, selectmode=tk.EXTENDED, exportselection=False, height=14)
        self._style_history_listbox(self.selected_history_listbox)
        self.selected_history_listbox.pack(side="left", fill="both", expand=True)
        selected_scrollbar = ttk.Scrollbar(selected_list_frame, orient="vertical", command=self.selected_history_listbox.yview)
        selected_scrollbar.pack(side="right", fill="y")
        self.selected_history_listbox.configure(yscrollcommand=selected_scrollbar.set)

        apply_panel = ttk.Frame(history_card, style="Card.TFrame")
        apply_panel.grid(row=3, column=0, sticky="ew", pady=(10, 0))
        tk.Label(
            apply_panel,
            text="Stage field selection first, then click Start Logging when you want the new setup to begin.",
            bg="#15212d",
            fg="#a7bac8",
            font=("Segoe UI", 9),
            justify="left",
        ).pack(side="left")
        self.apply_history_button = ttk.Button(apply_panel, text="Apply History Setup", style="Connect.TButton", width=16, command=self._apply_history_filter)
        self.apply_history_button.pack(side="right")

    def _bind_updates(self) -> None:
        for variable in (self.host_var, self.port_var, self.path_var):
            variable.trace_add("write", lambda *_args: self._refresh_endpoint_preview())
        self.archive_dir_var.trace_add("write", lambda *_args: self._update_archive_summary())
        self.history_retention_var.trace_add("write", lambda *_args: self._update_history_filter_summary())

    def _refresh_endpoint_preview(self) -> None:
        host = self.host_var.get().strip()
        port = self.port_var.get().strip() or "4840"
        path = self.path_var.get().strip().strip("/")
        if not host:
            self.endpoint_var.set("")
            return
        suffix = f"/{path}" if path else ""
        self.endpoint_var.set(f"opc.tcp://{host}:{port}{suffix}")

    def _update_archive_summary(self) -> None:
        archive_dir = self.archive_dir_var.get().strip()
        if not archive_dir:
            self.last_archive_var.set("Archive: trimmed rows are not being exported")
            return
        if self.last_archive_var.get().startswith("Archive:") and "exported" not in self.last_archive_var.get():
            self.last_archive_var.set(f"Archive folder: {archive_dir}")

    def _build_config(self) -> ViewerConfig:
        manual_endpoint = self.manual_endpoint_var.get().strip()
        endpoint = manual_endpoint or self.endpoint_var.get().strip()
        if not endpoint:
            raise ValueError("Endpoint is empty")
        if manual_endpoint and not manual_endpoint.lower().startswith("opc.tcp://"):
            endpoint = f"opc.tcp://{manual_endpoint}"
        archive_dir_text = self.archive_dir_var.get().strip()
        archive_dir = Path(archive_dir_text) if archive_dir_text else None
        return ViewerConfig(
            endpoint=endpoint,
            visible_excel=bool(self.visible_excel_var.get()),
            workbook_path=Path(self.workbook_var.get()),
            csv_path=Path(self.csv_var.get()),
            archive_dir=archive_dir,
            history_retention_seconds=self._get_selected_retention_seconds(),
        )

    def _start_connection(self) -> None:
        if self._worker_thread is not None and self._worker_thread.is_alive():
            return
        try:
            config = self._build_config()
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Invalid connection settings: {exc}")
            return
        self._queue = queue.Queue()
        self._command_queue = queue.Queue()
        self._stop_event = threading.Event()
        self._worker_thread = threading.Thread(target=self._worker_main, args=(config, self._queue, self._command_queue, self._stop_event), daemon=True, name="masterway-excel-viewer")
        self._connected = False
        self._logging_active = False
        self._set_status("Connecting", f"Connecting to {config.endpoint}...", "#285874", "#ffffff")
        self.perf_var.set("Perf: waiting for first OPC UA cycle")
        self._worker_thread.start()
        self._set_running_state()

    def _start_logging(self) -> None:
        if self._worker_thread is None or not self._worker_thread.is_alive():
            messagebox.showinfo(APP_TITLE, "Connect to the OPC UA endpoint first.")
            return
        if not self._connected:
            messagebox.showinfo(APP_TITLE, "Wait until OPC UA discovery completes, then start logging.")
            return
        self._command_queue.put(("set_history_filter", self._build_history_filter_payload()))
        self._command_queue.put(("set_history_retention", self._get_selected_retention_seconds()))
        self._command_queue.put(("set_archive_dir", self.archive_dir_var.get().strip()))
        self._command_queue.put(("start_logging", True))
        self._set_status("Starting", "Applying history settings and launching Excel...", "#284b67", "#ffffff")
        self.perf_var.set("Perf: launching Excel bridge")

    def _stop_connection(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
            self._set_status("Stopping", "Disconnect requested. Closing OPC UA and Excel bridge...", "#4d5d6b", "#ffffff")
            self._set_running_state()

    def _worker_main(
        self,
        config: ViewerConfig,
        outbound: queue.Queue[tuple[str, Any]],
        inbound: queue.Queue[tuple[str, Any]],
        stop_event: threading.Event,
    ) -> None:
        reader = OpcUaReader(config.endpoint, None, [], "pdi-fields")
        csv_writer = CsvHistoryWriter(config.csv_path)
        perf_log_path = config.workbook_path.parent / f"masterway_perf_{datetime.now():%Y%m%d}.csv"
        runtime_log_path = config.workbook_path.parent / f"masterway_runtime_{datetime.now():%Y%m%d}.log"
        perf_header_written = perf_log_path.exists() and perf_log_path.stat().st_size > 0
        excel_bridge: ExcelWorkbookBridge | None = None
        next_excel_at = 0.0
        next_port_sheet_at = 0.0
        next_history_at = 0.0
        next_save_at = 0.0
        next_prune_at = 0.0
        next_perf_ui_at = 0.0
        next_perf_log_at = 0.0
        history_filter_paths: set[str] | None = None
        history_retention_seconds = config.history_retention_seconds
        archive_dir = config.archive_dir
        session_archive_path: Path | None = None
        last_synced_port_sheet_names: set[str] | None = None
        logging_requested = False

        def append_runtime_log(context: str, exc: Exception) -> None:
            runtime_log_path.parent.mkdir(parents=True, exist_ok=True)
            with runtime_log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"[{datetime.now().isoformat()}] {context}\n")
                handle.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
                handle.write("\n")

        def append_runtime_note(message: str) -> None:
            runtime_log_path.parent.mkdir(parents=True, exist_ok=True)
            with runtime_log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"[{datetime.now().isoformat()}] NOTE {message}\n")

        def selected_port_sheet_names(current_snapshots: dict[str, Any]) -> set[str]:
            source_paths = current_snapshots.keys() if history_filter_paths is None else history_filter_paths
            selected_ports: set[str] = set()
            for browse_path in source_paths:
                port_view = classify_port_view(str(browse_path))
                if port_view is not None:
                    selected_ports.add(port_view.sheet_name)
            return selected_ports

        def is_excel_busy_error(exc: Exception) -> bool:
            target_code = -2146777998  # 0x800AC472: Excel rejected the COM call because it is busy.
            stack: list[Any] = [exc, *getattr(exc, "args", ())]
            while stack:
                item = stack.pop()
                if isinstance(item, int) and item == target_code:
                    return True
                if isinstance(item, (list, tuple)):
                    stack.extend(item)
                    continue
                if item is None:
                    continue
                text = str(item).lower()
                if str(target_code) in text or "0x800ac472" in text or "call was rejected by callee" in text:
                    return True
            return False

        def reset_excel_runtime(current_now: float, operation: str, exc: Exception) -> None:
            nonlocal excel_bridge, excel_ready, next_excel_at, next_port_sheet_at, next_history_at, next_save_at
            nonlocal next_prune_at, last_synced_port_sheet_names
            nonlocal logging_requested

            if is_excel_busy_error(exc):
                retry_at = current_now + 1.2
                next_excel_at = max(next_excel_at, retry_at)
                next_port_sheet_at = max(next_port_sheet_at, retry_at)
                next_history_at = max(next_history_at, retry_at)
                next_save_at = max(next_save_at, retry_at)
                next_prune_at = max(next_prune_at, retry_at)
                outbound.put(
                    (
                        "status",
                        (
                            "Running",
                            f"Excel is busy during {operation}. OPC UA stays connected and the workbook will retry shortly.",
                            "#6b5b25",
                            "#fff6e0",
                        ),
                    )
                )
                return

            append_runtime_log(f"excel_bridge:{operation}", exc)
            if excel_bridge is not None:
                try:
                    excel_bridge.close()
                except Exception:
                    pass
            excel_bridge = None
            excel_ready = False
            logging_requested = False
            last_synced_port_sheet_names = None
            retry_at = current_now + 2.0
            next_excel_at = retry_at
            next_port_sheet_at = retry_at
            next_history_at = retry_at
            next_save_at = retry_at
            next_prune_at = retry_at
            outbound.put(("logging_state", False))
            outbound.put(
                (
                    "status",
                    (
                        "Connected",
                        f"Excel bridge error during {operation}. Logging stopped and the workbook was closed. Review runtime log, then click Start Logging again. {exc}",
                        "#6b3e25",
                        "#fff0e8",
                    ),
                )
            )

        try:
            poll_seconds = max(config.poll_ms, 20) / 1000.0
            excel_seconds = max(config.excel_ms, config.poll_ms) / 1000.0
            port_sheet_seconds = max(config.port_sheet_ms, config.excel_ms) / 1000.0
            history_seconds = max(config.history_ms, config.poll_ms) / 1000.0
            save_seconds = max(config.save_ms, 1000) / 1000.0
            reconnect_seconds = max(config.reconnect_ms, 500) / 1000.0
            excel_ready = False
            outbound.put(("perf_path", str(perf_log_path)))
            outbound.put(("archive_dir", str(archive_dir) if archive_dir else ""))

            while not stop_event.is_set():
                try:
                    loop_started_at = time.perf_counter()
                    read_ms = 0.0
                    excel_live_ms = 0.0
                    history_write_ms = 0.0
                    prune_ms = 0.0
                    save_exec_ms = 0.0
                    history_row_count = 0
                    port_sheet_write = False

                    if reader.client is None:
                        outbound.put(("status", ("Connecting", "Connecting to OPC UA endpoint...", "#285874", "#ffffff")))
                        reader.connect()
                        outbound.put(("nodes", len(reader.node_cache)))
                        outbound.put(("node_paths", sorted(reader.node_cache)))
                        outbound.put(("status", ("Connected", f"Connected to {config.endpoint}. Review settings, then click Start Logging.", "#1f5c50", "#d7fff5")))

                    read_started_at = time.perf_counter()
                    snapshots = reader.read_all()
                    read_ms = (time.perf_counter() - read_started_at) * 1000.0
                    now = time.monotonic()

                    while True:
                        try:
                            command, payload = inbound.get_nowait()
                        except queue.Empty:
                            break
                        if command == "set_history_filter":
                            history_filter_paths = None if payload is None else set(payload)
                            outbound.put(("history_filter", None if history_filter_paths is None else sorted(history_filter_paths)))
                            if excel_ready and excel_bridge is not None:
                                excel_bridge.reset_history()
                                active_port_sheet_names = selected_port_sheet_names(snapshots)
                                excel_bridge.sync_port_view_sheets(active_port_sheet_names)
                                last_synced_port_sheet_names = set(active_port_sheet_names)
                                next_port_sheet_at = 0.0
                                next_history_at = 0.0
                                next_prune_at = 0.0
                        elif command == "set_history_retention":
                            history_retention_seconds = payload
                            outbound.put(("history_retention", history_retention_seconds))
                            next_prune_at = 0.0
                        elif command == "set_archive_dir":
                            archive_dir = Path(payload) if payload else None
                            session_archive_path = CsvHistoryWriter.build_session_archive_path(archive_dir) if archive_dir else None
                            outbound.put(("archive_dir", str(archive_dir) if archive_dir else ""))
                        elif command == "start_logging":
                            logging_requested = True

                    if logging_requested and not excel_ready and now >= next_excel_at:
                        outbound.put(("status", ("Launching Excel", "OPC UA connected. Launching the Excel workbook...", "#284b67", "#ffffff")))
                        try:
                            append_runtime_note("launch: create dedicated Excel bridge")
                            excel_bridge = ExcelWorkbookBridge(workbook_path=config.workbook_path, visible=config.visible_excel, write_history=True, reuse_existing_workbook=True, prefer_running_excel=False)
                            append_runtime_note("launch: open workbook")
                            excel_bridge.open()
                            append_runtime_note("launch: reset csv and workbook session")
                            csv_writer.reset()
                            excel_bridge.reset_live_session()
                            active_port_sheet_names = selected_port_sheet_names(snapshots)
                            append_runtime_note(f"launch: sync port sheets {sorted(active_port_sheet_names)}")
                            excel_bridge.sync_port_view_sheets(active_port_sheet_names)
                            last_synced_port_sheet_names = set(active_port_sheet_names)
                            session_archive_path = CsvHistoryWriter.build_session_archive_path(archive_dir) if archive_dir else None
                            next_excel_at = 0.0
                            next_port_sheet_at = 0.0
                            next_history_at = 0.0
                            next_save_at = 0.0
                            next_prune_at = 0.0
                            outbound.put(("workbook", str(config.workbook_path)))
                            outbound.put(("csv", str(config.csv_path)))
                            outbound.put(("logging_state", True))
                            append_runtime_note("launch: excel bridge ready")
                            outbound.put(("status", ("Running", f"Connected to {config.endpoint} and opened {config.workbook_path.name}.", "#1f5c50", "#d7fff5")))
                            excel_ready = True
                        except Exception as exc:
                            reset_excel_runtime(now, "launch", exc)

                    if excel_ready and excel_bridge is not None and now >= next_excel_at:
                        include_port_sheets = now >= next_port_sheet_at
                        port_snapshots = snapshots if history_filter_paths is None else {path: snapshot for path, snapshot in snapshots.items() if path in history_filter_paths}
                        try:
                            if include_port_sheets:
                                active_port_sheet_names = selected_port_sheet_names(snapshots)
                                if active_port_sheet_names != last_synced_port_sheet_names:
                                    excel_bridge.sync_port_view_sheets(active_port_sheet_names)
                                    last_synced_port_sheet_names = set(active_port_sheet_names)
                            excel_started_at = time.perf_counter()
                            excel_bridge.update_live(config.endpoint, snapshots, include_port_sheets=include_port_sheets, port_snapshots=port_snapshots)
                            excel_live_ms = (time.perf_counter() - excel_started_at) * 1000.0
                            port_sheet_write = include_port_sheets
                            if include_port_sheets:
                                next_port_sheet_at = now + port_sheet_seconds
                            next_excel_at = now + excel_seconds
                        except Exception as exc:
                            reset_excel_runtime(now, "live update", exc)

                    if excel_ready and now >= next_history_at:
                        history_snapshots = snapshots if history_filter_paths is None else {path: snapshot for path, snapshot in snapshots.items() if path in history_filter_paths}
                        history_row_count = len(history_snapshots)
                        rows = [
                            [
                                snapshot.updated_at,
                                snapshot.browse_path,
                                sanitize_excel_value(snapshot.value),
                                snapshot.value_type,
                                snapshot.server_timestamp,
                                snapshot.status_code,
                            ]
                            for snapshot in history_snapshots.values()
                        ]
                        history_started_at = time.perf_counter()
                        csv_writer.append_rows(rows)
                        if excel_bridge is not None and rows:
                            try:
                                excel_bridge.append_history(rows)
                            except Exception as exc:
                                reset_excel_runtime(now, "history update", exc)
                        history_write_ms = (time.perf_counter() - history_started_at) * 1000.0
                        next_history_at = now + history_seconds

                    if excel_ready and history_retention_seconds is not None and now >= next_prune_at:
                        cutoff_iso = (datetime.now(timezone.utc) - timedelta(seconds=history_retention_seconds)).isoformat()
                        prune_started_at = time.perf_counter()
                        removed_csv_rows = 0
                        archive_path = None
                        if archive_dir is not None:
                            if session_archive_path is None:
                                session_archive_path = CsvHistoryWriter.build_session_archive_path(archive_dir)
                            removed_csv_rows, archive_path = csv_writer.prune_to_archive_file(cutoff_iso, session_archive_path)
                        else:
                            removed_csv_rows = csv_writer.prune_older_than(cutoff_iso)
                        if excel_bridge is not None:
                            try:
                                excel_bridge.prune_history_older_than(cutoff_iso)
                            except Exception as exc:
                                reset_excel_runtime(now, "history prune", exc)
                        prune_ms = (time.perf_counter() - prune_started_at) * 1000.0
                        if removed_csv_rows > 0:
                            outbound.put(("archive_saved", (removed_csv_rows, str(archive_path) if archive_path else "")))
                        next_prune_at = now + (2.0 if history_retention_seconds <= 60 else 5.0)

                    if excel_ready and excel_bridge is not None and now >= next_save_at:
                        try:
                            save_started_at = time.perf_counter()
                            excel_bridge.save()
                            save_exec_ms = (time.perf_counter() - save_started_at) * 1000.0
                            next_save_at = now + save_seconds
                        except Exception as exc:
                            reset_excel_runtime(now, "workbook save", exc)

                    loop_ms = (time.perf_counter() - loop_started_at) * 1000.0
                    perf_payload = {
                        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                        "endpoint": config.endpoint,
                        "nodes": len(snapshots),
                        "history_rows": history_row_count,
                        "read_ms": round(read_ms, 1),
                        "excel_live_ms": round(excel_live_ms, 1),
                        "history_write_ms": round(history_write_ms, 1),
                        "prune_ms": round(prune_ms, 1),
                        "save_ms": round(save_exec_ms, 1),
                        "loop_ms": round(loop_ms, 1),
                        "port_sheet_write": port_sheet_write,
                    }
                    if now >= next_perf_ui_at:
                        outbound.put(("perf", perf_payload))
                        next_perf_ui_at = now + 0.75
                    if now >= next_perf_log_at:
                        perf_header_written = append_perf_log(perf_log_path, perf_payload, perf_header_written)
                        next_perf_log_at = now + 1.0

                    loop_elapsed = time.perf_counter() - loop_started_at
                    sleep_seconds = max(0.0, poll_seconds - loop_elapsed)
                    if sleep_seconds > 0 and stop_event.wait(sleep_seconds):
                        break
                except Exception as exc:
                    append_runtime_log("worker_main:loop", exc)
                    outbound.put(("logging_state", False))
                    outbound.put(("status", ("Reconnecting", str(exc), "#6b3e25", "#fff0e8")))
                    reader.disconnect()
                    if stop_event.wait(reconnect_seconds):
                        break
        except Exception as exc:
            append_runtime_log("worker_main:fatal", exc)
            outbound.put(("fatal", str(exc)))
        finally:
            reader.disconnect()
            if excel_bridge is not None:
                try:
                    excel_bridge.close()
                except Exception:
                    pass
            outbound.put(("stopped", None))

    def _drain_queue(self) -> None:
        while True:
            try:
                event, payload = self._queue.get_nowait()
            except queue.Empty:
                break
            if event == "status":
                name, detail, bg, fg = payload
                self._set_status(name, detail, bg, fg)
                self._connected = name in {"Connected", "Running"}
            elif event == "nodes":
                self.nodes_var.set(f"Nodes: {payload}")
            elif event == "node_paths":
                self._refresh_history_list(list(payload))
                self._connected = True
                self._set_running_state()
            elif event == "history_filter":
                self._sync_history_filter_state(payload)
            elif event == "history_retention":
                self._sync_history_retention_state(payload)
            elif event == "archive_dir":
                self.archive_dir_var.set(str(payload or ""))
            elif event == "archive_saved":
                removed_rows, archive_path = payload
                if archive_path:
                    self.last_archive_var.set(f"Archive: {removed_rows} row(s) exported to {archive_path}")
                else:
                    self.last_archive_var.set(f"Archive: {removed_rows} row(s) trimmed with no export folder")
            elif event == "logging_state":
                self._logging_active = bool(payload)
                self._set_running_state()
            elif event == "workbook":
                self.workbook_var.set(str(payload))
            elif event == "csv":
                self.csv_var.set(str(payload))
            elif event == "perf":
                self._set_perf_summary(payload)
            elif event == "perf_path":
                self.perf_log_var.set(f"Perf log: {Path(str(payload)).name}")
            elif event == "fatal":
                self._set_status("Error", str(payload), "#6c2e36", "#ffe9ed")
                self.perf_var.set("Perf: stopped after error")
                self._connected = False
                self._logging_active = False
                self._worker_thread = None
                self._stop_event = None
                self._set_running_state()
            elif event == "stopped":
                self._connected = False
                self._logging_active = False
                self._worker_thread = None
                self._stop_event = None
                self._set_running_state()
                self.perf_var.set("Perf: idle")
                if self.status_var.get() != "Error":
                    self._set_status("Idle", "Disconnected. You can change the IP, reconnect, and start a new logging session.", "#243746", "#d7e4ef")
        self.root.after(120, self._drain_queue)

    def _set_status(self, name: str, detail: str, bg: str, fg: str) -> None:
        self.status_var.set(name)
        self.detail_var.set(detail)
        for badge in self._status_badges:
            badge.configure(bg=bg, fg=fg)

    def _set_perf_summary(self, payload: dict[str, Any]) -> None:
        self.perf_var.set(
            "Perf: read {read_ms} ms | live {live_ms} ms | history {history_ms} ms | prune {prune_ms} ms | loop {loop_ms} ms".format(
                read_ms=payload.get("read_ms", 0.0),
                live_ms=payload.get("excel_live_ms", 0.0),
                history_ms=payload.get("history_write_ms", 0.0),
                prune_ms=payload.get("prune_ms", 0.0),
                loop_ms=payload.get("loop_ms", 0.0),
            )
        )
        self.nodes_var.set(f"Nodes: {payload.get('nodes', 0)}")

    def _set_running_state(self) -> None:
        thread_alive = self._worker_thread is not None and self._worker_thread.is_alive()
        connect_state = "disabled" if thread_alive else "normal"
        disconnect_state = "normal" if thread_alive else "disabled"
        start_state = "normal" if self._connected and not self._logging_active else "disabled"
        history_controls_state = "normal" if self._history_paths else "disabled"

        for widget in (self.host_entry, self.port_entry, self.path_entry, self.manual_endpoint_entry, self.visible_check):
            try:
                widget.configure(state=connect_state)
            except tk.TclError:
                pass
        self.connect_button.configure(state=connect_state)
        self.disconnect_button.configure(state=disconnect_state)
        self.start_button.configure(state=start_state)
        for widget in (self.add_history_button, self.remove_history_button, self.select_all_history_button, self.clear_history_button, self.apply_history_button):
            widget.configure(state=history_controls_state)
        self.history_retention_menu.configure(state="normal")

    def _refresh_history_list(self, browse_paths: list[str]) -> None:
        previous_selection = set(self._selected_history_paths)
        self._history_paths = list(dict.fromkeys(browse_paths))
        if self._history_filter_explicit:
            selected_paths = {browse_path for browse_path in self._history_paths if browse_path in previous_selection}
        else:
            selected_paths = set(self._history_paths)
        self._selected_history_paths = selected_paths
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _sync_history_filter_state(self, payload: list[str] | None) -> None:
        if payload is None:
            self._selected_history_paths = set(self._history_paths)
            self._history_filter_explicit = False
        else:
            self._selected_history_paths = {path for path in self._history_paths if path in set(payload)}
            self._history_filter_explicit = len(self._selected_history_paths) != len(self._history_paths)
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _sync_history_retention_state(self, retention_seconds: int | None) -> None:
        for label, seconds in HISTORY_RETENTION_OPTIONS:
            if seconds == retention_seconds:
                self.history_retention_var.set(label)
                break
        self._update_history_filter_summary()

    def _populate_history_listboxes(self) -> None:
        self._available_history_paths_cache = [path for path in self._history_paths if path not in self._selected_history_paths]
        self._selected_history_paths_cache = [path for path in self._history_paths if path in self._selected_history_paths]
        self.available_history_listbox.delete(0, tk.END)
        for browse_path in self._available_history_paths_cache:
            self.available_history_listbox.insert(tk.END, self._format_history_path_label(browse_path))
        self.selected_history_listbox.delete(0, tk.END)
        for browse_path in self._selected_history_paths_cache:
            self.selected_history_listbox.insert(tk.END, self._format_history_path_label(browse_path))

    @staticmethod
    def _format_history_path_label(browse_path: str) -> str:
        port_view = classify_port_view(browse_path)
        if port_view is None:
            return browse_path
        return f"{port_view.sheet_name} | {port_view.field_label}"

    def _move_available_to_selected(self) -> None:
        for index in self.available_history_listbox.curselection():
            if 0 <= index < len(self._available_history_paths_cache):
                self._selected_history_paths.add(self._available_history_paths_cache[index])
        self._history_filter_explicit = len(self._selected_history_paths) != len(self._history_paths)
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _move_selected_to_available(self) -> None:
        for index in self.selected_history_listbox.curselection():
            if 0 <= index < len(self._selected_history_paths_cache):
                self._selected_history_paths.discard(self._selected_history_paths_cache[index])
        self._history_filter_explicit = True
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _select_all_history_fields(self) -> None:
        if not self._history_paths:
            return
        self._selected_history_paths = set(self._history_paths)
        self._history_filter_explicit = False
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _clear_history_fields(self) -> None:
        self._selected_history_paths = set()
        self._history_filter_explicit = True
        self._populate_history_listboxes()
        self._update_history_filter_summary()

    def _apply_history_filter(self) -> None:
        if not self._history_paths:
            messagebox.showinfo(APP_TITLE, "Connect first so the viewer can discover PDI fields.")
            return
        self._history_filter_explicit = len(self._selected_history_paths) != len(self._history_paths)
        payload = self._build_history_filter_payload()
        self._update_history_filter_summary()
        archive_path = self.archive_dir_var.get().strip() or "disabled"
        if self._logging_active:
            self._command_queue.put(("set_history_filter", payload))
            self._command_queue.put(("set_history_retention", self._get_selected_retention_seconds()))
            self._command_queue.put(("set_archive_dir", self.archive_dir_var.get().strip()))
            if payload is None:
                messagebox.showinfo(APP_TITLE, f"Logging settings updated. All discovered fields are now logged with retention '{self.history_retention_var.get()}' and archive path '{archive_path}'.")
            elif payload:
                messagebox.showinfo(APP_TITLE, f"Logging settings updated. {len(payload)} selected field(s) are now logged with retention '{self.history_retention_var.get()}' and archive path '{archive_path}'.")
            else:
                messagebox.showinfo(APP_TITLE, "Logging settings updated. Live view continues, but history logging is paused until you select fields again.")
        else:
            messagebox.showinfo(APP_TITLE, f"Settings staged. Click Start Logging to apply retention '{self.history_retention_var.get()}' and archive path '{archive_path}'.")

    def _update_history_filter_summary(self) -> None:
        total = len(self._history_paths)
        selected = len(self._selected_history_paths)
        retention_label = self.history_retention_var.get()
        if total == 0:
            self.history_filter_var.set(f"History: connect to discover fields | retention: {retention_label}")
            self.history_selection_var.set("Selection: --")
        elif selected == total:
            self.history_filter_var.set(f"History: all {total} fields selected | retention: {retention_label}")
            self.history_selection_var.set(f"All {total} fields")
        elif selected == 0:
            self.history_filter_var.set(f"History: paused, no fields selected | retention: {retention_label}")
            self.history_selection_var.set("0 selected")
        else:
            self.history_filter_var.set(f"History: {selected}/{total} fields selected | retention: {retention_label}")
            self.history_selection_var.set(f"{selected} of {total} selected")

    def _get_selected_retention_seconds(self) -> int | None:
        return HISTORY_RETENTION_MAP.get(self.history_retention_var.get())

    def _build_history_filter_payload(self) -> list[str] | None:
        if len(self._selected_history_paths) == len(self._history_paths):
            return None
        return sorted(self._selected_history_paths)

    def _browse_archive_dir(self) -> None:
        initial_dir = self.archive_dir_var.get().strip() or str(self.output_dir)
        selected_dir = filedialog.askdirectory(title="Choose archive folder", initialdir=initial_dir, mustexist=False)
        if selected_dir:
            self.archive_dir_var.set(selected_dir)

    def _open_output_folder(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        os.startfile(str(self.output_dir))

    def _open_archive_folder(self) -> None:
        archive_dir = self.archive_dir_var.get().strip()
        if not archive_dir:
            messagebox.showinfo(APP_TITLE, "Archive folder is disabled.")
            return
        archive_path = Path(archive_dir)
        archive_path.mkdir(parents=True, exist_ok=True)
        os.startfile(str(archive_path))

    def _open_workbook(self) -> None:
        workbook_path = Path(self.workbook_var.get())
        if workbook_path.exists():
            os.startfile(str(workbook_path))
        else:
            messagebox.showinfo(APP_TITLE, "Workbook has not been created yet. Connect first.")

    @staticmethod
    def _open_linkedin() -> None:
        webbrowser.open(LINKEDIN_URL)

    def _on_mousewheel(self, event: tk.Event) -> None:
        canvas = getattr(self, "content_canvas", None)
        if canvas is None:
            return
        try:
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        except Exception:
            pass

    def _on_close(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        self.root.after(300, self.root.destroy)


def main() -> int:
    root = tk.Tk()
    ViewerApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
