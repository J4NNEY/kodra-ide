# Sign a Kodra binary (app exe or NSIS installer) with signtool.
#
# Tauri calls this through bundle.windows.signCommand, passing the file to sign
# as %1. With no certificate configured the script exits successfully and the
# build stays unsigned, so local builds keep working before the certificate
# exists.
#
# Configure one of these before building:
#   KODRA_SIGN_PFX          path to a .pfx file (recommended for CI)
#   KODRA_SIGN_PFX_PASSWORD password for the .pfx
#   KODRA_SIGN_THUMBPRINT   SHA-1 thumbprint of a certificate already in the
#                           current user's certificate store
#   KODRA_TIMESTAMP_URL     RFC 3161 timestamp server
#                           (default: http://timestamp.digicert.com)
#
# Example:
#   $env:KODRA_SIGN_PFX = 'C:\certs\kodra.pfx'
#   $env:KODRA_SIGN_PFX_PASSWORD = '...'
#   pnpm tauri build

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "kodra: cannot sign missing file: $Path"
    exit 1
}

$pfx = $env:KODRA_SIGN_PFX
$thumbprint = $env:KODRA_SIGN_THUMBPRINT
if (-not $pfx -and -not $thumbprint) {
    Write-Host "kodra: code signing not configured; leaving $(Split-Path -Leaf $Path) unsigned."
    exit 0
}
if ($pfx -and -not (Test-Path -LiteralPath $pfx)) {
    Write-Error "kodra: KODRA_SIGN_PFX points at a missing file: $pfx"
    exit 1
}

function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $roots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $candidates = Get-ChildItem -LiteralPath $root -Directory |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
            Where-Object { Test-Path -LiteralPath $_ }
        if ($candidates) { return ($candidates | Select-Object -First 1) }
    }
    return $null
}

$signTool = Find-SignTool
if (-not $signTool) {
    Write-Error "kodra: signtool.exe was not found. Install the Windows SDK signing tools and retry."
    exit 1
}

$timestamp = if ($env:KODRA_TIMESTAMP_URL) { $env:KODRA_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }
$signArgs = @('sign', '/fd', 'sha256', '/td', 'sha256', '/tr', $timestamp, '/d', 'Kodra')

if ($pfx) {
    $signArgs += @('/f', $pfx)
    if ($env:KODRA_SIGN_PFX_PASSWORD) {
        $signArgs += @('/p', $env:KODRA_SIGN_PFX_PASSWORD)
    }
} else {
    $signArgs += @('/sha1', $thumbprint)
}

$signArgs += $Path

Write-Host "kodra: signing $(Split-Path -Leaf $Path)"
& $signTool @signArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $signTool verify /pa /v $Path | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "kodra: signature verification failed for $Path"
    exit $LASTEXITCODE
}
Write-Host "kodra: signature verified."
