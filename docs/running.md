# Cara menjalankan Kudo

Panduan langkah demi langkah untuk menjalankan project `sokudo-clone` di mesin lokal, baik sebagai
aplikasi desktop Tauri maupun sebagai preview browser.

- **Hasil akhir** yang diuji: Windows 11, Node 26.12.1, pnpm 9.15.0, Rust 1.96.0.
- **Versi project** saat dokumen ini ditulis: `0.9.0`.
- Semua perintah dijalankan dari folder project:

```powershell
cd C:\belajar\ReaProject\Gokuue\sokudo-clone
```

## 0. Ringkasan perintah

| Perintah | Yang terjadi | Butuh Rust? |
| --- | --- | --- |
| `pnpm install` | memasang dependency frontend | tidak |
| `pnpm dev` | preview browser di `http://localhost:3000`, backend dipalsukan (`app/lib/mock.ts`) | tidak |
| `pnpm desktop` | aplikasi Tauri asli, hot reload, backend Rust sungguhan | ya |
| `pnpm desktop:build` | build release + installer NSIS | ya |
| `pnpm build` | hanya frontend statis ke `.output/public` | tidak |
| `pnpm typecheck` | cek tipe TypeScript/Vue | tidak |

Untuk memakai semua fitur (folder asli, terminal, git, LSP, debugger, task, formatter), gunakan
**`pnpm desktop`**. Mode browser hanya untuk mengerjakan UI dengan cepat.

## 1. Prasyarat

### Wajib

| Kebutuhan | Versi | Catatan |
| --- | --- | --- |
| Node.js | 20+ (diuji 26.x) | `node -v` |
| pnpm | 9+ (diuji 9.15) | `corepack enable` atau `npm i -g pnpm` |
| Rust (rustup) | stable, 1.77+ (diuji 1.96) | `rustc --version` |
| Git | bebas | dipakai panel Source Control |
| WebView2 runtime | Evergreen | sudah ada di Windows 11 |

Compiler native sesuai OS:

- **Windows** - Visual Studio Build Tools 2022 dengan workload *Desktop development with C++*
  (menyertakan Windows 10/11 SDK dan `link.exe`). Rust target default: `x86_64-pc-windows-msvc`.
- **macOS** - `xcode-select --install`.
- **Linux** - `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`.

Cek cepat:

```powershell
node -v
pnpm -v
rustc --version
cargo --version
git --version
```

### Opsional (menyalakan fitur per bahasa)

Tidak wajib untuk membuka aplikasi; fitur tertentu hanya aktif kalau tool-nya ditemukan di `PATH`.

| Fitur | Tool |
| --- | --- |
| Go editor + test | Go (`gofmt` ikut terpasang) |
| Rust editor + test | `rustup component add rust-analyzer rustfmt` |
| Python editor + test | Python 3 + `pip install pyright ruff black` |
| TypeScript/JS editor | `npm i -g typescript typescript-language-server` |
| Debugger | `dlv` (Go), `codelldb` atau `lldb-dap` (Rust/C/C++) |
| Formatter/linter JS | `prettier`, `eslint` (bisa lokal di `node_modules` project) |

`Settings -> Editor` dan `Settings -> Language servers` menampilkan apa yang sudah terdeteksi.

## 2. Pasang dependency

```powershell
pnpm install
```

- Pakai **pnpm** saja; repo ini memakai `pnpm-lock.yaml`.
- Sekali saja per clone, kecuali `package.json` berubah.

## 3. Jalankan mode browser (`pnpm dev`)

```powershell
pnpm dev
```

Buka `http://localhost:3000`. Cocok untuk mengecek layout, tema, dan komponen tanpa compile Rust.

Yang perlu diketahui:

- Backend **dipalukan** oleh `app/lib/mock.ts`: workspace virtual, git palsu, terminal tidak nyata,
  file tidak benar-benar dibaca/ditulis.
- Hot reload berjalan; simpan file dan UI langsung berubah.
- Hentikan dengan `Ctrl+C`.

## 4. Jalankan aplikasi desktop (`pnpm desktop`)

```powershell
pnpm desktop
```

Perintah ini menjalankan `tauri dev`, yaitu:

1. `pnpm dev` di port 3000 (dikelola otomatis),
2. compile backend Rust mode debug,
3. membuka jendela **Kudo** yang memuat frontend tersebut.

- Compile pertama bisa 1-2 menit; berikutnya beberapa detik.
- Perubahan frontend = hot reload. Perubahan Rust = recompile otomatis lalu jendela restart.
- Saat jendela ditutup, terminal dev bisa menampilkan
  `error: process didn't exit successfully ... (exit code: 1)`. Itu normal.

## 5. Build installer Windows (`pnpm desktop:build`)

```powershell
pnpm desktop:build
```

Urutannya: `nuxt generate` -> `cargo build --release` -> paket NSIS. Build release pertama
sekitar 5-7 menit.

Hasil:

```
src-tauri/target/release/kudo.exe
src-tauri/target/release/bundle/nsis/Kudo_<versi>_x64-setup.exe   (~3 MB)
```

Varian lain:

- `pnpm build` - frontend statis saja ke `.output/public`.
- `pnpm preview` - menyajikan hasil `pnpm build` untuk pengecekan cepat.
- Installer hasil build **tidak** butuh Node/Rust di komputer tujuan, tapi tetap butuh WebView2.

## 6. Typecheck dan cek backend

```powershell
pnpm exec nuxt prepare    # hanya perlu setelah menambah composable/komponen baru
pnpm typecheck            # vue-tsc --noEmit
cd src-tauri
cargo check --no-default-features
```

Catatan:

- `pnpm exec nuxt prepare` membuat tipe auto-import (`.nuxt/`). Tanpa ini, composable baru bisa
  memunculkan error tipe palsu.
- Di PowerShell, `cargo check` kadang melaporkan `Exited with code 1` walaupun sukses. Patokannya
  adalah baris terakhir `Finished ... target(s) in ...`.

## 7. Toolchain opsional per bahasa

### Language server (LSP)

Dideteksi dari `PATH`:

| Bahasa | Server | Install |
| --- | --- | --- |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| TypeScript/JS | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `pip install pyright` |
| C/C++ | `clangd` | LLVM |
| Lua | `lua-language-server` | rilis resmi |
| Svelte | `svelte-language-server` | `npm i -g svelte-language-server` |
| JSON | `vscode-json-language-server` | `npm i -g vscode-langservers-extracted` |
| Shell | `bash-language-server` | `npm i -g bash-language-server` |

### Debug adapter (DAP)

| Bahasa | Adapter | Install |
| --- | --- | --- |
| Go | `dlv` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| Rust/C/C++ | `codelldb` | ekstensi CodeLLDB |
| Rust/C/C++ | `lldb-dap` | LLVM |

`Settings -> Debug` bisa menimpa perintah adapter secara manual.

### Formatter dan linter (0.9.0)

| Tool | Jenis | Bahasa | Install |
| --- | --- | --- | --- |
| Prettier | formatter | JS/TS/Vue, JSON, CSS, HTML, Markdown, YAML | `npm i -D prettier` |
| gofmt | formatter | Go | ikut Go |
| rustfmt | formatter | Rust | `rustup component add rustfmt` |
| Black | formatter | Python | `pip install black` |
| ESLint | linter | JS/TS/Vue | `npm i -D eslint` |
| Ruff | linter | Python | `pip install ruff` |

Install lokal di `node_modules` project selalu menang atas versi global. Format on save dan lint on
save **default mati**; nyalakan di `Settings -> Editor` atau lewat command palette (`Format: ...`).
`Shift+Alt+F` memformat file aktif tanpa menyimpan.

## 8. Lokasi data

| Data | Lokasi |
| --- | --- |
| Settings | `%APPDATA%\dev.kudo.desktop\settings.json` (Windows) |
| | `~/Library/Application Support/dev.kudo.desktop/settings.json` (macOS) |
| | `~/.config/dev.kudo.desktop/settings.json` (Linux) |
| Checkpoint agent | `<config dir>\checkpoints\<workspace-key>\` |
| Riwayat chat, session restore, layout | `localStorage` WebView (per workspace) |

Settings berisi tema, font, toggles `formatOnSave`/`lintOnSave`, daftar workspace terakhir, MCP
server, dan API key agent. Untuk mengembalikan ke default, tutup Kudo lalu hapus `settings.json`.

## 9. Debugging lewat CDP (opsional)

Berguna untuk otomasi/inspeksi UI:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
pnpm desktop
# jendela lain:
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/list
```

Di dalam WebView tersedia `window.__TAURI_INTERNALS__.invoke('<command>', args)`. Build dev juga
mengekspos `window.__kudoOpenFolder(path)` untuk membuka workspace tanpa dialog.

## 10. Troubleshooting

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `Another Nuxt dev server is already running (PID x)` | `pnpm dev`/`pnpm desktop` lain masih hidup | `taskkill /PID x /F`, atau `NUXT_IGNORE_LOCK=1` |
| `pnpm desktop:build` gagal di `beforeBuildCommand` | dev server masih memakai `.nuxt` | hentikan dev server dulu, lalu build ulang |
| Port 3000 dipakai aplikasi lain | port default | hentikan prosesnya, atau ubah `pnpm dev` + `devUrl` di `src-tauri/tauri.conf.json` |
| Error `#app-manifest` saat boot dev | Vite memproses import SSR-only sebelum virtual module Nuxt siap (hanya pada boot pertama saat `.nuxt` masih dingin) | Tidak berbahaya. Sudah dimatikan lewat `experimental.appManifest: false`; kalau muncul lagi, hapus `.nuxt` lalu jalankan ulang |
| `cargo`/`rustc` tidak dikenali | Rust belum terpasang / `PATH` lama | install rustup, buka terminal baru |
| `link.exe not found` | Build Tools C++ belum ada | install workload *Desktop development with C++* |
| Jendela putih di build release | `.output/public` kosong / rusak | jalankan `pnpm build` lalu `pnpm desktop:build` |
| WebView2 tidak ditemukan | runtime belum terpasang | install Microsoft Edge WebView2 Evergreen Runtime |
| HMR error setelah ganti versi | cache Nuxt basi | hapus `.nuxt` dan `.output`, jalankan ulang |
| Banyak warning `chunk larger than 500 kB` | bundle editor besar | normal, bukan kegagalan build |
| `process didn't exit successfully` saat tutup jendela | perilaku `tauri dev` | normal |

Kalau build terasa aneh, bersihkan total:

```powershell
Remove-Item -Recurse -Force .nuxt, .output
cd src-tauri; cargo clean; cd ..
pnpm install
```

## 11. Checklist cepat setelah aplikasi terbuka

1. `Kudo <versi>` tampil di status bar.
2. Buka folder lewat **Open Folder** (atau bagian *Recent*), pastikan judul jendela berganti nama
   folder.
3. Klik file di explorer, edit, `Ctrl+S` - titik dirty hilang.
4. `Ctrl+\`` membuka terminal dan mengetik `echo hi`.
5. `Ctrl+P` quick open file, `Ctrl+Shift+P` command palette.
6. `Settings -> Editor` menampilkan daftar language server / formatter yang terdeteksi.
7. Nyalakan **Format on save**, simpan file `.go` atau `.js` - muncul toast
   `Saved x.go - formatted with gofmt`.

## 12. Shortcut penting

| Shortcut | Fungsi |
| --- | --- |
| `Ctrl+P` | quick open file |
| `Ctrl+Shift+P` | command palette |
| `Ctrl+S` | simpan (format/lint sesuai setting) |
| `Shift+Alt+F` | format dokumen tanpa menyimpan |
| `Ctrl+Shift+F` | pencarian seluruh workspace |
| `Ctrl+Shift+G` | Source Control |
| `Ctrl+Shift+D` / `Ctrl+Shift+B` | Debugger / Tasks |
| `Ctrl+\`` | terminal |
| `Ctrl+\` | split editor |
| `Ctrl+,` | Settings |
| `F5`, `F9`, `F10`, `F11`, `Shift+F11`, `Shift+F5` | debug: start, breakpoint, step over, step in, step out, stop |
| `Ctrl+Alt+B` | jalankan default build task |

Dokumen lain: [`README.md`](../README.md) untuk ringkasan fitur dan arsitektur,
[`docs/updater.md`](updater.md) untuk update feed.
