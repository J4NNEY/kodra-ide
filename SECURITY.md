# Security policy

## Supported versions

Kodra 1.x receives security fixes. Pre-1.0 builds are unsupported.

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

Please report security issues privately through **GitHub Security Advisories** on the Kodra
repository (*Security → Report a vulnerability*). If advisories are unavailable, open a minimal issue
that asks for a private contact channel — do not include exploit details, secrets or user data in a
public issue.

Include:

- the Kodra version and Windows build (`Settings → About`);
- what an attacker can do and the conditions required;
- reproduction steps or a proof of concept;
- any relevant logs, with API keys and file paths removed.

You can expect an acknowledgement within 7 days and a status update within 30 days. Please give us a
reasonable window to ship a fix before public disclosure.

## Scope

In scope:

- the Rust backend and its Tauri commands (path sandboxing, command execution, updater);
- the Nuxt/CodeMirror frontend, including the CSP and IPC bridge;
- the installer, update feed handling and checksum verification;
- dependency vulnerabilities that are reachable from Kodra.

Out of scope:

- issues that require an already-compromised machine or a malicious local administrator;
- vulnerabilities in third-party language servers, debug adapters, MCP servers, AI providers or
  tools that Kodra launches on your behalf;
- the in-app browser rendering untrusted pages: it is a convenience preview, not a security boundary;
- SmartScreen warnings on unsigned builds.

## Security model

Kodra is a local desktop app. It has the same file and process access as your user account, so treat
any workspace you open as trusted input.

- File and shell tools used by the AI agent resolve paths through `resolve_in_workspace`, which
  rejects `..` traversal and symlinks that escape the workspace.
- Agent writes are checkpointed outside the project before they happen and require approval unless
  *Auto-approve* is enabled.
- Settings, chat history and the AI API key live in the local app-data folder in plain text. The key
  is never sent anywhere except the provider you configured.
- The update feed must use HTTPS (except localhost) and every download must match the SHA-256 in the
  manifest before it is written to disk. Installers are only launched from the update folder.
- Extensions are declarative (themes and snippets); manifest code is never executed.

See [`docs/updater.md`](docs/updater.md) for update-feed details and [`docs/releasing.md`](docs/releasing.md)
for the signing pipeline.
