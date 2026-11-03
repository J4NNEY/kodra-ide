# Third-party notices

Kodra is proprietary software (see [LICENSE](LICENSE)), but it is built with open-source components
that remain under their own licenses. Those licenses apply to the components themselves and prevail
over the Kodra license for that component.

The main components:

| Component | License |
| --- | --- |
| Tauri, `tauri-plugin-dialog`, `tauri-build` | MIT or Apache-2.0 |
| Nuxt, Vue, CodeMirror, xterm.js, Lucide | MIT |
| `reqwest`, `tokio`, `portable-pty`, `walkdir`, `notify`, `parking_lot`, `regex`, `serde` | MIT or Apache-2.0 |
| `rusqlite` / SQLite | MIT; SQLite is public domain |
| `sha2`, `uuid`, `base64` | MIT or Apache-2.0 |
| NSIS installer runtime | zlib/libpng |
| WebView2 runtime (Microsoft) | Microsoft software license terms |

A complete dependency tree with versions is available in `pnpm-lock.yaml`, `src-tauri/Cargo.lock` and
the generated bundle metadata. If you redistribute Kodra, keep this notice and the license texts that
ship with the bundled dependencies.

If you believe a component is listed incorrectly, open an issue on the Kodra repository.
