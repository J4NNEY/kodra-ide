# Privacy policy

Kodra is a local desktop IDE. It has **no telemetry, no analytics and no crash reporting**. The
maintainers do not receive any data about you or your projects.

## What Kodra stores on your machine

| Data | Location |
| --- | --- |
| Settings, including provider choice and API key | `%APPDATA%\app.kodra.desktop\settings.json` |
| Agent checkpoints (file snapshots) | `%APPDATA%\app.kodra.desktop\checkpoints\` |
| Installed extensions | `%APPDATA%\app.kodra.desktop\extensions\` |
| Chat history, session restore, layout, recent workspaces | WebView `localStorage` for the app |
| Canvas boards (one per workspace) | WebView `localStorage` for the app |

Deleting these folders removes the data. Uninstalling Kodra leaves them in place so a reinstall keeps
your setup.

On the first launch after the rename, Kodra copies settings, checkpoints and extensions from the old
`dev.kudo.desktop` folder. The old folder is not deleted.

## What leaves your machine

Kodra only makes network requests that a feature you use requires:

- **AI agent** — prompts, the selected files' contents and tool results are sent to the provider you
  configured (for example OpenAI, Anthropic or a self-hosted OpenAI-compatible endpoint), using your
  API key. That provider's privacy policy applies.
- **Update check** — when you press **Check**, Kodra requests the update manifest URL you configured.
- **MCP servers** — the servers you add may run local commands or contact their own services.
- **Browser preview** — pages you open load from their own origin and behave like any browser request.
- **Git** — fetch, pull, push and clone contact your configured remotes.
- **Language servers, debug adapters, formatters and linters** — these are local programs you install;
  some may download dependencies or contact vendor services on their own.

Kodra does not proxy these requests or add tracking.

## API keys

API keys are stored unencrypted in `settings.json`, readable by your Windows user account. They are
sent only to the provider endpoint configured in Settings. Use a scoped key and rotate it if the
machine is shared or compromised.

## Children

Kodra is a developer tool and is not directed at children.

## Changes

Material changes to this policy will be noted in `CHANGELOG.md` and in the repository history.

## Contact

Open an issue on the Kodra repository for privacy questions. For security reports, follow
[`SECURITY.md`](SECURITY.md).
