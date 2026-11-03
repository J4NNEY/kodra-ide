# Build, verify and package a Windows release of Kodra.
#
# Usage:
#   pnpm release:win                         # full build + latest.json
#   pnpm release:win -SkipTests              # skip typecheck/cargo test
#   pnpm release:win -NoBuild                # reuse the last build
#   pnpm release:win -UpdateBaseUrl https://example.com/kodra
#
# With no -UpdateBaseUrl the manifest points at
# https://github.com/J4NNEY/kodra-ide/releases/download/v<version>/.
#
# Output (release/, git-ignored):
#   Kodra_<version>_x64-setup.exe   installer to upload
#   latest.json                     update manifest, includes SHA-256
#   checksums.txt                   sha256 for the installer and the app exe
#
# Code signing stays optional: set the KODRA_SIGN_* variables described in
# scripts/sign-windows.ps1 and Tauri signs the exe and the installer during the
# build. Without them the artifacts are unsigned and SmartScreen will warn.

param(
    [string]$Notes = '',
    [switch]$SkipTests,
    [switch]$NoBuild,
    [string]$UpdateBaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $conf = Get-Content -LiteralPath 'src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json
    $version = $conf.version
    $pkg = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json

    $cargoRaw = Get-Content -LiteralPath 'src-tauri\Cargo.toml' -Raw
    $cargoMatch = [regex]::Match($cargoRaw, '(?m)^version\s*=\s*"([^"]+)"')
    if (-not $cargoMatch.Success) { throw 'Could not read the version from src-tauri/Cargo.toml' }
    $cargoVersion = $cargoMatch.Groups[1].Value

    if ($pkg.version -ne $version -or $cargoVersion -ne $version) {
        throw "Version mismatch: tauri.conf.json=$version package.json=$($pkg.version) Cargo.toml=$cargoVersion"
    }
    if (-not $UpdateBaseUrl) {
        # GitHub Releases hosts the installer for the tag that matches this build.
        $UpdateBaseUrl = "https://github.com/J4NNEY/kodra-ide/releases/download/v$version"
    }
    if (-not $UpdateBaseUrl.StartsWith('https://')) {
        Write-Warning "UpdateBaseUrl is not https; the app refuses non-local http feeds."
    }

    Write-Host "kodra: building $version" -ForegroundColor Cyan

    if (-not $SkipTests) {
        Write-Host 'kodra: typecheck' -ForegroundColor Cyan
        pnpm typecheck
        if ($LASTEXITCODE -ne 0) { throw 'pnpm typecheck failed' }

        Write-Host 'kodra: rust tests' -ForegroundColor Cyan
        cargo test --manifest-path src-tauri\Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'cargo test failed' }
    }

    if (-not $NoBuild) {
        Write-Host 'kodra: tauri build' -ForegroundColor Cyan
        pnpm tauri build
        if ($LASTEXITCODE -ne 0) { throw 'tauri build failed' }
    }

    $installerName = "Kodra_${version}_x64-setup.exe"
    $installer = Join-Path $root "src-tauri\target\release\bundle\nsis\$installerName"
    $appExe = Join-Path $root 'src-tauri\target\release\kodra.exe'
    if (-not (Test-Path -LiteralPath $installer)) {
        throw "Installer not found: $installer (did the build finish?)"
    }

    $releaseDir = Join-Path $root 'release'
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    $releaseInstaller = Join-Path $releaseDir $installerName
    Copy-Item -LiteralPath $installer -Destination $releaseInstaller -Force

    $installerHash = (Get-FileHash -LiteralPath $releaseInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksums = @("$installerHash  $installerName")
    if (Test-Path -LiteralPath $appExe) {
        Copy-Item -LiteralPath $appExe -Destination (Join-Path $releaseDir 'kodra.exe') -Force
        $exeHash = (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash.ToLowerInvariant()
        $checksums += "$exeHash  kodra.exe"
    }
    Set-Content -LiteralPath (Join-Path $releaseDir 'checksums.txt') -Value $checksums -Encoding ascii

    if (-not $Notes) {
        # Pull the notes for this version out of CHANGELOG.md when possible.
        if (Test-Path -LiteralPath 'CHANGELOG.md') {
            # Read as UTF-8 explicitly: Windows PowerShell 5.1 defaults to the
            # ANSI code page, which mangles em dashes and arrows in the notes.
            $lines = [System.IO.File]::ReadAllLines(
                (Join-Path $root 'CHANGELOG.md'),
                [System.Text.UTF8Encoding]::new($false)
            )
            $start = ($lines | Select-String -Pattern "^##\s*\[?$([regex]::Escape($version))\]?" | Select-Object -First 1).LineNumber
            if ($start) {
                $body = @()
                for ($i = $start; $i -lt $lines.Count; $i++) {
                    if ($lines[$i] -match '^##\s') { break }
                    $body += $lines[$i]
                }
                $Notes = ($body -join "`n").Trim()
            }
        }
        if (-not $Notes) { $Notes = "Kodra $version" }
    }

    $base = $UpdateBaseUrl.TrimEnd('/')
    $manifest = [ordered]@{
        version   = $version
        notes     = $Notes
        pub_date  = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                url    = "$base/$installerName"
                sha256 = $installerHash
            }
        }
    }
    $manifestPath = Join-Path $releaseDir 'latest.json'
    $json = $manifest | ConvertTo-Json -Depth 6
    # Write UTF-8 without a BOM: serde_json rejects a leading BOM.
    [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))

    $signature = (Get-AuthenticodeSignature -LiteralPath $releaseInstaller).Status
    Write-Host ''
    Write-Host "kodra: release $version ready" -ForegroundColor Green
    Write-Host "  installer : $releaseInstaller"
    Write-Host "  sha256    : $installerHash"
    Write-Host "  manifest  : $manifestPath"
    Write-Host "  signature : $signature"
    if ($signature -ne 'Valid') {
        Write-Warning 'The installer is not signed. SmartScreen will warn until KODRA_SIGN_* is configured.'
    }
    Write-Host ''
    Write-Host 'Next: upload the installer and latest.json to the feed origin, then point'
    Write-Host "Settings -> Update feed at $base/latest.json"
}
finally {
    Pop-Location
}
