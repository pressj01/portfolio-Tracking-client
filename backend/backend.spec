# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[('config.py', '.'), ('database.py', '.'), ('import_data.py', '.'), ('normalize.py', '.'), ('grading.py', '.'), ('create_template.py', '.'), ('tax_report.py', '.'), ('dividend_safety.py', '.'), ('transaction_import.py', '.'), ('portfolio_tester.py', '.'), ('options_pricing.py', '.'), ('options_api.py', '.'), ('seed', 'seed')],
    hiddenimports=['flask', 'flask_cors', 'pandas', 'openpyxl', 'yfinance', 'plotly', 'scipy', 'pypdf', 'sqlite3', 'statistics', 'decimal', 'config', 'database', 'import_data', 'normalize', 'grading', 'create_template', 'tax_report', 'dividend_safety', 'transaction_import', 'portfolio_tester', 'options_pricing', 'options_api'],
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
