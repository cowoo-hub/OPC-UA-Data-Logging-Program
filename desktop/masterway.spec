# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata


ROOT = Path(SPECPATH).resolve().parent
BACKEND_DIR = ROOT / "backend"
DESKTOP_DIR = ROOT / "desktop"
DESKTOP_ASSETS_DIR = DESKTOP_DIR / "assets"
FRONTEND_DIST_DIR = ROOT / "frontend" / "dist"

datas = [
    (str(BACKEND_DIR / "data"), "backend/data"),
    (str(FRONTEND_DIST_DIR), "frontend/dist"),
]
datas += collect_data_files("webview")
datas += collect_data_files("qtpy")
datas += collect_data_files("PySide6")
datas += copy_metadata("fastapi")
datas += copy_metadata("uvicorn")
datas += copy_metadata("pymodbus")
datas += copy_metadata("python-multipart")
datas += copy_metadata("pywebview")
datas += copy_metadata("QtPy")
datas += copy_metadata("PySide6")

hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("multipart")
hiddenimports += collect_submodules("pymodbus")
hiddenimports += collect_submodules("webview")
hiddenimports += collect_submodules("qtpy")
hiddenimports += collect_submodules("PySide6")


a = Analysis(
    [str(DESKTOP_DIR / "launcher.py")],
    pathex=[str(ROOT), str(BACKEND_DIR), str(DESKTOP_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pythonnet", "clr", "webview.platforms.winforms", "webview.platforms.edgechromium"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Masterway",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(DESKTOP_ASSETS_DIR / "masterway.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Masterway",
)
