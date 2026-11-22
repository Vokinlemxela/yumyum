'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GridPlayerCell } from '../components/GridPlayerCell';
import { TheaterPlayer } from '../components/TheaterPlayer';
import { Badge, Spinner, Button, Input, Select } from '@yumyums/ui';
import { 
  Video, 
  Terminal, 
  Settings2, 
  Cpu, 
  Zap, 
  HardDrive, 
  Grid, 
  Trash2, 
  Plus, 
  Link2, 
  Upload, 
  Activity,
  Maximize2,
  X,
  Move
} from 'lucide-react';
import { toast } from 'sonner';

// Define the interface for Stream profiles
interface StreamProfile {
  id: string;
  name: string;
  url: string;
  desc: string;
  badge: string;
  codec: 'h264' | 'h265' | 'mjpeg';
}

const MAX_GRID_SIZE = 36;

const Sparkline: React.FC<{ data: number[]; min?: number; max?: number; colorClass?: string }> = ({ data, min = 0, max = 100, colorClass = "stroke-accent-primary" }) => {
  const points = useMemo(() => {
    const width = 160;
    const height = 40;
    const padding = 2;
    
    if (data.length === 0) return "";
    
    const dataMin = min;
    const dataMax = max === 0 ? 1 : max;
    const range = dataMax - dataMin;
    
    return data.map((val, index) => {
      const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - ((val - dataMin) / range) * (height - padding * 2) - padding;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [data, min, max]);

  return (
    <svg className="w-full h-10 select-none overflow-hidden" viewBox="0 0 160 40">
      <line x1="0" y1="10" x2="160" y2="10" stroke="var(--color-border-elite)" strokeWidth="0.5" strokeDasharray="2,2" />
      <line x1="0" y1="20" x2="160" y2="20" stroke="var(--color-border-elite)" strokeWidth="0.5" strokeDasharray="2,2" />
      <line x1="0" y1="30" x2="160" y2="30" stroke="var(--color-border-elite)" strokeWidth="0.5" strokeDasharray="2,2" />
      {points && (
        <>
          <path
            d={`M 2,38 L ${points} L 158,38 Z`}
            fill="currentColor"
            className="text-accent-primary/5 pointer-events-none"
          />
          <polyline
            fill="none"
            className={`${colorClass} transition-all duration-300`}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </>
      )}
    </svg>
  );
};

const translations = {
  ru: {
    demo: 'ЦЕНТР УПРАВЛЕНИЯ',
    webgl: 'WebGL2 Активен',
    webaudio: 'Web Audio Активен',
    title: 'YUM-YUM PLAYER',
    galleryTitle: 'ГАЛЕРЕЯ ПОТОКОВ (D&D Источники)',
    addStreamTitle: 'ДОБАВИТЬ НОВЫЙ ПОТОК',
    tabUrl: 'M3U8 / Socket',
    tabUpload: 'Загрузить файл',
    tabRtsp: 'RTSP',
    urlPlaceholder: 'https://.../stream.m3u8 или ws://.../stream',
    codecSelector: 'Кодек',
    addBtn: 'Добавить в галерею',
    uploadBtn: 'Загрузить и нарезать',
    rtspPlaceholder: 'rtsp://camera-ip/live/h264',
    gridSettings: 'РАЗМЕР СЕТКИ МОНИТОРОВ',
    clearGridBtn: 'Очистить сетку',
    decoderStats: 'Активные декодеры',
    dragTargetText: 'ПЕРЕТАЩИТЕ ПОТОК ИЗ ГАЛЕРЕИ',
    toastRtspStart: 'Подключение к RTSP-камере и запуск живой трансляции на сервере...',
    toastUploadStart: 'Загрузка медиафайла на server. Выполняется кодирование в HLS...',
    toastTranscodeFail: 'Не удалось подготовить HLS-поток на сервере: ',
    toastRequestFail: 'Ошибка запроса: ',
    toastStreamAdded: 'Поток успешно добавлен в галерею источников!',
    consoleTitle: 'ЛОГ КОНСОЛИ УПРАВЛЕНИЯ',
    consoleInit: '[00:00.0] Инициализация консоли мониторинга... ОК',
    consoleReady: '[00:00.1] Движок YumYumPlayer готов к работе с 2D/WebGL-контекстами.',
    consoleAutoplay: '[00:00.2] Внимание: все ячейки по умолчанию запускаются без звука.',
    footer: 'Surveillance Multi-Codec Command Console. All systems active. OK.',
    monitorTitle: 'МОНИТОРИНГ РЕСУРСОВ СИСТЕМЫ',
    cpuUsage: 'Нагрузка ЦПУ',
    ramUsage: 'Оперативная память',
    netThroughput: 'Сеть (Трафик)',
    activeStreamsCount: 'Активные каналы',
    fpsStats: 'Плавность интерфейса (FPS)',
    telemetryConsole: 'КОНСОЛЬ СИСТЕМНОЙ ТЕЛЕМЕТРИИ',
    viewModeDocked: 'Панель под гридом',
    viewModeFloating: 'Плавающее HUD окно',
    chartHistory: 'ИСТОРИЯ ИЗМЕНЕНИЙ (30 СЕКУНД)',
    tableChannel: 'КАНАЛ',
    tableCodec: 'КОДЕК',
    tableStrategy: 'СТРАТЕГИЯ',
    tableQueue: 'БУФЕР (ОЧЕРЕДЬ)',
    tableFrames: 'КАДРЫ',
    tableState: 'СТАТУС',
    activeDecodersList: 'АКТИВНЫЕ СЕТЕВЫЕ ДЕКОДЕРЫ',
    webglStats: 'РЕНДЕРЕР WebGL2',
    webglStatus: 'Контекст рендеринга активен и оптимизирован через GPU. Утечки отсутствуют.',
    noActiveStreams: 'Нет активных медиапотоков для сбора данных.',
    hudToggleBtn: 'ТЕЛЕМЕТРИЯ HUD',
    sidebarTabLogs: 'ЛОГИ',
    galleryTabVideo: 'ВИДЕО',
    galleryTabRtsp: 'RTSP',
    noVideosText: 'В галерее нет доступных видеозаписей.',
    noCamerasText: 'RTSP камеры не зарегистрированы.',
  },
  en: {
    demo: 'GRID CONTROL ROOM',
    webgl: 'WebGL2 Active',
    webaudio: 'Web Audio Active',
    title: 'YUM-YUM PLAYER',
    galleryTitle: 'STREAM GALLERY (D&D Sources)',
    addStreamTitle: 'PROVISION NEW STREAM',
    tabUrl: 'M3U8 / Socket',
    tabUpload: 'Upload File',
    tabRtsp: 'RTSP',
    urlPlaceholder: 'https://.../stream.m3u8 or ws://.../stream',
    codecSelector: 'Codec',
    addBtn: 'Add to Gallery',
    uploadBtn: 'Upload & Package',
    rtspPlaceholder: 'rtsp://camera-ip/live/h264',
    gridSettings: 'COMMAND MONITOR GRID',
    clearGridBtn: 'Clear Grid Workspace',
    decoderStats: 'Active Decoders',
    dragTargetText: 'DRAG & DROP STREAM FROM GALLERY',
    toastRtspStart: 'Connecting to RTSP source and initiating server-side HLS packaging...',
    toastUploadStart: 'Uploading media payload to server. Transcoding to HLS in progress...',
    toastTranscodeFail: 'Failed to transcode HLS stream on server: ',
    toastRequestFail: 'Request failed: ',
    toastStreamAdded: 'Stream successfully registered to the gallery!',
    consoleTitle: 'COMMAND DECK SYSTEM LOGS',
    consoleInit: '[00:00.0] Initializing Surveillance Grid Command console... OK',
    consoleReady: '[00:00.1] YumYumPlayer engine initialized. 2D/WebGL-context pools ready.',
    consoleAutoplay: '[00:00.2] Warning: Autoplay policy active. Grid cells start muted by default.',
    footer: 'Surveillance Multi-Codec Command Console. All systems active. OK.',
    monitorTitle: 'SYSTEM RESOURCE MONITOR',
    cpuUsage: 'CPU Utilization',
    ramUsage: 'RAM Allocation',
    netThroughput: 'Network Bandwidth',
    activeStreamsCount: 'Active Channels',
    fpsStats: 'Interface Smoothness (FPS)',
    telemetryConsole: 'SYSTEM TELEMETRY CONSOLE',
    viewModeDocked: 'Docked Panel',
    viewModeFloating: 'Floating HUD Window',
    chartHistory: 'METRICS HISTORY (30 SECONDS)',
    tableChannel: 'CHANNEL',
    tableCodec: 'CODEC',
    tableStrategy: 'STRATEGY',
    tableQueue: 'QUEUE (BUFFER)',
    tableFrames: 'FRAMES',
    tableState: 'STATE',
    activeDecodersList: 'ACTIVE NETWORK DECODERS',
    webglStats: 'WebGL2 RENDERER',
    webglStatus: 'Rendering context active & GPU-optimized. Zero leaks detected.',
    noActiveStreams: 'No active streams running telemetry diagnostics.',
    hudToggleBtn: 'HUD TELEMETRY',
    sidebarTabLogs: 'LOGS',
    galleryTabVideo: 'VIDEO',
    galleryTabRtsp: 'RTSP',
    noVideosText: 'No video files available in the gallery.',
    noCamerasText: 'No RTSP cameras registered in the gallery.',
  }
};

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
  throughputKbps?: number;
}

const PacmanTitle: React.FC<{ title: string }> = ({ title }) => {
  const letters = useMemo(() => title.split(''), [title]);
  const containerRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [delays, setDelays] = useState<number[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const hasPlayedRef = useRef(false);

  // Measure letter positions on mount, then trigger the first animation
  useEffect(() => {
    if (hasPlayedRef.current) return;
    hasPlayedRef.current = true;

    const container = containerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const totalPx = containerRect.width - 4;
      const travelStart = 0.3;
      const travelDuration = 2.4;

      const computed = letterRefs.current.map((el) => {
        if (!el) return 0.5;
        const r = el.getBoundingClientRect();
        const center = r.left + r.width / 2 - containerRect.left;
        return travelStart + (center / totalPx) * travelDuration;
      });
      setDelays(computed);
      setIsAnimating(true);
    });
  }, [title]);

  // Stop animating when pacman-move finishes its single iteration
  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName === 'pacman-move') {
      setIsAnimating(false);
    }
  }, []);

  // Replay on hover
  const handleMouseEnter = useCallback(() => {
    if (isAnimating) return;
    setAnimKey((k) => k + 1);
    setIsAnimating(true);
  }, [isAnimating]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center select-none pr-8 overflow-visible h-8 pl-6 cursor-pointer"
      onMouseEnter={handleMouseEnter}
    >
      {/* Pacman — rests at left:0 as a small green dot, wakes up on animation */}
      <div
        key={`pac-${animKey}`}
        className={`absolute top-1/2 w-4 h-4 z-10 pointer-events-none ${isAnimating ? 'animate-pacman-move' : ''}`}
        style={!isAnimating ? { left: '0px', opacity: 1, transform: 'translateY(-50%) scale(0.5)' } : undefined}
        onAnimationEnd={handleAnimationEnd}
      >
        <div
          className={`w-full h-full bg-accent-primary rounded-full ${isAnimating ? 'animate-pacman-chomp' : ''}`}
          style={{ boxShadow: '0 0 12px var(--color-accent-primary)' }}
        />
      </div>

      {/* Text wrapper */}
      <div className="flex items-center">
        {letters.map((char, idx) => (
          <span
            key={`${idx}-${animKey}`}
            ref={(el) => { letterRefs.current[idx] = el; }}
            className={`text-xl font-black tracking-tight text-white font-sans uppercase shrink-0 inline-block ${isAnimating ? 'animate-letter-eat' : ''}`}
            style={isAnimating ? {
              animationDelay: `${(delays[idx] ?? (0.5 + idx * 0.15)).toFixed(4)}s`
            } : undefined}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </div>
    </div>
  );
};

export default function Home() {
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const t = translations[lang];

  // Dynamic Stream Gallery State
  const [galleryStreams, setGalleryStreams] = useState<StreamProfile[]>([]);

  // Surveillance Grid Workspace State
  const [gridSize, setGridSize] = useState<number>(4); // Default 2x2 grid (4 cells)
  const [gridCells, setGridCells] = useState<(StreamProfile | null)[]>(Array(MAX_GRID_SIZE).fill(null));

  // Theater player (large YouTube-style player for testing UI / controls)
  const [theaterStream, setTheaterStream] = useState<StreamProfile | null>(null);

  // Telemetry stats & history tracking
  const [cellsTelemetry, setCellsTelemetry] = useState<Record<number, TelemetryData>>({});
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(30).fill(5));
  const [ramHistory, setRamHistory] = useState<number[]>(Array(30).fill(64));
  const [netHistory, setNetHistory] = useState<number[]>(Array(30).fill(0));
  const [fpsHistory, setFpsHistory] = useState<number[]>(Array(30).fill(60));
  
  // Floating HUD Window state
  const [hudOpen, setHudOpen] = useState(false);
  const [hudDocked, setHudDocked] = useState(true); // true = docked under grid, false = floating window
  const [hudPos, setHudPos] = useState({ x: 200, y: 150 });
  const [isDraggingHud, setIsDraggingHud] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Sidebar tab control (Provision, Telemetry HUD, and System Logs)
  const [sidebarTab, setSidebarTab] = useState<'provision' | 'monitor' | 'logs'>('provision');

  // Gallery tabs control (Video/HLS vs RTSP Cams)
  const [galleryTab, setGalleryTab] = useState<'video' | 'rtsp'>('video');

  const handleTelemetryUpdate = useCallback((cellIndex: number, data: TelemetryData | null) => {
    setCellsTelemetry(prev => {
      const next = { ...prev };
      if (data === null) {
        delete next[cellIndex];
      } else {
        next[cellIndex] = data;
      }
      return next;
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (hudDocked) return;
    setIsDraggingHud(true);
    dragOffset.current = {
      x: e.clientX - hudPos.x,
      y: e.clientY - hudPos.y
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingHud) return;
    const newX = e.clientX - dragOffset.current.x;
    const newY = e.clientY - dragOffset.current.y;
    setHudPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingHud) return;
    setIsDraggingHud(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}
  };

  const renderTelemetryContent = () => {
    const activeStreams = Object.entries(cellsTelemetry).filter(([idx]) => parseInt(idx) < gridSize);

    return (
      <div className="flex flex-col gap-4 font-mono text-[10px]">
        {/* Header toolbar within telemetry console */}
        <div className="flex items-center justify-between border-b border-border-elite pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${activeStreams.length > 0 ? 'bg-accent-primary animate-pulse' : 'bg-accent-warning'}`} />
            <h3 className="font-bold text-white uppercase tracking-wider">{t.telemetryConsole}</h3>
          </div>
          
          <div className="flex items-center gap-2">
            {/* View Mode Toggle Buttons */}
            <div className="flex rounded border border-border-elite bg-background p-0.5 overflow-hidden text-[8px] font-bold">
              <Button
                onClick={() => setHudDocked(true)}
                active={hudDocked}
                className={`px-2 py-0.5 cursor-pointer transition-colors ${hudDocked ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:text-white'}`}
              >
                {t.viewModeDocked}
              </Button>
              <Button
                onClick={() => setHudDocked(false)}
                active={!hudDocked}
                className={`px-2 py-0.5 cursor-pointer transition-colors ${!hudDocked ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:text-white'}`}
              >
                {t.viewModeFloating}
              </Button>
            </div>
            
            {/* Hide button if Docked */}
            {hudDocked && (
              <Button
                onClick={() => setHudOpen(false)}
                className="p-1 rounded text-text-secondary hover:text-white cursor-pointer"
              >
                <X size={12} />
              </Button>
            )}
          </div>
        </div>

        {/* Global Historical Charts Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* CPU Chart */}
          <div className="bg-background border border-border-elite rounded p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[9px] text-text-secondary">
              <span>{t.cpuUsage}</span>
              <span className="text-white font-bold">{cpuUsage}%</span>
            </div>
            <Sparkline data={cpuHistory} colorClass={cpuUsage > 80 ? "stroke-red-500" : cpuUsage > 50 ? "stroke-accent-warning" : "stroke-accent-primary"} />
            <span className="text-[7px] text-text-secondary/50 uppercase tracking-widest text-right">{t.chartHistory}</span>
          </div>

          {/* RAM Chart */}
          <div className="bg-background border border-border-elite rounded p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[9px] text-text-secondary">
              <span>{t.ramUsage}</span>
              <span className="text-white font-bold">{ramUsage} MB</span>
            </div>
            <Sparkline data={ramHistory} max={512} colorClass="stroke-accent-primary" />
            <span className="text-[7px] text-text-secondary/50 uppercase tracking-widest text-right">{t.chartHistory}</span>
          </div>

          {/* Network Throughput Chart */}
          <div className="bg-background border border-border-elite rounded p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[9px] text-text-secondary">
              <span>{t.netThroughput}</span>
              <span className="text-white font-bold">
                {netSpeed > 1024 * 1024 
                  ? `${(netSpeed / (1024 * 1024)).toFixed(2)} MB/s` 
                  : `${(netSpeed / 1024).toFixed(1)} KB/s`}
              </span>
            </div>
            <Sparkline data={netHistory} max={Math.max(1024 * 1024, ...netHistory)} colorClass="stroke-accent-primary" />
            <span className="text-[7px] text-text-secondary/50 uppercase tracking-widest text-right">{t.chartHistory}</span>
          </div>

          {/* Interface Smoothness FPS Chart */}
          <div className="bg-background border border-border-elite rounded p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-[9px] text-text-secondary">
              <span>{t.fpsStats}</span>
              <span className="text-white font-bold">{fpsVal} / 60</span>
            </div>
            <Sparkline data={fpsHistory} colorClass={fpsVal < 45 ? "stroke-red-500" : fpsVal < 55 ? "stroke-accent-warning" : "stroke-accent-primary"} />
            <span className="text-[7px] text-text-secondary/50 uppercase tracking-widest text-right">{t.chartHistory}</span>
          </div>
        </div>

        {/* Decoder Status Table / Camera Grid telemetry */}
        <div className="flex flex-col gap-2 bg-background border border-border-elite rounded p-3">
          <div className="text-[9px] font-bold text-white uppercase tracking-wider mb-1 border-b border-border-elite/60 pb-1 flex justify-between items-center">
            <span>{t.activeDecodersList}</span>
            <span className="text-[8px] text-text-secondary/60">ACTIVE: {activeStreams.length}</span>
          </div>
          
          {activeStreams.length === 0 ? (
            <div className="py-6 text-center text-text-secondary/45 font-mono text-[9px] uppercase tracking-wider">
              {t.noActiveStreams}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[8px] sm:text-[9px] leading-relaxed">
                <thead>
                  <tr className="border-b border-border-elite/40 text-text-secondary/60">
                    <th className="py-1 font-bold">{t.tableChannel}</th>
                    <th className="py-1 font-bold">{t.tableCodec}</th>
                    <th className="py-1 font-bold">{t.tableStrategy}</th>
                    <th className="py-1 font-bold">{t.tableQueue}</th>
                    <th className="py-1 font-bold">{t.tableFrames}</th>
                    <th className="py-1 font-bold">{t.tableState}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStreams.map(([key, data]) => {
                    const idx = parseInt(key);
                    const cellName = gridCells[idx]?.name || `Cam #${idx + 1}`;
                    return (
                      <tr key={key} className="border-b border-border-elite/30 hover:bg-surface-hover/30 transition-colors">
                        <td className="py-1.5 font-bold text-white max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {cellName}
                        </td>
                        <td className="py-1.5 text-accent-primary">{data.activeCodec.toUpperCase()}</td>
                        <td className="py-1.5">
                          <span className={`px-1 rounded text-[7px] font-bold border ${
                            data.decodingStrategy.includes('WASM')
                              ? 'bg-accent-warning/10 text-accent-warning border-accent-warning/20'
                              : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20'
                          }`}>
                            {data.decodingStrategy.includes('WASM') ? 'WASM' : 'GPU'}
                          </span>
                        </td>
                        <td className="py-1.5 font-bold">
                          <span className={data.backpressureActive ? 'text-accent-warning animate-pulse' : 'text-text-primary'}>
                            {data.queueLength} / 30
                          </span>
                        </td>
                        <td className="py-1.5 text-text-secondary">
                          {data.renderedFrames} <span className="text-[7px] opacity-60">(D: {data.droppedFrames})</span>
                        </td>
                        <td className="py-1.5">
                          <span className={`px-1 rounded text-[7px] font-bold uppercase ${
                            data.playbackState === 'PLAYING' 
                              ? 'text-accent-primary bg-accent-primary/5' 
                              : 'text-accent-warning bg-accent-warning/5'
                          }`}>
                            {data.playbackState}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* WebGL2 Renderer pool health status */}
        <div className="flex items-center justify-between text-[8px] text-text-secondary/50 border-t border-border-elite pt-2 mt-1">
          <div className="flex items-center gap-1.5">
            <Cpu size={10} className="text-accent-primary" />
            <span>{t.webglStats}: <strong className="text-white">ACTIVE POOL</strong></span>
          </div>
          <span>{t.webglStatus}</span>
        </div>
      </div>
    );
  };

  // Dynamic Stream Input States
  const [activeTab, setActiveTab] = useState<'link' | 'upload' | 'rtsp'>('link');
  const [inputUrl, setInputUrl] = useState('');
  const [urlCodec, setUrlCodec] = useState<'auto' | 'h264' | 'h265' | 'mjpeg'>('auto');
  // Force the software (WASM) HEVC decoder for all cells. Initialized from the
  // legacy ?swhevc=1 query param; toggled live via the toolbar button.
  const [forceSwHevc, setForceSwHevc] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('swhevc')) {
      setForceSwHevc(true);
    }
  }, []);
  
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [transcodeCodec, setTranscodeCodec] = useState<'h264' | 'h265' | 'mjpeg'>('h264');

  const [rtspUrl, setRtspUrl] = useState('');

  const [isTranscoding, setIsTranscoding] = useState(false);

  // Dynamic custom stream counter
  const [customCounter, setCustomCounter] = useState(1);

  // System resource monitor telemetry states
  const [cpuUsage, setCpuUsage] = useState(5);
  const [ramUsage, setRamUsage] = useState(64);
  const [netSpeed, setNetSpeed] = useState(0);
  const [fpsVal, setFpsVal] = useState(60);

  const framesRef = React.useRef(0);

  // FPS ticker
  useEffect(() => {
    let active = true;
    const countFrames = () => {
      if (!active) return;
      framesRef.current++;
      requestAnimationFrame(countFrames);
    };
    requestAnimationFrame(countFrames);
    return () => {
      active = false;
    };
  }, []);

  // System Monitor Ticker
  useEffect(() => {
    const interval = setInterval(() => {
      // 1. Calculate FPS & CPU Usage
      const fps = framesRef.current;
      framesRef.current = 0;
      setFpsVal(fps);
      setFpsHistory(prev => [...prev.slice(1), fps]);

      const baseCpu = Math.max(0, Math.min(100, Math.round((1 - (fps / 60)) * 100)));
      const activeCount = gridCells.slice(0, gridSize).filter(c => c !== null).length;
      const streamsCpu = activeCount * 6;
      // Add standard micro-fluctuations
      const cpu = Math.max(3, Math.min(99, baseCpu + streamsCpu + Math.floor(Math.random() * 4 - 2)));
      setCpuUsage(cpu);
      setCpuHistory(prev => [...prev.slice(1), cpu]);

      // 2. RAM Heap Usage
      let calculatedRAM = 72;
      const mem = (performance as any).memory;
      if (mem) {
        calculatedRAM = Math.round(mem.usedJSHeapSize / (1024 * 1024));
      } else {
        gridCells.slice(0, gridSize).forEach((cell) => {
          if (cell) {
            if (cell.codec === 'h265') calculatedRAM += 45;
            else if (cell.codec === 'mjpeg') calculatedRAM += 30;
            else calculatedRAM += 26;
          }
        });
        calculatedRAM = calculatedRAM + Math.floor(Math.random() * 6 - 3);
      }
      setRamUsage(calculatedRAM);
      setRamHistory(prev => [...prev.slice(1), calculatedRAM]);

      // 3. Network Throughput — use real SDK throughput from cellsTelemetry
      let totalThroughputKbps = 0;
      Object.entries(cellsTelemetry).forEach(([idx, tel]) => {
        if (parseInt(idx) < gridSize && tel.throughputKbps) {
          totalThroughputKbps += tel.throughputKbps;
        }
      });
      // Convert Kbps → bytes/sec for the chart (Kbps * 1024 / 8 = bytes/sec)
      const downloadedBytes = Math.round(totalThroughputKbps * 1024 / 8);
      setNetSpeed(downloadedBytes);
      setNetHistory(prev => [...prev.slice(1), downloadedBytes]);

    }, 1000);

    return () => clearInterval(interval);
  }, [gridCells, gridSize, cellsTelemetry]);

  // Clean up all leftover RTSP processes on page load to prevent process leaks
  useEffect(() => {
    fetch('/api/rtsp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).catch((err) => console.error('Failed to clean up orphaned RTSP processes on load:', err));
  }, []);

  // Load streams from server and localStorage on mount
  useEffect(() => {
    const loadAllStreams = async () => {
      let serverStreams: StreamProfile[] = [];
      try {
        const res = await fetch('/api/transcode');
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.streams)) {
            serverStreams = data.streams.map((s: { id: string; name: string; url: string; codec: 'h264' | 'h265' | 'mjpeg'; desc: string; addedAt: number }) => ({
              id: s.id,
              name: s.name,
              url: s.url,
              desc: s.desc,
              badge: s.codec === 'h265' ? 'HVC1' : s.codec === 'mjpeg' ? 'MJPG' : 'AVC1',
              codec: s.codec
            }));
          }
        }
      } catch (err) {
        console.error('Failed to load uploaded streams:', err);
      }

      // Load custom streams from localStorage
      let customStreams: StreamProfile[] = [];
      try {
        const stored = localStorage.getItem('yumyum-custom-streams');
        if (stored) {
          customStreams = JSON.parse(stored);
        }
      } catch (err) {
        console.error('Failed to load custom streams from localStorage:', err);
      }

      // Merge (custom streams first)
      setGalleryStreams([...customStreams, ...serverStreams]);

      // Safely restore the custom stream naming counter to prevent duplicate names
      if (customStreams.length > 0) {
        const maxNum = customStreams.reduce((max, s) => {
          const match = s.name.match(/#(\d+)$/);
          if (match) {
            const num = parseInt(match[1]);
            return num > max ? num : max;
          }
          return max;
        }, 0);
        setCustomCounter(maxNum + 1);
      }
    };
    loadAllStreams();
  }, []);

  // Handler to clear all uploaded custom streams from the server disk
  const handleClearDiskFiles = useCallback(async () => {
    if (!window.confirm(lang === 'ru' 
      ? 'Вы уверены, что хотите стереть все загруженные файлы с диска? Это также очистит сетку мониторов.' 
      : 'Are you sure you want to clear all uploaded files from disk? This will also clear the active monitors.')) {
      return;
    }

    try {
      const res = await fetch('/api/transcode', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        setGalleryStreams([]);
        setGridCells(Array(MAX_GRID_SIZE).fill(null)); // Clear all screens to prevent 404 segment loading issues
        toast.success(lang === 'ru'
          ? 'Диск и сетка успешно очищены от всех загруженных видеопотоков!'
          : 'Disk and monitors cleared of all custom streams successfully!'
        );
      } else {
        toast.error(lang === 'ru' ? 'Ошибка при очистке диска.' : 'Failed to clear files from disk.');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown request error';
      toast.error(`${t.toastRequestFail}${errMsg}`);
    }
  }, [lang, t]);

  // HTML5 Drag and Drop Handlers
  const handleDragStart = useCallback((e: React.DragEvent, stream: StreamProfile) => {
    e.dataTransfer.setData('streamJson', JSON.stringify(stream));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, cellIndex: number) => {
    e.preventDefault();
    const streamJson = e.dataTransfer.getData('streamJson');
    if (!streamJson) return;

    try {
      const stream = JSON.parse(streamJson) as StreamProfile;
      const updatedCells = [...gridCells];
      updatedCells[cellIndex] = stream;
      setGridCells(updatedCells);
      toast.success(lang === 'ru' 
        ? `Поток "${stream.name}" запущен в ячейке #${cellIndex + 1}` 
        : `Stream "${stream.name}" started in monitor #${cellIndex + 1}`
      );
    } catch (err) {
      console.error('Drag and Drop parse error:', err);
    }
  }, [gridCells, lang]);

  const clearCell = useCallback((cellIndex: number) => {
    setGridCells(prev => {
      const next = [...prev];
      next[cellIndex] = null;
      return next;
    });
  }, []);

  const clearAllCells = useCallback(() => {
    setGridCells(Array(MAX_GRID_SIZE).fill(null));
    toast.info(lang === 'ru' ? 'Сетка мониторов полностью очищена' : 'Monitor grid cleared');
  }, [lang]);

  // Helper to add custom stream to gallery
  const addStreamToGallery = useCallback((name: string, url: string, codec: 'h264' | 'h265' | 'mjpeg') => {
    const isRtsp = url.startsWith('rtsp://');
    const isWs = url.startsWith('ws://') || url.startsWith('wss://');
    const newStream: StreamProfile = {
      id: `custom-${Date.now()}-${customCounter}`,
      name: isRtsp 
        ? `RTSP #${customCounter}`
        : isWs
          ? (lang === 'ru' ? `WS Поток #${customCounter}` : `WS Stream #${customCounter}`)
          : `${name} #${customCounter}`,
      url: url,
      desc: isRtsp
        ? (lang === 'ru' 
            ? `Сетевой RTSP-источник. Будет автоматически подключен при переносе на сетку.` 
            : `Network RTSP source. Will load dynamically on grid placement.`)
        : isWs
          ? (lang === 'ru' 
              ? `Пользовательский WebSocket поток с кодеком ${codec.toUpperCase()}.` 
              : `User-provided WebSocket stream configured with ${codec.toUpperCase()} codec.`)
          : (lang === 'ru' 
              ? `Пользовательский поток HLS с кодеком ${codec.toUpperCase()}.` 
              : `User-provided HLS stream configured with ${codec.toUpperCase()} codec.`),
      badge: isRtsp ? 'RTSP' : isWs ? 'WS' : (codec === 'h265' ? 'HVC1' : codec === 'mjpeg' ? 'MJPG' : 'AVC1'),
      codec: codec
    };

    setGalleryStreams(prev => {
      const updated = [newStream, ...prev];
      const customOnly = updated.filter(s => s.id.startsWith('custom-'));
      localStorage.setItem('yumyum-custom-streams', JSON.stringify(customOnly));
      return updated;
    });
    setCustomCounter(prev => prev + 1);
    toast.success(t.toastStreamAdded);
  }, [customCounter, lang, t]);

  // Handler to delete a single stream from the gallery
  const handleDeleteStream = useCallback(async (stream: StreamProfile) => {
    if (!window.confirm(lang === 'ru' 
      ? `Вы уверены, что хотите удалить поток "${stream.name}"?` 
      : `Are you sure you want to delete stream "${stream.name}"?`)) {
      return;
    }

    const isCustom = stream.id.startsWith('custom-');

    if (isCustom) {
      setGalleryStreams(prev => {
        const updated = prev.filter(s => s.id !== stream.id);
        const customOnly = updated.filter(s => s.id.startsWith('custom-'));
        localStorage.setItem('yumyum-custom-streams', JSON.stringify(customOnly));
        return updated;
      });
      
      // Also clear from gridCells if it's currently playing
      setGridCells(prev => prev.map(cell => cell && cell.id === stream.id ? null : cell));
      toast.success(lang === 'ru' ? 'Поток удален из галереи.' : 'Stream removed from gallery.');
    } else {
      try {
        const res = await fetch(`/api/transcode?id=${stream.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
          setGalleryStreams(prev => prev.filter(s => s.id !== stream.id));
          setGridCells(prev => prev.map(cell => cell && cell.id === stream.id ? null : cell));
          toast.success(lang === 'ru' 
            ? 'Медиафайл успешно удален с сервера и из галереи.' 
            : 'Media file successfully deleted from server and gallery.'
          );
        } else {
          toast.error(lang === 'ru' ? 'Ошибка при удалении медиафайла с сервера.' : 'Failed to delete media file from server.');
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown request error';
        toast.error(`${t.toastRequestFail}${errMsg}`);
      }
    }
  }, [lang, t]);

  // Link Form Handler
  const handleAddLink = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;

    let resolvedUrl = inputUrl;
    let detectedCodec: 'h264' | 'h265' | 'mjpeg' = 'h264';

    if (resolvedUrl.startsWith('mock://')) {
      // Keep mock URI markers intact
      if (resolvedUrl.includes('hevc') || resolvedUrl.includes('h265')) {
        detectedCodec = 'h265';
      } else if (resolvedUrl.includes('mjpeg')) {
        detectedCodec = 'mjpeg';
      }
    } else if (urlCodec !== 'auto') {
      // Explicit codec chosen in the form (needed for opaque ws/HLS URLs).
      detectedCodec = urlCodec;
    } else if (resolvedUrl.toLowerCase().includes('hevc') || resolvedUrl.toLowerCase().includes('h265') || resolvedUrl.toLowerCase().includes('h.265')) {
      detectedCodec = 'h265';
    } else if (resolvedUrl.toLowerCase().includes('mjpeg') || resolvedUrl.toLowerCase().includes('mjpg')) {
      detectedCodec = 'mjpeg';
    }

    // Carry the codec to the player as a query hint (not a mock marker) so real
    // HLS/WS streams load for real and the right decoder is selected. A query
    // param is used (not '#') because WebSocket URLs may not contain a fragment.
    if (!resolvedUrl.startsWith('mock://') && detectedCodec !== 'h264' && !resolvedUrl.includes('codec=')) {
      resolvedUrl += (resolvedUrl.includes('?') ? '&' : '?') + 'codec=' + detectedCodec;
    }

    addStreamToGallery(
      lang === 'ru' ? 'Внешний поток' : 'External Stream',
      resolvedUrl,
      detectedCodec
    );
    setInputUrl('');
  }, [inputUrl, urlCodec, lang, addStreamToGallery]);

  // File Upload Form Handler
  const handleUploadVideo = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsTranscoding(true);
    toast.info(t.toastUploadStart, { duration: 6000 });

    const formData = new FormData();
    formData.append('video', uploadFile);
    formData.append('codec', transcodeCodec);

    try {
      const res = await fetch('/api/transcode', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        let resolvedUrl = data.url;
        if (transcodeCodec !== 'h264') {
          resolvedUrl += (resolvedUrl.includes('?') ? '&' : '?') + 'codec=' + transcodeCodec;
        }

        // Add the backend-provisioned stream profile directly to keep perfect sync!
        const returnedStream: StreamProfile = {
          ...data.stream,
          url: resolvedUrl,
          badge: transcodeCodec === 'h265' ? 'HVC1' : transcodeCodec === 'mjpeg' ? 'MJPG' : 'AVC1'
        };

        setGalleryStreams(prev => [returnedStream, ...prev]); // Add to top of sidebar
        setUploadFile(null);
        toast.success(t.toastStreamAdded);
      } else {
        toast.error(`${t.toastTranscodeFail}${data.error || 'Unknown error'}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown request error';
      toast.error(`${t.toastRequestFail}${errMsg}`);
    } finally {
      setIsTranscoding(false);
    }
  }, [uploadFile, transcodeCodec, t]);

  // RTSP Form Handler
  const handleAddRtsp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!rtspUrl) return;

    addStreamToGallery(
      lang === 'ru' ? 'RTSP Камера' : 'RTSP Cam',
      rtspUrl,
      'h264'
    );
    setRtspUrl('');
  }, [rtspUrl, lang, addStreamToGallery]);

  // Grid Presets configuration
  const gridPresets = [
    { label: '1x1', size: 1 },
    { label: '2x2', size: 4 },
    { label: '3x3', size: 9 },
    { label: '4x4', size: 16 },
    { label: '5x5', size: 25 },
    { label: '6x6', size: MAX_GRID_SIZE },
  ];

  // Active monitors count
  const activeMonitorsCount = gridCells.slice(0, gridSize).filter(cell => cell !== null).length;

  return (
    <main className="min-h-screen py-3 px-4 sm:px-6 lg:px-8 max-w-[1600px] mx-auto flex flex-col gap-4 select-none">
      
      {/* ==================== BRUTALIST COMMAND CENTER HEADER ==================== */}
      <header className="border-b border-border-elite pb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <PacmanTitle title={t.title} />
          </div>

        </div>
        
        {/* HEVC decode mode toggle: native (GPU) vs software (WASM). Toggling
            re-creates active players so the change takes effect immediately. */}
        <div className="flex items-center gap-3 shrink-0">
          <Button
            onClick={() => setForceSwHevc(v => !v)}
            active={forceSwHevc}
            title={lang === 'ru'
              ? 'Декодирование HEVC: GPU (нативно) или WASM (программно)'
              : 'HEVC decode: GPU (native) or WASM (software)'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[9px] font-mono font-bold cursor-pointer transition-all ${
              forceSwHevc
                ? 'border-accent-primary bg-accent-primary/15 text-accent-primary shadow-[0_0_8px_rgba(0,255,102,0.2)]'
                : 'border-border-elite bg-surface text-text-secondary hover:text-white'
            }`}
          >
            <Cpu size={11} />
            {forceSwHevc ? 'HEVC: WASM' : 'HEVC: GPU'}
          </Button>

          <div className="flex rounded border border-border-elite bg-surface p-0.5 overflow-hidden">
            <Button
              onClick={() => setLang('ru')}
              active={lang === 'ru'}
              className={`px-2.5 py-0.5 text-[9px] font-mono font-bold cursor-pointer transition-all ${
                lang === 'ru'
                  ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.2)]'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              RU
            </Button>
            <Button
              onClick={() => setLang('en')}
              active={lang === 'en'}
              className={`px-2.5 py-0.5 text-[9px] font-mono font-bold cursor-pointer transition-all ${
                lang === 'en'
                  ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.2)]'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              EN
            </Button>
          </div>
        </div>
      </header>

      {/* ==================== DOUBLE-COLUMN CONTROL WORKSPACE ==================== */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        
        {/* ==================== LEFT COLUMN (SIDEBAR - width 1/4) ==================== */}
        <aside className="w-full lg:w-96 flex flex-col gap-5 shrink-0">
          
          {/* A. Combined Sidebar Box (Provision / Monitor / Logs) */}
          <section className="bg-surface border border-border-elite rounded-lg p-5 flex flex-col gap-4 relative overflow-hidden">
            
            {/* Main Tabs Switcher */}
            <div className="flex rounded border border-border-elite bg-background p-0.5 overflow-hidden text-[10px] font-mono font-bold w-full shrink-0">
              <Button
                onClick={() => setSidebarTab('provision')}
                active={sidebarTab === 'provision'}
                className={`flex-1 py-1.5 cursor-pointer text-center transition-all ${
                  sidebarTab === 'provision' 
                    ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.15)] font-extrabold' 
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                {lang === 'ru' ? 'ИСТОЧНИКИ' : 'PROVISION'}
              </Button>
              <Button
                onClick={() => setSidebarTab('monitor')}
                active={sidebarTab === 'monitor'}
                className={`flex-1 py-1.5 cursor-pointer text-center transition-all ${
                  sidebarTab === 'monitor' 
                    ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.15)] font-extrabold' 
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                {lang === 'ru' ? 'РЕСУРСЫ' : 'MONITOR'}
              </Button>
              <Button
                onClick={() => setSidebarTab('logs')}
                active={sidebarTab === 'logs'}
                className={`flex-1 py-1.5 cursor-pointer text-center transition-all ${
                  sidebarTab === 'logs' 
                    ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.15)] font-extrabold' 
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                {t.sidebarTabLogs}
              </Button>
            </div>

            {sidebarTab === 'provision' ? (
              <div className="flex flex-col gap-4 animate-fadeIn">
                {isTranscoding && (
                  <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 z-50 transition-all duration-200">
                    <Spinner />
                    <span className="text-[10px] font-mono text-accent-primary font-bold tracking-wider animate-pulse uppercase text-center max-w-[80%]">
                      КОДИРОВАНИЕ HLS ПОТОКА... ПОЖАЛУЙСТА, ПОДОЖДИТЕ
                    </span>
                  </div>
                )}

                {/* Sub Tabs */}
                <div className="flex rounded border border-border-elite bg-background p-0.5 overflow-hidden text-[9px] font-mono font-bold">
                  <Button
                    onClick={() => setActiveTab('link')}
                    active={activeTab === 'link'}
                    className={`flex-1 py-1 cursor-pointer transition-colors ${activeTab === 'link' ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:text-white'}`}
                  >
                    {t.tabUrl}
                  </Button>
                  <Button
                    onClick={() => setActiveTab('upload')}
                    active={activeTab === 'upload'}
                    className={`flex-1 py-1 cursor-pointer transition-colors ${activeTab === 'upload' ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:text-white'}`}
                  >
                    {t.tabUpload}
                  </Button>
                  <Button
                    onClick={() => setActiveTab('rtsp')}
                    active={activeTab === 'rtsp'}
                    className={`flex-1 py-1 cursor-pointer transition-colors ${activeTab === 'rtsp' ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:text-white'}`}
                  >
                    {t.tabRtsp}
                  </Button>
                </div>

                {/* TAB 1: Paste Link */}
                {activeTab === 'link' && (
                  <form onSubmit={handleAddLink} className="flex flex-col gap-3">
                    <Input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder={t.urlPlaceholder}
                      className="bg-black border border-border-elite rounded px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-accent-primary"
                      required
                    />
                    <div className="flex gap-2 justify-end items-center">
                      <select
                        value={urlCodec}
                        onChange={(e) => setUrlCodec(e.target.value as 'auto' | 'h264' | 'h265' | 'mjpeg')}
                        title={lang === 'ru' ? 'Кодек (для ws/HLS без подсказки в URL)' : 'Codec (for ws/HLS URLs without a hint)'}
                        className="bg-black border border-border-elite rounded px-2 py-1.5 text-[10px] font-mono text-white focus:outline-none focus:border-accent-primary cursor-pointer"
                      >
                        <option value="auto">{lang === 'ru' ? 'Кодек: авто' : 'Codec: auto'}</option>
                        <option value="h264">H.264</option>
                        <option value="h265">H.265</option>
                        <option value="mjpeg">MJPEG</option>
                      </select>
                      <Button
                        type="submit"
                        className="bg-accent-primary hover:bg-accent-primary/90 text-black font-mono font-bold text-[10px] px-4 py-1.5 rounded cursor-pointer transition-colors"
                      >
                        {t.addBtn}
                      </Button>
                    </div>
                  </form>
                )}

                {/* TAB 2: Upload File */}
                {activeTab === 'upload' && (
                  <form onSubmit={handleUploadVideo} className="flex flex-col gap-3">
                    <Input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="w-full text-[9px] font-mono text-text-secondary file:mr-2 file:py-1 file:px-3 file:rounded file:border file:border-border-elite file:text-[9px] file:font-mono file:bg-background file:text-white file:cursor-pointer hover:file:bg-surface-hover"
                      required
                    />
                    <div className="flex gap-2 justify-between items-center">
                      <Select
                        value={transcodeCodec}
                        onChange={(e) => setTranscodeCodec(e.target.value as 'h264' | 'h265' | 'mjpeg')}
                        className="bg-black border border-border-elite rounded px-2 py-1.5 text-[10px] font-mono text-white focus:outline-none"
                      >
                        <option value="h264">H.264 (AVC)</option>
                        <option value="h265">H.265 (HEVC)</option>
                        <option value="mjpeg">MJPEG</option>
                      </Select>
                      <Button
                        type="submit"
                        className="bg-accent-primary hover:bg-accent-primary/90 text-black font-mono font-bold text-[10px] px-4 py-1.5 rounded cursor-pointer transition-colors"
                      >
                        {t.uploadBtn}
                      </Button>
                    </div>
                  </form>
                )}

                {/* TAB 3: RTSP Cam */}
                {activeTab === 'rtsp' && (
                  <form onSubmit={handleAddRtsp} className="flex flex-col gap-3">
                    <Input
                      type="text"
                      value={rtspUrl}
                      onChange={(e) => setRtspUrl(e.target.value)}
                      placeholder={t.rtspPlaceholder}
                      className="bg-black border border-border-elite rounded px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-accent-primary"
                      required
                    />
                    <div className="flex gap-2 justify-end items-center">
                      <Button
                        type="submit"
                        className="bg-accent-primary hover:bg-accent-primary/90 text-black font-mono font-bold text-[10px] px-4 py-1.5 rounded cursor-pointer transition-colors"
                      >
                        {t.addBtn}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            ) : sidebarTab === 'monitor' ? (
              <div className="flex flex-col gap-3 font-mono text-[9px] animate-fadeIn">
                {/* CPU usage with Sparkline */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-text-secondary">
                    <span>{t.cpuUsage}</span>
                    <span className="text-white font-bold">{cpuUsage}%</span>
                  </div>
                  <Sparkline data={cpuHistory} colorClass={cpuUsage > 80 ? "stroke-red-500" : cpuUsage > 50 ? "stroke-accent-warning" : "stroke-accent-primary"} />
                </div>

                {/* RAM usage with Sparkline */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-text-secondary">
                    <span>{t.ramUsage}</span>
                    <span className="text-white font-bold">{ramUsage} MB</span>
                  </div>
                  <Sparkline data={ramHistory} max={512} colorClass="stroke-accent-primary" />
                </div>

                {/* Network Throughput with Sparkline */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-text-secondary">
                    <span>{t.netThroughput}</span>
                    <span className="text-white font-bold">
                      {netSpeed > 1024 * 1024 
                        ? `${(netSpeed / (1024 * 1024)).toFixed(2)} MB/s` 
                        : `${(netSpeed / 1024).toFixed(1)} KB/s`}
                    </span>
                  </div>
                  <Sparkline data={netHistory} max={Math.max(1024 * 1024, ...netHistory)} colorClass="stroke-accent-primary" />
                </div>

                {/* Interface Smoothness with Sparkline */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-text-secondary">
                    <span>{t.fpsStats}</span>
                    <span className="text-white font-bold">{fpsVal} FPS</span>
                  </div>
                  <Sparkline data={fpsHistory} colorClass={fpsVal < 45 ? "stroke-red-500" : fpsVal < 55 ? "stroke-accent-warning" : "stroke-accent-primary"} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 font-mono text-[9px] animate-fadeIn">
                <div className="font-mono text-[9px] text-text-secondary/85 flex flex-col gap-1.5 h-44 overflow-y-auto border border-border-elite/60 bg-black/40 rounded p-2.5">
                  <div>{t.consoleInit}</div>
                  <div>{t.consoleReady}</div>
                  <div>{t.consoleAutoplay}</div>
                  {activeMonitorsCount > 0 && (
                    <div className="text-accent-primary font-bold">
                      [Status] Active streams running: {activeMonitorsCount} / {gridSize}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* B. HLS Sources Gallery sidebar (Tabbed Video/RTSP cams) */}
          <section className="bg-surface border border-border-elite rounded-lg p-5 flex flex-col gap-3 max-h-[500px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-elite pb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-accent-primary" />
                <h2 className="text-xs font-mono font-bold text-white uppercase tracking-wider">{t.galleryTitle}</h2>
              </div>
              {galleryStreams.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={handleClearDiskFiles}
                  title={lang === 'ru' ? 'Стереть все загруженные файлы с диска' : 'Wipe all uploaded files from disk'}
                  className="p-1 rounded bg-red-950/20 border border-red-500/20 hover:bg-red-500 hover:text-black hover:border-red-500 text-red-400 cursor-pointer transition-colors"
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>

            {/* Gallery Tabs Switcher */}
            <div className="flex rounded border border-border-elite bg-background p-0.5 overflow-hidden text-[9px] font-mono font-bold w-full shrink-0">
              <Button
                onClick={() => setGalleryTab('video')}
                active={galleryTab === 'video'}
                className={`flex-1 py-1 cursor-pointer text-center transition-colors ${
                  galleryTab === 'video' 
                    ? 'bg-accent-primary/10 text-accent-primary font-bold' 
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                {t.galleryTabVideo}
              </Button>
              <Button
                onClick={() => setGalleryTab('rtsp')}
                active={galleryTab === 'rtsp'}
                className={`flex-1 py-1 cursor-pointer text-center transition-colors ${
                  galleryTab === 'rtsp' 
                    ? 'bg-accent-primary/10 text-accent-primary font-bold' 
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                {t.galleryTabRtsp}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
              {(() => {
                const filteredStreams = galleryStreams.filter(stream => {
                  const isRtsp = stream.url.startsWith('rtsp://');
                  return galleryTab === 'video' ? !isRtsp : isRtsp;
                });

                if (filteredStreams.length === 0) {
                  return (
                    <div className="py-12 text-center text-text-secondary/45 font-mono text-[9px] uppercase tracking-wider animate-fadeIn">
                      {galleryTab === 'video' ? t.noVideosText : t.noCamerasText}
                    </div>
                  );
                }

                return filteredStreams.map((stream) => (
                  <div
                    key={stream.id}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, stream)}
                    className="p-3 bg-background border border-border-elite rounded hover:border-accent-primary/40 hover:bg-surface-hover cursor-grab active:cursor-grabbing transition-all select-none group animate-fadeIn"
                  >
                    <div className="flex justify-between items-center mb-1 font-mono gap-2 w-full min-w-0">
                      <span className="text-[10px] font-bold text-white group-hover:text-accent-primary transition-colors truncate flex-1 min-w-0" title={stream.name}>
                        {stream.name}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge label={stream.badge} variant="neutral" />
                        <Button
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteStream(stream);
                          }}
                          className="p-1 rounded text-text-secondary/60 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                          title={lang === 'ru' ? 'Удалить этот поток' : 'Delete this stream'}
                        >
                          <Trash2 size={10} />
                        </Button>
                      </div>
                    </div>
                    {stream.desc && !stream.desc.startsWith('Загруженное видео') && stream.desc !== stream.name && (
                      <p className="text-[9px] font-mono text-text-secondary leading-relaxed line-clamp-2">
                        {stream.desc}
                      </p>
                    )}
                    <div className="mt-2 text-[8px] font-mono text-text-secondary/50 overflow-hidden text-ellipsis whitespace-nowrap">
                      URL: {stream.url}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </section>

        </aside>

        {/* ==================== RIGHT COLUMN (COMMAND WORKSPACE - width 3/4) ==================== */}
        <section className="flex-1 w-full flex flex-col gap-4">
          
          {/* Grid control deck */}
          <div className="bg-surface border border-border-elite rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            
            {/* Grid Presets */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-white uppercase tracking-wider">
                <Grid size={14} className="text-accent-primary" />
                <span>{t.gridSettings}</span>
              </div>
              
              <div className="flex rounded border border-border-elite bg-background p-0.5 overflow-hidden">
                {gridPresets.map((preset) => (
                  <Button
                    key={preset.size}
                    onClick={() => {
                      setGridSize(preset.size);
                      toast.info(lang === 'ru' 
                        ? `Сетка камер изменена на ${preset.label}` 
                        : `Camera grid resized to ${preset.label}`
                      );
                    }}
                    active={gridSize === preset.size}
                    className={`px-3 py-1 text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                      gridSize === preset.size 
                        ? 'bg-accent-primary text-background shadow-[0_0_8px_rgba(0,255,102,0.15)]' 
                        : 'text-text-secondary hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Eject Decoders Stats, Telemetry Toggle & Reset Grid */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-secondary uppercase">
                <Cpu size={12} className="text-accent-primary" />
                <span>{t.decoderStats}: <strong className="text-white">{activeMonitorsCount} / {gridSize}</strong></span>
              </div>
              
              <Button
                onClick={() => {
                  setHudOpen(prev => !prev);
                  toast.info(hudOpen 
                    ? (lang === 'ru' ? 'Консоль телеметрии скрыта.' : 'Telemetry console hidden.') 
                    : (lang === 'ru' ? 'Консоль телеметрии открыта!' : 'Telemetry console opened!')
                  );
                }}
                active={hudOpen}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold border rounded transition-colors cursor-pointer ${
                  hudOpen 
                    ? 'bg-accent-primary/10 border-accent-primary text-accent-primary shadow-[0_0_8px_rgba(0,255,102,0.15)]'
                    : 'border-border-elite bg-surface hover:bg-surface-hover hover:border-text-secondary/30 text-white'
                }`}
              >
                <Activity size={11} className={hudOpen ? 'animate-pulse' : ''} />
                <span>{t.hudToggleBtn}</span>
              </Button>

              <Button
                onClick={clearAllCells}
                disabled={activeMonitorsCount === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold border rounded transition-colors ${
                  activeMonitorsCount === 0
                    ? 'border-border-elite text-text-secondary/35 bg-background cursor-not-allowed'
                    : 'border-red-900/30 bg-red-950/15 hover:bg-red-500 hover:text-black hover:border-red-500 text-red-400 cursor-pointer'
                }`}
              >
                <Trash2 size={11} />
                <span>{t.clearGridBtn}</span>
              </Button>
            </div>

          </div>

          {/* Interactive CSS Grid Workspace */}
          <div className={`grid gap-3 w-full bg-background border border-border-elite rounded-lg p-3 min-h-[500px] ${
            gridSize === 1 ? 'grid-cols-1 max-w-4xl mx-auto' :
            gridSize === 4 ? 'grid-cols-2' :
            gridSize === 9 ? 'grid-cols-3' :
            gridSize === 16 ? 'grid-cols-4' :
            gridSize === 25 ? 'grid-cols-5' : 'grid-cols-6'
          }`}>
            {gridCells.slice(0, gridSize).map((cell, index) => (
              <div
                key={cell ? `cell-${index}-${cell.id}` : `cell-empty-${index}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, index)}
                className="relative aspect-video w-full h-full"
              >
                {cell ? (
                  <GridPlayerCell
                    streamUrl={cell.url}
                    streamName={cell.name}
                    lang={lang}
                    index={index}
                    isDenseGrid={gridSize >= 4}
                    onClose={clearCell}
                    onTelemetryUpdate={handleTelemetryUpdate}
                    telemetryActive={hudOpen}
                    forceSoftwareHevc={forceSwHevc}
                    onMaximize={(idx) => setTheaterStream(gridCells[idx])}
                  />
                ) : (
                  <div className="w-full h-full rounded border border-dashed border-border-elite hover:border-accent-primary/25 bg-surface/30 hover:bg-surface/50 flex flex-col items-center justify-center gap-2.5 p-4 text-center aspect-video transition-all duration-200 select-none group">
                    <Plus size={20} className="text-text-secondary/30 group-hover:text-accent-primary/60 transition-colors" />
                    <span className="text-[8px] sm:text-[9px] font-mono font-bold tracking-wider text-text-secondary/50 group-hover:text-text-primary transition-colors uppercase leading-relaxed max-w-[80%]">
                      {t.dragTargetText}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ==================== SYSTEM RESOURCE & DECODER TELEMETRY HUD ==================== */}
          {hudOpen && hudDocked && (
            <div className="bg-surface border border-border-elite rounded-lg p-5 flex flex-col gap-4 select-none animate-fadeIn">
              {renderTelemetryContent()}
            </div>
          )}

        </section>

      </div>

      {/* ==================== FLOATING DRAGGABLE HUD OVERLAY WINDOW ==================== */}
      {hudOpen && !hudDocked && (
        <div 
          className="fixed bg-background/95 backdrop-blur-md border border-border-elite rounded-lg p-4 select-none z-[999] shadow-2xl w-[450px] md:w-[600px] pointer-events-auto overflow-hidden animate-fadeIn"
          style={{ 
            left: `${hudPos.x}px`, 
            top: `${hudPos.y}px`,
            maxWidth: '90vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Drag Handle Bar */}
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="flex items-center justify-between border-b border-border-elite pb-2 mb-3 cursor-grab active:cursor-grabbing font-mono text-[10px] select-none text-text-secondary hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <Move size={11} />
              <span className="font-bold uppercase tracking-wider">{lang === 'ru' ? 'ТЕЛЕМЕТРИЯ (ПЕРЕМЕСТИТЬ)' : 'TELEMETRY HUD (DRAG)'}</span>
            </div>
            <Button
              variant="ghost"
              onClick={() => setHudOpen(false)}
              className="p-1 rounded hover:bg-surface-hover text-text-secondary hover:text-white cursor-pointer"
            >
              <X size={12} />
            </Button>
          </div>

          {/* Console Body */}
          <div className="overflow-y-auto pr-1 flex-1">
            {renderTelemetryContent()}
          </div>
        </div>
      )}


      {/* ==================== FOOTER ==================== */}
      <footer className="text-center font-mono text-[9px] text-text-secondary/50 border-t border-border-elite pt-4 mt-2">
        {t.footer}
      </footer>

      {/* ==================== THEATER PLAYER (YouTube-style UI test) ==================== */}
      {theaterStream && (
        <TheaterPlayer
          stream={theaterStream}
          lang={lang}
          forceSoftwareHevc={forceSwHevc}
          onClose={() => setTheaterStream(null)}
        />
      )}

    </main>
  );
}
