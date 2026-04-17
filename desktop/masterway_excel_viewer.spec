# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata


ROOT = Path(SPECPATH).resolve().parent
DESKTOP_DIR = ROOT / "desktop"
DESKTOP_ASSETS_DIR = DESKTOP_DIR / "assets"

datas = []
datas += collect_data_files("win32com")
datas += copy_metadata("opcua")
datas += copy_metadata("pywin32")
datas += [
    (str(DESKTOP_ASSETS_DIR / "masterway-brand-ui2.png"), "assets"),
    (str(DESKTOP_ASSETS_DIR / "masterway-brand.png"), "assets"),
    (str(DESKTOP_ASSETS_DIR / "masterway-icon-256.png"), "assets"),
]

hiddenimports = [
    "pythoncom",
    "pywintypes",
    "win32timezone",
]
hiddenimports += collect_submodules("opcua")
hiddenimports += collect_submodules("win32com")


a = Analysis(
    [str(DESKTOP_DIR / "excel_viewer.py")],
    pathex=[str(ROOT), str(DESKTOP_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="MasterwayExcelViewer",
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
    name="MasterwayExcelViewer",
)
