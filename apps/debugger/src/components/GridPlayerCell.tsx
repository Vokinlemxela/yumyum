'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { YumYumPlayer, QualityLevel } from '@yumyum-player/core';
import { hevcWasm } from '@yumyum-player/hevc-wasm';
import { proStreaming } from '@yumyum-player/pro-streaming';
import { Button, Spinner, Badge } from '@yumyums/ui';
import { Play, Pause, Volume2, VolumeX, X, Cpu, RefreshCw, Zap, Tv, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';

// Cache-bust HEVC-WASM assets per page load so dev rebuilds are never stale.
const ASSET_VERSION = Date.now();

interface GridPlayerCellProps {
  streamUrl: string;
  streamName: string;
  lang: 'ru' | 'en';
  index: number;
  isDenseGrid?: boolean;
  onClose: (index: number) => void;
  onTelemetryUpdate?: (cellIndex: number, data: TelemetryData | null) => void;
  telemetryActive?: boolean;
  /** Force the software (WASM) HEVC decoder instead of native. */
  forceSoftwareHevc?: boolean;
  /** Open this stream in the large theater player (with full YouTube-style controls). */
  onMaximize?: (index: number) => void;
}

interface TelemetryData {
  queueLength: number;
  droppedFrames: number;
  renderedFrames: number;
  playbackState: string;
  currentPTS: number;
  backpressureActive: boolean;
  activeCodec: string;
  bufferedEnd?: number;
  decodingStrategy: string;
}

const cellTranslations = {
  ru: {
    loading: 'ЗАГРУЗКА...',
    loadingRtsp: 'ПОДКЛЮЧЕНИЕ К RTSP КАМЕРЕ...',
    failed: 'СБОЙ ЗАПУСКА',
    software: 'WASM',
    hardware: 'GPU',
    retry: 'Перезагрузить',
    close: 'Закрыть',
  },
  en: {
    loading: 'LOADING...',
    loadingRtsp: 'CONNECTING TO RTSP...',
    failed: 'LOAD FAILED',
    software: 'WASM',
    hardware: 'GPU',
    retry: 'Retry',
    close: 'Close',
  }
};

export const GridPlayerCell = React.memo(({
  streamUrl,
  streamName,
  lang,
  index,
  isDenseGrid = false,
  onClose,
  onTelemetryUpdate,
  telemetryActive = false,
  forceSoftwareHevc = false,
  onMaximize
}: GridPlayerCellProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<YumYumPlayer | null>(null);
  const t = cellTranslations[lang];

  // Keep refs of telemetry callbacks to avoid re-triggering main playback effect on HUD toggles
  const telemetryActiveRef = useRef(telemetryActive);
  const onTelemetryUpdateRef = useRef(onTelemetryUpdate);

  useEffect(() => {
    telemetryActiveRef.current = telemetryActive;
  }, [telemetryActive]);

  useEffect(() => {
    onTelemetryUpdateRef.current = onTelemetryUpdate;
  }, [onTelemetryUpdate]);

  // States
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [playMode, setPlayMode] = useState<'ws' | 'hls'>(
    (streamUrl.startsWith('rtsp://') || streamUrl.startsWith('ws://') || streamUrl.startsWith('wss://')) ? 'ws' : 'hls'
  );

  const [isHovered, setIsHovered] = useState(false);
  const [debouncedHovered, setDebouncedHovered] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [activeQuality, setActiveQuality] = useState<string>('auto');
  const [isPinned, setIsPinned] = useState(false);
  const isAutomaticSwitching = useRef(false);

  const isLiveStream = streamUrl.startsWith('rtsp://') || streamUrl.startsWith('ws://') || streamUrl.startsWith('wss://');

  const [telemetry, setTelemetry] = useState<TelemetryData>({
    queueLength: 0,
    droppedFrames: 0,
    renderedFrames: 0,
    playbackState: 'IDLE',
    currentPTS: 0,
    backpressureActive: false,
    activeCodec: 'H.264',
    decodingStrategy: 'GPU',
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    let player: YumYumPlayer | null = null;
    let telemetryInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    const initStream = async () => {
      try {
        setIsConnecting(true);
        setIsBuffering(false);
        setHasError(false);

        let finalUrl = streamUrl;

        // On-demand RTSP packaging: request transcode or WS connection details from backend
        if (streamUrl.startsWith('rtsp://')) {
          if (playMode === 'ws') {
            // Low-latency WebSocket piping path: only probe the codec, do not start transcoding!
            const res = await fetch('/api/rtsp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'probe', rtspUrl: streamUrl }),
            });

            if (!isMounted) return;

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to probe RTSP camera on server');
            }

            const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '3005';
            finalUrl = `ws://${window.location.hostname}:${wsPort}/?url=${encodeURIComponent(streamUrl)}&codec=${data.codec}`;
          } else {
            // Standard HLS path: start full HLS transcoding on the server
            const res = await fetch('/api/rtsp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rtspUrl: streamUrl }),
            });

            if (!isMounted) return;

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to start RTSP transcode on server');
            }

            finalUrl = data.url;
            // Codec hint (query param, NOT a mock marker) so the player loads the
            // real HLS playlist and selects the right decoder.
            if (data.codec === 'h265' || data.codec === 'mjpeg') {
              finalUrl += (finalUrl.includes('?') ? '&' : '?') + 'codec=' + data.codec;
            }
          }
        }

        if (!isMounted) return;

        // Create isolated player instance in muted state by default.
        // forceSoftwareHevc (a prop driven by the UI toggle) routes HEVC through
        // the WASM decoder even when native HEVC is available.
        player = new YumYumPlayer({
          canvas: canvasRef.current!,
          volume: 0,
          muted: true,
          placeholderStyle: 'black',
          logLevel: 'warn',
          // Software HEVC plugin for browsers without native H.265 decoding.
          // The wasm assets are served from /public/hevc.
          plugins: [
            hevcWasm({
              // Off-main-thread decode worker (smooth HD); assets served from /public/hevc.
              // Cache-bust so a rebuilt wasm/worker is never served stale from the
              // browser's module cache during development.
              workerUrl: `/hevc/decode-worker.js?v=${ASSET_VERSION}`,
              glueUrl: `/hevc/hevc.js?v=${ASSET_VERSION}`,
            }),
            proStreaming(),
          ],
          forceSoftwareHevc,
        });

        playerRef.current = player;

        // Handle loading
        player.load(finalUrl)
          .then(() => {
            if (!isMounted || !player) return;
            setIsConnecting(false);
            setIsBuffering(false);

            if (player.getQualityLevels) {
              setQualityLevels(player.getQualityLevels());
            }
            if (player.getActiveQuality) {
              setActiveQuality(player.getActiveQuality());
            }

            player.on('qualitychange', (id) => {
              if (isMounted) {
                setActiveQuality(id as string);
                if (!isAutomaticSwitching.current) {
                  setIsPinned(id !== 'auto');
                }
              }
            });

            // Set initial quality based on grid density if not pinned
            if (!isPinned) {
              const targetQuality = (isDenseGrid && !debouncedHovered) ? 'sub' : 'main';
              isAutomaticSwitching.current = true;
              if (player.getQualityMode() === 'auto') {
                player.setMaxQualityKind(targetQuality === 'sub' ? 'sub' : null);
                isAutomaticSwitching.current = false;
              } else {
                player.setQuality?.(targetQuality)
                  .catch(() => {})
                  .finally(() => {
                    isAutomaticSwitching.current = false;
                  });
              }
            }

            // Only auto-play for live streams (WS / RTSP). VOD files from
            // gallery wait for the user to click the Play button explicitly.
            if (isLiveStream) {
              player.play()
                .then(() => {
                  if (isMounted) setIsPlaying(true);
                })
                .catch(() => {});
            }
          })
          .catch((err) => {
            if (!isMounted) return;
            console.error(`[GridPlayerCell] Failed to load stream:`, err);
            setHasError(true);
            setErrorMessage(err.message || 'Unknown error');
            setIsConnecting(false);
            setIsBuffering(false);
          });

        let lastRenderedFrames = 0;

        // Poll telemetry diagnostics
        const collectTelemetry = () => {
          if (player && isMounted) {
            const stats = player.getTelemetry();
            const telemetryData = stats as TelemetryData;
            setTelemetry(telemetryData);
            
            if (telemetryActiveRef.current && onTelemetryUpdateRef.current) {
              onTelemetryUpdateRef.current(index, telemetryData);
            }
            
            // Stall detection: if playing but rendered frames count did not increase since last tick AND queue is empty
            const hasStalled = stats.playbackState === 'PLAYING' && 
                               stats.renderedFrames === lastRenderedFrames && 
                               stats.queueLength === 0 && 
                               stats.activeCodec !== 'mjpeg';

            setIsBuffering(hasStalled);
            setIsPlaying(stats.playbackState === 'PLAYING');
            lastRenderedFrames = stats.renderedFrames;
          }
        };

        telemetryInterval = setInterval(collectTelemetry, 1000);

        // Listen for player-level errors
        player.on('error', (err: unknown) => {
          if (!isMounted) return;
          const msg = err instanceof Error ? err.message : 'Pipeline failure';
          console.error(`[GridPlayerCell] Player error:`, err);
          setHasError(true);
          setErrorMessage(msg);
        });

      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Init failed';
        setHasError(true);
        setErrorMessage(msg);
        setIsConnecting(false);
        setIsBuffering(false);
      }
    };

    initStream();

    // Cleanup on unmount or playMode switch
    return () => {
      isMounted = false;
      if (onTelemetryUpdateRef.current) {
        onTelemetryUpdateRef.current(index, null);
      }
      if (telemetryInterval) {
        clearInterval(telemetryInterval);
      }
      if (player) {
        try {
          player.destroy();
        } catch (e) {
          console.warn('[GridPlayerCell] Error destroying player:', e);
        }
      }
      playerRef.current = null;

      // Clean up server-side HLS RTSP process if it was active
      if (streamUrl.startsWith('rtsp://') && playMode === 'hls') {
        fetch('/api/rtsp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', rtspUrl: streamUrl }),
          keepalive: true,
        }).catch((e) => console.warn('[GridPlayerCell] Failed to stop RTSP stream on unmount:', e));
      }
    };
  }, [streamUrl, playMode, forceSoftwareHevc]);

  // Debounce hover changes: enter is instant, leave is delayed by 1500ms
  useEffect(() => {
    if (isHovered) {
      setDebouncedHovered(true);
    } else {
      const timer = setTimeout(() => {
        setDebouncedHovered(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isHovered]);

  // Automatic ABR quality density policy switching
  useEffect(() => {
    if (!playerRef.current) return;
    if (isPinned) return;

    const targetQuality = (isDenseGrid && !debouncedHovered) ? 'sub' : 'main';
    
    isAutomaticSwitching.current = true;
    if (playerRef.current.getQualityMode() === 'auto') {
      playerRef.current.setMaxQualityKind(targetQuality === 'sub' ? 'sub' : null);
      isAutomaticSwitching.current = false;
    } else {
      playerRef.current.setQuality?.(targetQuality)
        .catch(() => {})
        .finally(() => {
          isAutomaticSwitching.current = false;
        });
    }
  }, [isDenseGrid, debouncedHovered, isPinned]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!playerRef.current || hasError) return;

    if (isPlaying) {
      playerRef.current.pause();
      setIsPlaying(false);
    } else {
      playerRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!playerRef.current || hasError) return;

    const nextMute = !isMuted;
    setIsMuted(nextMute);
    playerRef.current.mute(nextMute);
    playerRef.current.setVolume(nextMute ? 0 : 0.8);

    if (!nextMute) {
      toast.info(`${streamName} unmuted`, { duration: 1500 });
    }
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(index);
  };

  const handleManualQualityChange = (id: string) => {
    setIsPinned(true);
    setActiveQuality(id);
    playerRef.current?.setQuality?.(id);
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative w-full h-full bg-black group rounded border border-border-elite overflow-hidden flex items-center justify-center aspect-video shadow-lg select-none"
    >
      
      {/* Target Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain aspect-video"
      />

      {/* Initial Connection Overlay */}
      {isConnecting && !hasError && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-2 pointer-events-none z-10">
          <Spinner />
          <span className="text-[9px] font-mono text-accent-primary font-bold tracking-widest animate-pulse">
            {streamUrl.startsWith('rtsp://') ? t.loadingRtsp : t.loading}
          </span>
        </div>
      )}

      {/* Subsequent Buffering / Stall Overlay (Minimalist Premium Badge) */}
      {!isConnecting && isBuffering && !hasError && (
        <div className="absolute top-2 right-2 flex items-center justify-center pointer-events-none z-10 bg-black/75 px-2 py-1 rounded border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]">
          <svg className="animate-spin h-3.5 w-3.5 text-accent-warning mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-[8px] font-mono text-accent-warning font-bold tracking-widest animate-pulse">
            BUFFERING
          </span>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4 text-center gap-3 z-20">
          <span className="text-accent-warning text-xs font-mono font-bold tracking-wider">{t.failed}</span>
          <p className="text-[9px] font-mono text-text-secondary line-clamp-3 leading-relaxed max-w-[90%]">
            {errorMessage}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleRetry}
              className="bg-surface hover:bg-surface-hover border border-border-elite text-[9px] font-mono font-bold text-white px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw size={10} />
              {t.retry}
            </Button>
            <Button
              onClick={() => onClose(index)}
              className="bg-accent-warning hover:bg-accent-warning/90 text-[9px] font-mono font-bold text-black px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
            >
              {t.close}
            </Button>
          </div>
        </div>
      )}

      {/* Futuristic Telemetry HUD (Micro Overlay) */}
      <div className="absolute top-2 left-2 flex gap-1.5 pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity z-10">
        <span className="bg-black/80 px-2 py-0.5 rounded text-[8px] font-mono font-bold text-white uppercase border border-border-elite">
          {streamName}
        </span>
        {(streamUrl.startsWith('rtsp://') || streamUrl.startsWith('ws://') || streamUrl.startsWith('wss://')) && (
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold border ${
            playMode === 'ws' 
              ? 'bg-accent-primary/20 text-accent-primary border-accent-primary/30' 
              : 'bg-accent-warning/20 text-accent-warning border-accent-warning/30'
          }`}>
            {playMode === 'ws' ? '⚡️ WS' : '📺 HLS'}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold border ${
          telemetry.decodingStrategy.includes('WASM') 
            ? 'bg-accent-warning/10 text-accent-warning border-accent-warning/20' 
            : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20'
        }`}>
          {telemetry.decodingStrategy.includes('WASM') ? t.software : t.hardware}
        </span>
        {telemetry.backpressureActive && (
          <span className="bg-accent-warning/20 text-accent-warning border border-accent-warning/40 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold tracking-widest animate-pulse">
            BP
          </span>
        )}
      </div>

      {/* Grid Cell Interactive Controls (Revealed on Hover) */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30">
        
        {/* Playback & Mode Controls */}
        <div className="flex items-center gap-2">
          <Button
            onClick={togglePlay}
            disabled={hasError}
            className="h-7 w-7 rounded bg-surface border border-border-elite flex items-center justify-center hover:bg-surface-hover hover:border-text-secondary/30 text-white cursor-pointer transition-colors"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          </Button>

          <Button
            onClick={toggleMute}
            disabled={hasError}
            active={!isMuted}
            className={`h-7 w-7 rounded border flex items-center justify-center cursor-pointer transition-all duration-200 ${
              isMuted 
                ? 'bg-surface border-border-elite text-text-secondary hover:bg-surface-hover' 
                : 'bg-accent-primary/10 border-accent-primary text-accent-primary shadow-[0_0_8px_rgba(0,255,102,0.1)]'
            }`}
          >
            {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </Button>

          {streamUrl.startsWith('rtsp://') && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setPlayMode(prev => prev === 'ws' ? 'hls' : 'ws');
                toast.info(playMode === 'ws' 
                  ? (lang === 'ru' ? 'Переключение в режим HLS (с буферизацией)...' : 'Switching to HLS mode (buffered)...')
                  : (lang === 'ru' ? 'Переключение в режим сверхнизкой задержки WS (в реальном времени)...' : 'Switching to ultra-low latency WebSocket mode (live)...'), 
                  { duration: 2000 }
                );
              }}
              title="Toggle play mode: WS ultra-low latency vs HLS standard transcode"
              className="h-7 px-2 rounded bg-surface border border-border-elite flex items-center gap-1.5 hover:bg-surface-hover hover:border-text-secondary/30 text-white text-[8px] font-mono font-bold cursor-pointer transition-all active:scale-95"
            >
              {playMode === 'ws' ? <Zap size={10} className="text-accent-primary" /> : <Tv size={10} className="text-accent-warning" />}
              <span>{playMode === 'ws' ? 'LOW LATENCY (WS)' : 'BUFFERED (HLS)'}</span>
            </Button>
          )}
          
          {qualityLevels.length > 0 && (
            <select
              value={activeQuality}
              onChange={(e) => handleManualQualityChange(e.target.value)}
              className="bg-surface text-white border border-border-elite rounded px-1.5 py-0.5 text-[8px] font-mono font-bold outline-none cursor-pointer hover:border-text-secondary/30 transition-colors h-7 leading-none"
              style={{ background: '#0a0a0a' }}
            >
              <option value="auto">AUTO</option>
              <option value="main">MAIN</option>
              <option value="sub">SUB</option>
              {qualityLevels.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.label.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Diagnostic Metadata */}
        <div className="hidden sm:flex flex-col text-[8px] font-mono text-text-secondary text-right pr-2">
          <span>FPS: {telemetry.playbackState === 'PLAYING' ? 30 : 0} | F: {telemetry.renderedFrames}</span>
          <span>Codec: {telemetry.activeCodec.toUpperCase()} | Q: {telemetry.queueLength}/30</span>
        </div>

        {/* Maximize → open theater player + Eject / Close */}
        <div className="flex items-center gap-1.5">
          {onMaximize && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onMaximize(index);
              }}
              title="Open in theater player"
              className="h-7 w-7 rounded bg-surface border border-border-elite hover:bg-surface-hover hover:border-text-secondary/30 text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              <Maximize2 size={12} />
            </Button>
          )}
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onClose(index);
            }}
            className="h-7 w-7 rounded bg-red-950/20 border border-red-500/20 hover:bg-red-500 hover:text-black hover:border-red-500 text-red-400 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X size={12} />
          </Button>
        </div>
      </div>

    </div>
  );
});
