param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$env:APP_ENV = if ($env:APP_ENV) { $env:APP_ENV } else { "production" }
$env:PORT = "$Port"
$env:FLASK_USE_RELOADER = "0"

python run.py
