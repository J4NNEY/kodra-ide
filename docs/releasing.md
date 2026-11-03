# Releasing Kodra

Kodra ships to Windows x64 as a per-user NSIS installer. This page covers the version bump, the
build, code signing, the update feed and the manual smoke test.

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Windows | 10 1809+ / 11, x64 | Supported target |
| Node.js | 22 LTS or newer | `node --version` |
| pnpm | 9 | `corepack enable` then `corepack prepare pnpm@9 --activate` |
| Rust | stable, MSVC toolchain | `rustup default stable-x86_64-pc-windows-msvc` |
| Visual Studio Build Tools | C++ workload + Windows SDK | Needed by `link.exe` and `signtool` |
| WebView2 | Evergreen runtime | The installer downloads the bootstrapper when missing |

`pnpm install` once after cloning. Tauri downloads NSIS on the first bundle.

## 2. Bump the version

The version lives in three files and must match everywhere:

- `src-tauri/tauri.conf.json` → `version`
- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`

Add the matching section to `CHANGELOG.md`; `scripts/release.ps1` copies it into the update
manifest as release notes. `scripts/release.ps1` refuses to build when the three versions disagree.

## 3. Build and package

Stop the dev server first. `pnpm dev` and `pnpm build` share `.nuxt` and `.output` in the same
checkout, and when both run they delete each other's `.nuxt/dist`. The build then emits an
`index.html` that points at the dev server, and the packaged app opens a blank window.
`scripts/release.ps1` refuses to start while something is listening on the `devUrl` port, so
`NUXT_IGNORE_LOCK=1` is never the right answer here.

```powershell
pnpm release:win
```

That runs `pnpm typecheck`, `cargo test`, `pnpm tauri build`, then writes:

| Path | Contents |
| --- | --- |
| `release/Kodra_<version>_x64-setup.exe` | Installer to upload |
| `release/latest.json` | Update manifest with the installer's SHA-256 |
| `release/checksums.txt` | SHA-256 for the installer and `kodra.exe` |
| `release/kodra.exe` | Portable exe (no installer) |

Useful switches: `-SkipTests`, `-NoBuild` (reuse the last build), `-Notes "text"` and
`-UpdateBaseUrl https://host/path`. Without `-UpdateBaseUrl` the manifest points at
`https://github.com/J4NNEY/kodra-ide/releases/download/v<version>/`, which is where the tag workflow
uploads the installer. Override it when hosting the feed somewhere else.

## 4. Code signing

Signing is pre-wired through `bundle.windows.signCommand`, which calls
`scripts/sign-windows.ps1` for the app exe and the installer. Without a certificate the script exits
successfully and the build stays unsigned, so nothing breaks before the certificate exists.

Set the variables in the same shell before `pnpm release:win`:

```powershell
$env:KODRA_SIGN_PFX = 'C:\certs\kodra.pfx'
$env:KODRA_SIGN_PFX_PASSWORD = '...'
# or use a certificate already in CurrentUser\My:
$env:KODRA_SIGN_THUMBPRINT = 'AB12...'
$env:KODRA_TIMESTAMP_URL = 'http://timestamp.digicert.com'   # optional
pnpm release:win
```

The script finds `signtool.exe` on `PATH` or in the latest Windows Kits installation, signs with
SHA-256 and an RFC 3161 timestamp, then verifies the result. `Get-AuthenticodeSignature` on the
installer should report `Valid`.

Unsigned builds work but trigger SmartScreen and Microsoft Defender warnings. A standard OV
certificate builds reputation over time; an EV certificate (hardware token or cloud HSM) has
immediate reputation. Never commit the certificate or its password: `*.pfx`, `*.p12` and `.env*` are
git-ignored.

## 5. Publish the feed

Upload the installer and `latest.json` to the same HTTPS origin. Options:

- **GitHub Releases** (what Kodra uses) — attach `latest.json` and the installer to the release for
  tag `v<version>`. Users configure the feed once as
  `https://github.com/J4NNEY/kodra-ide/releases/latest/download/latest.json`; the manifest's download
  URL points at `https://github.com/J4NNEY/kodra-ide/releases/download/v<version>/Kodra_<version>_x64-setup.exe`.
  GitHub serves it over HTTPS and keeps every tagged asset, so the manifest never drifts.
- **Object storage / CDN** (S3, R2, B2) — serve the folder over HTTPS with a short cache TTL
  (60–300 s) for `latest.json`; the installer can be cached forever because its name contains the
  version.
- **Static host** (Netlify, Cloudflare Pages, nginx) — same policy.

The app refuses `http://` feeds except on localhost, so an HTTPS certificate for the feed host is
mandatory. Do not point the feed at a URL you do not control.

Users set the feed once in **Settings → Integrations → Update feed**. The About page then shows
**Check**, **Download** (checksum verified), **Install** and **Reveal**.

## 6. GitHub Actions

`.github/workflows/ci.yml` runs typecheck, Rust tests, clippy (informational) and a frontend build on
every push and pull request.

`.github/workflows/release.yml` builds on a `v*` tag:

```powershell
git tag v1.1.0
git push origin main --tags
```

Configure these repository secrets/variables first:

| Name | Kind | Purpose |
| --- | --- | --- |
| `KODRA_SIGN_PFX_BASE64` | secret | Base64 of the `.pfx` (optional) |
| `KODRA_SIGN_PFX_PASSWORD` | secret | Password for the `.pfx` (optional) |
| `KODRA_TIMESTAMP_URL` | secret | Timestamp server (optional) |
| `KODRA_UPDATE_BASE_URL` | variable | Base URL used in `latest.json` (optional) |

The workflow checks that the tag matches the config version, uploads `release/*` as a workflow
artifact and opens a **draft** GitHub release with the same files. Review it, then publish.

## 7. Smoke test before publishing

1. Install with the produced `Kodra_<version>_x64-setup.exe` on a clean Windows profile. It installs
   per user, so no admin prompt should appear.
2. Launch Kodra, open a folder, edit and save a file, open a terminal, and run one task and one test.
3. If you are upgrading from the pre-rename build, confirm `%APPDATA%\app.kodra.desktop\settings.json`
   exists and recents, themes and API keys were copied from `dev.kudo.desktop`. The old folder stays
   untouched for rollback.
4. Point the update feed at the new manifest, run **Check**, then **Download**. The toast must say the
   checksum was verified; a tampered file must be rejected with a checksum mismatch.
5. Confirm `Get-AuthenticodeSignature release\Kodra_<version>_x64-setup.exe` reports `Valid`.
6. Uninstall from Windows Settings and check that user data in `%APPDATA%\app.kodra.desktop` is left
   alone (the installer does not delete it).

## 8. If something is wrong

- **Never publish an older version to fix a bad one.** The updater compares versions, so a lower
  version is ignored. Ship a higher patch version.
- Rebuilding the same version with different bytes is fine only if you update `latest.json` too; the
  checksum is part of the manifest.
- A checksum mismatch means the uploaded file and the manifest disagree. Re-run the packaging step
  (`pnpm release:win -NoBuild`) rather than editing the hash by hand.
