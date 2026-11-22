'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { YumYumPlayerView, type PlayerControlKey } from '@yumyum-player/ui';
import { X } from 'lucide-react';
import { makeCreatePlayer } from '../lib/createDebuggerPlayer';

interface StreamProfile {
  id: string;
  name: string;
  url: string;
  desc: string;
  badge: string;
  codec: 'h264' | 'h265' | 'mjpeg';
}

interface TheaterPlayerProps {
  stream: StreamProfile;
  lang: 'ru' | 'en';
  forceSoftwareHevc?: boolean;
  onClose: () => void;
}

const ACCENT_SWATCHES = ['#00FF66', '#0A84FF', '#FF375F', '#FFD60A', '#BF5AF2', '#FF9F0A'];
const CONTROL_KEYS: PlayerControlKey[] = ['play', 'volume', 'timeline', 'time', 'speed', 'settings', 'pip', 'fullscreen'];

const L = {
  ru: {
    title: 'ТЕСТ ПЛЕЕРА', settings: 'НАСТРОЙКИ ПЛЕЕРА', accent: 'Акцентный цвет',
    visible: 'Показывать контролы', autohide: 'Авто-скрытие (мс)', startup: 'При старте',
    autoplay: 'Автоплей', speed: 'Скорость', lang: 'Язык контролов', reload: 'Применить (перезапуск)',
    hint: 'Цвет, контролы, скорость, авто-скрытие и язык применяются вживую. «При старте» (автоплей) применяется кнопкой ниже.',
  },
  en: {
    title: 'PLAYER TEST', settings: 'PLAYER SETTINGS', accent: 'Accent color',
    visible: 'Show controls', autohide: 'Auto-hide (ms)', startup: 'On startup',
    autoplay: 'Autoplay', speed: 'Speed', lang: 'Controls language', reload: 'Apply (restart)',
    hint: 'Color, controls, speed, auto-hide and language apply live. "On startup" (autoplay) applies via the button below.',
  },
};

const PERSIST_PREFIX = 'yumyum:theater';
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4, 16];

export const TheaterPlayer: React.FC<TheaterPlayerProps> = ({ stream, lang: initialLang, forceSoftwareHevc, onClose }) => {
  // Live-customizable props
  const [accent, setAccent] = useState('#00FF66');
  // All controls visible by default, including PiP — canvas Picture-in-Picture
  // now works (the WebGL canvas is mirrored into an off-screen <video> via
  // captureStream). Toggle any control off in the panel below.
  const [hidden, setHidden] = useState<Record<PlayerControlKey, boolean>>({} as Record<PlayerControlKey, boolean>);
  const [autoHide, setAutoHide] = useState(3000);
  const [lang, setLang] = useState<'ru' | 'en'>(initialLang);
  const [liveRate, setLiveRate] = useState(1); // applied to the player instantly
  // Startup prefs (applied on remount) — reflect the persisted value.
  const [startAutoplay, setStartAutoplay] = useState<boolean>(() => {
    try { return JSON.parse(window.localStorage.getItem(`${PERSIST_PREFIX}:autoplay`) || 'false'); } catch { return false; }
  });
  const [remountKey, setRemountKey] = useState(0);

  const toggleStartAutoplay = () => {
    setStartAutoplay((v) => {
      const nv = !v;
      try { window.localStorage.setItem(`${PERSIST_PREFIX}:autoplay`, JSON.stringify(nv)); } catch { /* ignore */ }
      return nv;
    });
  };

  const t = L[lang];

  // Stable createPlayer; only re-created when the source actually changes.
  const { createPlayer, cleanup } = useMemo(
    () => makeCreatePlayer(stream.url, { forceSoftwareHevc }),
    [stream.url, forceSoftwareHevc]
  );

  useEffect(() => cleanup, [cleanup]);

  // Esc closes the theater.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const controls = useMemo(() => {
    const c: Partial<Record<PlayerControlKey, boolean>> = {};
    for (const k of CONTROL_KEYS) c[k] = hidden[k] !== true;
    return c;
  }, [hidden]);

  const applyStartup = () => {
    try {
      window.localStorage.setItem(`${PERSIST_PREFIX}:autoplay`, JSON.stringify(startAutoplay));
    } catch { /* ignore */ }
    setRemountKey((k) => k + 1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col lg:flex-row">
      {/* Player area */}
      <div className="flex-1 flex items-center justify-center p-4 min-w-0">
        <div className="w-full max-w-5xl aspect-video rounded-lg overflow-hidden border border-border-elite shadow-2xl">
          <YumYumPlayerView
            key={remountKey}
            createPlayer={createPlayer}
            accentColor={accent}
            playbackRate={liveRate}
            controls={controls}
            autoHideDelay={autoHide}
            persistKeyPrefix={PERSIST_PREFIX}
            lang={lang}
          />
        </div>
      </div>

      {/* Customization panel */}
      <aside className="w-full lg:w-80 shrink-0 bg-surface border-l border-border-elite p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-mono text-accent-primary tracking-widest">{t.title}</div>
            <div className="text-sm font-bold text-text-primary truncate max-w-[200px]">{stream.name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded bg-red-950/30 border border-red-500/30 hover:bg-red-500 hover:text-black text-red-400 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mb-3">{t.settings}</div>

        {/* Accent color */}
        <label className="block text-[11px] text-text-secondary mb-1.5">{t.accent}</label>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${accent === c ? 'scale-110 border-white' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-6 w-8 bg-transparent cursor-pointer"
            aria-label="Custom color"
          />
        </div>

        {/* Control visibility */}
        <label className="block text-[11px] text-text-secondary mb-1.5">{t.visible}</label>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {CONTROL_KEYS.map((k) => {
            const on = hidden[k] !== true;
            return (
              <button
                key={k}
                onClick={() => setHidden((h) => ({ ...h, [k]: h[k] !== true }))}
                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                  on ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-black border-border-elite text-text-secondary'
                }`}
              >
                {k}
              </button>
            );
          })}
        </div>

        {/* Auto-hide */}
        <label className="block text-[11px] text-text-secondary mb-1.5">{t.autohide}: {autoHide}</label>
        <input
          type="range" min={1000} max={8000} step={250} value={autoHide}
          onChange={(e) => setAutoHide(Number(e.target.value))}
          className="w-full mb-4 cursor-pointer" style={{ accentColor: accent }}
        />

        {/* Language */}
        <label className="block text-[11px] text-text-secondary mb-1.5">{t.lang}</label>
        <div className="flex gap-1.5 mb-5">
          {(['ru', 'en'] as const).map((lg) => (
            <button
              key={lg}
              onClick={() => setLang(lg)}
              className={`flex-1 px-2 py-1 rounded text-[10px] font-mono border uppercase ${
                lang === lg ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-black border-border-elite text-text-secondary'
              }`}
            >
              {lg}
            </button>
          ))}
        </div>

        {/* Speed — applied to the player instantly */}
        <label className="block text-[11px] text-text-secondary mb-1.5">{t.speed}</label>
        <div className="flex flex-wrap gap-1.5 mb-5">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => setLiveRate(r)}
              className={`px-2 py-1 rounded text-[10px] font-mono border min-w-[44px] ${
                liveRate === r ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-black border-border-elite text-text-secondary'
              }`}
            >
              {r}×
            </button>
          ))}
        </div>

        {/* Startup prefs */}
        <div className="border-t border-border-elite pt-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary mb-2">{t.startup}</div>
          <button
            onClick={toggleStartAutoplay}
            className={`w-full mb-2 px-2 py-1.5 rounded text-[11px] font-mono border flex items-center justify-between ${
              startAutoplay ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-black border-border-elite text-text-secondary'
            }`}
          >
            <span>{t.autoplay}</span><span>{startAutoplay ? 'ON' : 'OFF'}</span>
          </button>
          <button
            onClick={applyStartup}
            className="w-full px-2 py-1.5 rounded text-[11px] font-mono font-bold bg-accent-primary/15 border border-accent-primary text-accent-primary hover:bg-accent-primary/25 transition-colors"
          >
            {t.reload}
          </button>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-text-secondary/70 font-mono">{t.hint}</p>
      </aside>
    </div>
  );
};
