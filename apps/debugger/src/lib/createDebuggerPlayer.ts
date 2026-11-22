import { YumYumPlayer } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';
import { proStreaming } from '@yumyum-player/pro-streaming';
import type { PlayerHandle } from '@yumyums/ui';

// Cache-bust HEVC-WASM assets per page load so dev rebuilds are never stale.
const ASSET_VERSION = Date.now();

export interface CreateDebuggerPlayerOptions {
  /** Route HEVC through the WASM software decoder even when native is available. */
  forceSoftwareHevc?: boolean;
  /** RTSP delivery: 'ws' (ultra-low latency, probe only) or 'hls' (server transcode). */
  rtspMode?: 'ws' | 'hls';
}

const isLiveUrl = (url: string) =>
  url.startsWith('rtsp://') || url.startsWith('ws://') || url.startsWith('wss://');

/**
 * Resolve a (possibly RTSP) stream URL to a directly-playable URL, mirroring the
 * grid cell's logic: WS mode only probes the codec, HLS mode starts a server
 * transcode and returns the playlist URL with a codec hint.
 */
async function resolveUrl(streamUrl: string, mode: 'ws' | 'hls'): Promise<string> {
  if (!streamUrl.startsWith('rtsp://')) return streamUrl;

  if (mode === 'ws') {
    const res = await fetch('/api/rtsp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'probe', rtspUrl: streamUrl }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to probe RTSP camera');
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '3005';
    return `ws://${window.location.hostname}:${wsPort}/?url=${encodeURIComponent(streamUrl)}&codec=${data.codec}`;
  }

  const res = await fetch('/api/rtsp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rtspUrl: streamUrl }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start RTSP transcode');
  let url = data.url as string;
  if (data.codec === 'h265' || data.codec === 'mjpeg') {
    url += (url.includes('?') ? '&' : '?') + 'codec=' + data.codec;
  }
  return url;
}

/**
 * Build a `createPlayer(canvas)` callback for {@link YumYumPlayerView}. The
 * returned player is created muted (the view re-applies persisted prefs) and
 * loaded before resolving. `cleanup` stops any server-side HLS transcode.
 */
export function makeCreatePlayer(streamUrl: string, opts: CreateDebuggerPlayerOptions = {}) {
  const mode = opts.rtspMode ?? 'ws';
  const live = isLiveUrl(streamUrl);

  const createPlayer = async (canvas: HTMLCanvasElement): Promise<{ player: PlayerHandle; isLive: boolean }> => {
    const finalUrl = await resolveUrl(streamUrl, mode);
    const player = new YumYumPlayer({
      canvas,
      volume: 0,
      muted: true,
      placeholderStyle: 'black',
      logLevel: 'warn',
      plugins: [
        hevcWasm({
          workerUrl: `/hevc/decode-worker.js?v=${ASSET_VERSION}`,
          glueUrl: `/hevc/hevc.js?v=${ASSET_VERSION}`,
        }),
        proStreaming(),
      ],
      forceSoftwareHevc: opts.forceSoftwareHevc ?? false,
    });
    await player.load(finalUrl);
    return { player: player as unknown as PlayerHandle, isLive: live };
  };

  const cleanup = () => {
    if (streamUrl.startsWith('rtsp://') && mode === 'hls') {
      fetch('/api/rtsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', rtspUrl: streamUrl }),
        keepalive: true,
      }).catch(() => {});
    }
  };

  return { createPlayer, cleanup, isLive: live };
}
