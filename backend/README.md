# Rime Backend

The Rime backend is a small Go service that scans a read-only music folder,
indexes metadata in SQLite, exposes the native v1 API, and streams media with
HTTP range support.

Go 1.23 or newer is required. SQLite and metadata parsing are embedded in the
binary, so the direct-play path does not require CGO, a system database, or
FFmpeg. Transcoding is intentionally outside the first milestone.

## Run

```bash
mkdir -p music data
RIME_MUSIC_DIR="$PWD/music" RIME_DATA_DIR="$PWD/data" go run ./cmd/rime
```

The server listens on `127.0.0.1:8080` by default. Configuration is available
through environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `RIME_ADDRESS` | `127.0.0.1:8080` | HTTP listen address |
| `RIME_MUSIC_DIR` | `./music` | Read-only music library |
| `RIME_DATA_DIR` | `./data` | SQLite data directory |
| `RIME_LRCLIB_URL` | `https://lrclib.net` | LRCLIB-compatible lyrics provider |
| `RIME_SCAN_ON_STARTUP` | `true` | Scan the library before serving |

The native API contract is documented in `api/openapi/rime-v1.yaml`.

## First administrator

On an empty database, open the web app and register the first account. It becomes
the first administrator automatically. Public registration is permanently
disabled as soon as that account is created. Every account receives an
undeletable `我喜欢的音乐` playlist.

Administrators create subsequent accounts from **系统设置 → 用户管理**. New
accounts must replace their temporary password on first sign-in. If every web
session is lost, reset an existing administrator from standard input:

```sh
rime admin reset-password --username admin
```

The command revokes that user's sessions and requires the temporary password to
be changed at the next sign-in.

For frontend development, start this service first and then run `npm run dev`
from `frontend`. Vite proxies `/api` to the backend automatically.

## Runtime data

The music directory is treated as read-only. Embedded artwork is preferred,
then case-insensitive `cover`, `folder`, or `front` sidecars in JPEG, PNG, or
WebP format are used. Multi-disc folders also check their album parent.

Derived resources are stored below the data directory:

```text
data/
├── rime.db
├── cache/
│   └── artwork/
│       ├── original/
│       ├── 128/
│       ├── 256/
│       ├── 512/
│       └── 1024/
└── library/
    └── lyrics/
```

Artwork files are content-addressed and may be deleted safely; the next scan
rebuilds originals from the music library and thumbnails are generated on
demand. The lyrics directory is reserved for persistent downloaded or edited
lyrics and must not be managed as an evictable cache.

The `lyrics.scan` task resolves lyrics in this order:

1. `data/library/lyrics/<track-id>/manual.lrc` (also `.ttml` or `.txt`)
2. An `.lrc` or `.ttml` sidecar with the same basename as the audio file
3. Embedded synchronized or plain lyrics tags
4. A persisted LRCLIB result in `data/library/lyrics/<track-id>/lrclib.lrc`

Provider results are matched by normalized title, primary artist, and duration.
The source music directory remains read-only.
