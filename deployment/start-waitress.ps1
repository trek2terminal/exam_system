param(
    [int]$Port = 8000,
    [string]$HostAddress = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$env:APP_ENV = if ($env:APP_ENV) { $env:APP_ENV } else { "production" }

python -m waitress --host=$HostAddress --port=$Port wsgi:app
