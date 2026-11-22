# Changelog

English · [Русский](./CHANGELOG.ru.md)

## 1.1.1 — 2026-11-22

The core and all three plugins now include complete English and Russian documentation. English is the default.

## 1.1.0 — 2026-11-22

### Added

- WebRTC/WHEP, WebSocket/RTSP and software HEVC are available as free, open-source plugins. They can be used without license keys.
- The HEVC package includes a libde265 1.1.3 build, its source, third-party license notices and a rebuild script.

### Fixed

- HLS playback handles fMP4 segments with an `mdat` larger than 5 MiB, including segments received in chunks. A truncated segment no longer disrupts the next one. Buffering an incomplete `mdat` is limited to 64 MiB.

## 1.0.0 — 2026-06-29

First stable major release, with adaptive streaming, rendering improvements and stream recovery.

### Added

- **Adaptive streaming (ABR).** The player can switch between main and sub streams automatically, based on network throughput and decode performance, or manually.
- **Quality limits.** Applications can cap stream quality when several views share bandwidth and decoding resources.
- **Continuous playback.** The player reconnects after interruptions and recovers decoders without reloading the page.
- **A/V synchronization.** A monotonic clock tied to audio output time keeps video and audio in sync.
- **WebGL context pooling.** Inactive players can fall back to 2D rendering so larger video walls can share a limited number of WebGL2 contexts.
- **Player events.** `qualitychange` reports quality-level changes. `signals` reports signal loss, recovery and errors.
- **Telemetry.** `renderMode` reports the rendering path and `qualityMode` reports automatic or manual quality selection.
