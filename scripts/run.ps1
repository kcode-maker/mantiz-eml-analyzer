# Double-click-friendly wrapper (Windows) around the real cross-platform
# launcher, scripts/serve.py. Requires only Python 3.
param([int]$Port = 8765)

Set-Location $PSScriptRoot

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $pythonCmd) {
  Write-Error "Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and try again."
  exit 1
}

& $pythonCmd.Source "serve.py" $Port
