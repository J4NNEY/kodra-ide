# Update feed

Kudo checks a plain JSON manifest over HTTP(S). Set the feed URL in **Settings → Integrations →
Update feed** (stored as `updateFeed` in `settings.json`). The About page then exposes **Check**,
**Download**, **Install** and **Reveal**.

## Manifest

```json
{
  "version": "0.2.0",
  "notes": "Faster startup and a new network panel.",
  "pub_date": "2026-02-01T10:00:00Z",
  "platforms": {
    "windows-x86_64": { "url": "https://downloads.example.com/kudo_0.2.0_x64-setup.exe" },
    "darwin-aarch64": { "url": "https://downloads.example.com/kudo_0.2.0_aarch64.dmg" },
    "linux-x86_64": { "url": "https://downloads.example.com/kudo_0.2.0_amd64.AppImage" }
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `version` | yes | Semver-ish string; compared numerically (`0.10.0 > 0.9.0`). `v` prefix allowed. |
| `notes` | no | Release notes, shown in the About card. Rendered as text. |
| `pub_date` / `publishedAt` | no | Displayed verbatim. |
| `platforms.<key>.url` | no | Per-platform download. Falls back to a top-level `url`. |
| `url` | no | Single download URL for all platforms. |

Platform keys: `windows-x86_64`, `windows-aarch64`, `darwin-x86_64`, `darwin-aarch64`,
`linux-x86_64`, `linux-aarch64`. Only the key matching the running build is used.

## Behaviour

1. `update_check` GETs the manifest (20 s timeout, `Kudo/<version> updater` user agent) and compares
   `version` with `CARGO_PKG_VERSION`.
2. `available` is true only when the manifest version is strictly newer. Nothing is installed
   automatically.
3. `update_download` fetches the platform URL (http/https only, 600 s timeout) into the OS temp dir
   (`<temp>/kudo-updates/<file name>`) and logs the request in the network panel.
4. `update_install` launches the file: `.msi` via `msiexec /i`, `.exe` directly, anything else via
   the Windows shell on Windows; `open` on macOS; `xdg-open` on Linux.
5. `update_reveal` selects the file in Explorer/Finder.

Kudo does not verify signatures. Publish the manifest over HTTPS, keep the download URL on the same
trusted origin, and never point the feed at untrusted input.
