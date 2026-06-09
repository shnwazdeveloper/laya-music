# Laya Music

Laya Music is a desktop music player for Windows, macOS, and Linux. It is powered by YouTube Music search for song data and uses YouTube audio streams for playback.

This project is a rebranded and simplified fork of Nuclear, focused on a built-in YouTube Music experience instead of user-installed music provider plugins.

## Features

- Search songs with the YouTube Music API
- Stream audio from YouTube through the built-in playback engine
- View YouTube Music track titles, artists, albums, artwork, and duration
- Built-in YouTube Music dashboard content
- Import YouTube and YouTube Music playlists by URL
- Queue management with shuffle, repeat, and drag-and-drop reordering
- Favorites for albums, artists, and tracks
- Local playlists with JSON import and export
- Themes, logs, keyboard shortcuts, and desktop settings
- Default language: English

## Download

Windows builds are created with Tauri. After building, the installer and executable artifacts are written under:

```text
packages/player/src-tauri/target/release/bundle/
```

## Development

### Prerequisites

- Node.js 22 or newer
- pnpm
- Rust stable
- Tauri platform dependencies

### Install

```bash
pnpm install
```

### Run in development

```bash
pnpm dev
```

### Build the Windows app

```bash
pnpm --filter @nuclearplayer/player tauri build
```

## Repository

- GitHub: [shnwazdeveloper/laya-music](https://github.com/shnwazdeveloper/laya-music)
- Developer: [shnwazdeveloper](https://github.com/shnwazdeveloper)

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
