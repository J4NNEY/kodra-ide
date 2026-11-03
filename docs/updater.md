# Update feed

Kodra checks a plain JSON manifest over HTTPS. Set the feed URL in **Settings → Integrations →
Update feed** (stored as `updateFeed` in `settings.json`). The About page exposes **Check**,
**Download**, **Install** and **Reveal**.

The feed is opt-in: Kodra never contacts it until you press **Check**, and nothing is installed
without a click on **Install**.

## Manifest

```json
{
  "version": "1.0.0",
  "notes": "Faster startup and a new network panel.",
  "pub_date": "2026-02-01T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/J4NNEY/kodra-ide/releases/download/v1.0.0/Kodra_1.0.0_x64-setup.exe",
      "sha256": "9f2c…64 hex characters…"
    }
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `version` | yes | Semver-ish string; compared numerically (`1.0.0 > 0.12.1`). `v` prefix and prerelease suffixes are accepted; a prerelease never outranks its release. |
| `notes` | no | Release notes, shown in the About card as plain text. |
| `pub_date` / `publishedAt` | no | Displayed verbatim. |
| `platforms.<key>.url` | yes* | Per-platform download. Falls back to a top-level `url`. |
| `platforms.<key>.sha256` | yes* | SHA-256 of the exact file at `url`. Falls back to a top-level `sha256`. **Downloads are refused without it.** |
| `url` | no | Single download URL for all platforms. |
| `sha256` | no | Single checksum for all platforms. |

Platform keys: `windows-x86_64`, `windows-aarch64`, `darwin-x86_64`, `darwin-aarch64`,
`linux-x86_64`, `linux-aarch64`. Only the key matching the running build is used.

\* At least one of the per-platform field and its top-level fallback must be present.

## Behaviour and limits

1. `update_check` GETs the manifest (20 s timeout, `Kodra/<version> updater` user agent) and compares
   `version` with the build version.
2. **HTTPS is required.** Plain `http` is accepted only for `localhost`, `127.0.0.1` and `::1`, so a
   local test feed keeps working. `file://`, `ftp://` and other schemes are rejected.
3. `available` is true only when the manifest version is strictly newer. Nothing installs by itself.
4. `update_download` requires a valid 64-character hex `sha256`. It:
   - fetches the platform URL (600 s timeout) and refuses responses over 300 MB;
   - reduces the file name to its final path component, so a manifest cannot write outside the
     update folder;
   - hashes the bytes and compares them with the manifest **before** writing anything;
   - writes only to `<OS temp>/kodra-updates/<file name>` and logs the request in the network panel.

   A checksum mismatch discards the download and reports both hashes.
5. `update_install` resolves the path again, refuses anything outside `<OS temp>/kodra-updates`, and
   only launches `.exe`/`.msi` on Windows (`.dmg`/`.pkg` on macOS). MSI files go through
   `msiexec /i`; everything else is started directly.
6. `update_reveal` selects the file in Explorer/Finder.

Kodra verifies the **checksum**, not a publisher signature: an attacker who controls the feed can
serve a different file with a matching hash. Publish `latest.json` over HTTPS on an origin you
control, and sign the installer so Windows can also verify the publisher.

## Publishing a release

`pnpm release:win` builds the app, hashes the installer and writes `release/latest.json` in the
format above. See [`releasing.md`](releasing.md) for the full checklist, hosting options and the
code-signing variables.
