# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[('config.py', '.'), ('database.py', '.'), ('import_data.py', '.'), ('normalize.py', '.'), ('grading.py', '.'), ('create_template.py', '.')],
    hiddenimports=['flask', 'flask_cors', 'pandas', 'openpyxl', 'yfinance', 'plotly', 'sqlite3', 'statistics', 'decimal', 'config', 'database', 'import_data', 'normalize', 'grading', 'create_template'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',
)
