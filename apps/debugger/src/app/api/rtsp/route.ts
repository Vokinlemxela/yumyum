import { NextResponse } from 'next/server';
import { spawn, ChildProcess, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';

// ---------------------------------------------------------------------------
// Access gate
// ---------------------------------------------------------------------------
// Internal dev tool: if RTSP_API_TOKEN is set, callers must present it via
// `x-rtsp-token` or `Authorization: Bearer <token>`. If unset, we do not
// hard-fail (so local dev keeps working without extra setup) but we log a
// warning and best-effort restrict to loopback/localhost callers.
const isLoopbackHost = (host: string | null): boolean => {
  if (!host) return false;
  // Strip a possible port (host header / forwarded host may include one).
  const hostname = host.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (net.isIP(hostname) === 4) {
    const first = parseInt(hostname.split('.')[0], 10);
    return first === 127;
  }
  return false;
};

const checkAccessGate = (request: Request): { ok: true } | { ok: false; status: number; error: string } => {
  const requiredToken = process.env.RTSP_API_TOKEN;

  if (requiredToken) {
    const headerToken = request.headers.get('x-rtsp-token');
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;
    const providedToken = headerToken || bearerToken;

    if (!providedToken || providedToken !== requiredToken) {
      console.warn('[API RTSP] Отклонён запрос: отсутствует или неверный токен доступа (RTSP_API_TOKEN).');
      return { ok: false, status: 401, error: 'Unauthorized: valid x-rtsp-token or Authorization: Bearer token required.' };
    }
    return { ok: true };
  }

  // No token configured: don't hard-fail (local dev must keep working), but
  // best-effort restrict to loopback callers when we can determine the
  // origin, and always log that the route is open.
  const forwardedFor = request.headers.get('x-forwarded-for');
  const callerHost = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

  if (callerHost && !isLoopbackHost(callerHost)) {
    console.warn(`[API RTSP] RTSP_API_TOKEN не задан, и запрос пришёл не с localhost (x-forwarded-for: ${callerHost}). Отклоняем.`);
    return { ok: false, status: 401, error: 'Unauthorized: RTSP_API_TOKEN is not configured and this route is restricted to localhost.' };
  }

  console.warn('[API RTSP] ВНИМАНИЕ: RTSP_API_TOKEN не задан — маршрут открыт без аутентификации (ограничено localhost, где это можно определить).');
  return { ok: true };
};

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------
// Literal-IP range checks only. This does NOT protect against DNS rebinding
// (i.e. a hostname that resolves to a private IP at connection time but not
// at validation time) — full protection would require resolving the host
// ourselves and pinning the resolved IP for the ffmpeg/ffprobe connection,
// which is out of scope here.
const isLiteralPrivateOrLoopbackIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  return false;
};

const isLiteralPrivateOrLoopbackIPv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true; // unspecified
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // fe80::/10 link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local (private)
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4 address.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isLiteralPrivateOrLoopbackIPv4(mapped[1]);
  return false;
};

const isForbiddenLiteralHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;

  const ipType = net.isIP(h);
  if (ipType === 4) return isLiteralPrivateOrLoopbackIPv4(h);
  if (ipType === 6) return isLiteralPrivateOrLoopbackIPv6(h);

  return false; // Not a literal IP and not "localhost" — leave to allowlist/default policy below.
};

/**
 * Validate the RTSP target host against SSRF policy.
 *
 * If RTSP_ALLOWED_HOSTS is set (comma-separated hostnames/IPs), it is treated
 * as a strict allowlist: only listed hosts may be used, regardless of
 * whether they look "private". If unset, we default-deny loopback,
 * link-local, RFC1918 private ranges, and multicast literal IPs (or
 * "localhost"); any other host (e.g. a real external camera IP or hostname)
 * is allowed.
 */
const checkRtspHostPolicy = (hostname: string): { ok: true } | { ok: false; error: string } => {
  const allowlistRaw = process.env.RTSP_ALLOWED_HOSTS;
  if (allowlistRaw && allowlistRaw.trim().length > 0) {
    const allowlist = allowlistRaw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!allowlist.includes(hostname.toLowerCase())) {
      return { ok: false, error: `Хост "${hostname}" не входит в список разрешённых (RTSP_ALLOWED_HOSTS).` };
    }
    return { ok: true };
  }

  if (isForbiddenLiteralHost(hostname)) {
    return { ok: false, error: `Хост "${hostname}" запрещён (loopback/link-local/private/multicast). Используйте RTSP_ALLOWED_HOSTS для явного разрешения.` };
  }

  return { ok: true };
};

/**
 * Parse and validate an RTSP URL end-to-end: syntax/character allowlist plus
 * SSRF host policy. Returns the normalized URL string that must be the SAME
 * value passed to ffmpeg/ffprobe (previously validation ran on a decoded
 * copy while the raw `rtspUrl` was spawned, allowing the two to diverge).
 */
const validateRtspUrl = (rawUrl: unknown): { ok: true; url: string } | { ok: false; status: number; error: string } => {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return { ok: false, status: 400, error: 'RTSP URL является обязательным параметром.' };
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    return { ok: false, status: 400, error: 'Некорректный RTSP URL: невалидное URL-кодирование.' };
  }

  if (
    !rawUrl.startsWith('rtsp://') ||
    !/^rtsp:\/\/[a-zA-Z0-9._:\/@?&=%~!\$\(\)\*\+,-]+$/.test(decodedUrl) ||
    // Block shell/whitespace metacharacters. `&` is intentionally allowed: it
    // is a legitimate RTSP query separator (e.g. ?channel=1&subtype=0) and is
    // harmless because ffmpeg/ffprobe are spawned without a shell (args array,
    // and the only execSync uses an md5 hash, never the raw URL).
    /[\s"'`;<>|\\]/.test(decodedUrl)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Некорректный RTSP URL. Разрешены только ссылки формата rtsp:// без пробелов и специальных символов.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(decodedUrl);
  } catch {
    return { ok: false, status: 400, error: 'Некорректный RTSP URL: не удалось разобрать хост.' };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { ok: false, status: 400, error: 'Некорректный RTSP URL: отсутствует хост.' };
  }

  const hostPolicy = checkRtspHostPolicy(hostname);
  if (!hostPolicy.ok) {
    return { ok: false, status: 403, error: hostPolicy.error };
  }

  // Use the decoded (normalized) URL consistently for both validation and
  // spawning, so the two can never diverge.
  return { ok: true, url: decodedUrl };
};

interface GlobalWithRtsp {
  rtspRegistry?: Map<string, { process: ChildProcess; rtspUrl: string; startTime: number; playlistUrl: string; codec: string }>;
  pendingInit?: Map<string, Promise<{ success: boolean; url?: string; codec?: string; error?: string }>>;
  rtspRefCounts?: Map<string, number>;
}

// Define a global map in-memory to manage active transcoding processes across requests safely
const getRtspRegistry = (): Map<string, { process: ChildProcess; rtspUrl: string; startTime: number; playlistUrl: string; codec: string }> => {
  const g = global as unknown as GlobalWithRtsp;
  if (!g.rtspRegistry) {
    g.rtspRegistry = new Map();
  }
  return g.rtspRegistry;
};

// Define a global map to track pending RTSP stream initializations concurrently
const getPendingInit = (): Map<string, Promise<{ success: boolean; url?: string; codec?: string; error?: string }>> => {
  const g = global as unknown as GlobalWithRtsp;
  if (!g.pendingInit) {
    g.pendingInit = new Map();
  }
  return g.pendingInit;
};

// Define a global map to track active stream reference counts
const getRtspRefCounts = (): Map<string, number> => {
  const g = global as unknown as GlobalWithRtsp;
  if (!g.rtspRefCounts) {
    g.rtspRefCounts = new Map();
  }
  return g.rtspRefCounts;
};

const detectCodec = (rtspUrl: string, ffprobePath: string): Promise<string> => {
  return new Promise((resolve) => {
    const ffprobeArgs = [
      '-rtsp_transport', 'tcp',
      '-protocol_whitelist', 'rtsp,rtp,udp,tcp',
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      rtspUrl
    ];
    
    console.log(`[API RTSP] Запуск ffprobe для определения кодека: ${ffprobePath} ${ffprobeArgs.join(' ')}`);
    
    const proc = spawn(ffprobePath, ffprobeArgs);
    let stdout = '';
    
    // Set a timeout of 4 seconds to avoid hanging indefinitely if RTSP stream is unreachable
    const timer = setTimeout(() => {
      console.log('[API RTSP] Таймаут ffprobe (4s). Используем кодек по умолчанию (h264).');
      try {
        proc.kill('SIGKILL');
      } catch (e) {}
      resolve('h264');
    }, 4000);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      const detected = stdout.trim().toLowerCase();
      console.log(`[API RTSP] ffprobe завершился с кодом ${code}. Обнаружен видеокодек: "${detected}"`);
      if (detected.includes('hevc') || detected.includes('h265')) {
        resolve('h265');
      } else if (detected.includes('h264')) {
        resolve('h264');
      } else if (detected.includes('mjpeg') || detected.includes('jpeg')) {
        resolve('mjpeg');
      } else {
        resolve('h264'); // Fallback to safe profile
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error('[API RTSP] Ошибка при запуске ffprobe:', err);
      resolve('h264'); // Fallback
    });
  });
};

export async function POST(request: Request) {
  try {
    const gate = checkAccessGate(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = await request.json();
    const { action, rtspUrl: rawRtspUrl, codec = 'h264' } = body;

    const registry = getRtspRegistry();

    // 1. Handling STOP action manually from UI client teardown
    if (action === 'stop') {
      const refCounts = getRtspRefCounts();
      if (rawRtspUrl) {
        console.log(`[API RTSP] Запрос на остановку/декремент трансляции для URL: ${rawRtspUrl}`);
        const currentRefCount = refCounts.get(rawRtspUrl) || 0;
        const newRefCount = Math.max(0, currentRefCount - 1);

        if (newRefCount > 0) {
          refCounts.set(rawRtspUrl, newRefCount);
          console.log(`[API RTSP] Уменьшаем refCount для ${rawRtspUrl} до ${newRefCount}`);
        } else {
          refCounts.delete(rawRtspUrl);
          console.log(`[API RTSP] refCount достиг 0 для ${rawRtspUrl}. Удаляем из подписок.`);

          const existing = registry.get(rawRtspUrl);
          if (existing) {
            try {
              console.log(`[API RTSP] Принудительная остановка процесса для RTSP-камеры: ${rawRtspUrl}`);
              existing.process.kill('SIGKILL');
            } catch (e) {}
            registry.delete(rawRtspUrl);
          }

          // Clean up output folder to save disk space
          const urlHash = crypto.createHash('md5').update(rawRtspUrl).digest('hex');
          const outputDir = path.join(process.cwd(), 'public', 'rtsp-streams', urlHash);
          if (fs.existsSync(outputDir)) {
            try {
              fs.rmSync(outputDir, { recursive: true, force: true });
            } catch (e) {}
          }
        }
        return NextResponse.json({ success: true, message: `RTSP трансляция для ${rawRtspUrl} декрементирована.` });
      } else {
        console.log('[API RTSP] Запрос на остановку всех RTSP трансляций...');
        refCounts.clear();
        registry.forEach((item, key) => {
          try {
            console.log(`[API RTSP] Принудительное завершение FFmpeg процесса для URL: ${item.rtspUrl}`);
            item.process.kill('SIGKILL');
          } catch (e) {}
          registry.delete(key);
        });
        return NextResponse.json({ success: true, message: 'Все RTSP процессы успешно остановлены.' });
      }
    }

    // 1.5 Handling PROBE action to detect codec without starting HLS transcoding
    if (action === 'probe') {
      const validation = validateRtspUrl(rawRtspUrl);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: validation.status });
      }
      const validatedUrl = validation.url;

      let ffprobePath = 'ffprobe';
      const ffprobePathsToSearch = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'];
      for (const p of ffprobePathsToSearch) {
        try {
          if (p === 'ffprobe' || fs.existsSync(p)) {
            ffprobePath = p;
            break;
          }
        } catch (e) {}
      }

      const detected = await detectCodec(validatedUrl, ffprobePath);
      return NextResponse.json({ success: true, codec: detected });
    }

    // Validate rtspUrl. The validated/normalized URL below (`rtspUrl`) is the
    // SAME value used for the registry/refCounts/pendingInit map keys AND the
    // value handed to ffmpeg's `-i` flag further down — previously validation
    // ran on a separately-decoded copy while the raw request value was what
    // actually got spawned, allowing the two to diverge.
    const validation = validateRtspUrl(rawRtspUrl);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }
    const rtspUrl = validation.url;

    const refCounts = getRtspRefCounts();
    const currentRefCount = refCounts.get(rtspUrl) || 0;
    const newRefCount = currentRefCount + 1;
    refCounts.set(rtspUrl, newRefCount);

    console.log(`[API RTSP] Запрос на конвертацию RTSP: "${rtspUrl}" | Увеличиваем refCount до ${newRefCount} | Запрошенный кодек (клиент): ${codec.toUpperCase()}`);

    // Check if the stream is already running for this SPECIFIC rtspUrl
    const existing = registry.get(rtspUrl);
    if (existing) {
      console.log(`[API RTSP] Поток для ${rtspUrl} уже запущен. Возвращаем существующий плейлист.`);
      return NextResponse.json({
        success: true,
        url: existing.playlistUrl,
        codec: existing.codec,
      });
    }

    // 2. Resolve FFmpeg and FFprobe binary paths
    let ffmpegPath = 'ffmpeg';
    const pathsToSearch = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
    for (const p of pathsToSearch) {
      try {
        if (p === 'ffmpeg' || fs.existsSync(p)) {
          ffmpegPath = p;
          break;
        }
      } catch (e) {}
    }

    let ffprobePath = 'ffprobe';
    const ffprobePathsToSearch = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'];
    for (const p of ffprobePathsToSearch) {
      try {
        if (p === 'ffprobe' || fs.existsSync(p)) {
          ffprobePath = p;
          break;
        }
      } catch (e) {}
    }

    // Check if there is an active pending initialization for this same URL
    const pendingInit = getPendingInit();
    const pending = pendingInit.get(rtspUrl);
    if (pending) {
      console.log(`[API RTSP] Обнаружен параллельный процесс инициализации для ${rtspUrl}. Ожидаем завершения...`);
      const result = await pending;
      if (result.success) {
        return NextResponse.json({
          success: true,
          url: result.url,
          codec: result.codec,
        });
      } else {
        return NextResponse.json({ error: result.error || 'Failed to start stream' }, { status: 504 });
      }
    }

    // Create the active initialization Promise
    const initPromise = (async () => {
      try {
        // 3. Auto-detect video codec with ffprobe
        const detectedCodec = await detectCodec(rtspUrl, ffprobePath);
        const outputCodec = detectedCodec; // Output matches source
        console.log(`[API RTSP] Режим по умолчанию: Copy-Mode | Кодек потока: ${detectedCodec.toUpperCase()} | Выходной кодек: ${outputCodec.toUpperCase()}`);

        const urlHash = crypto.createHash('md5').update(rtspUrl).digest('hex');
        const outputDir = path.join(process.cwd(), 'public', 'rtsp-streams', urlHash);
        const playlistPath = path.join(outputDir, 'stream.m3u8');
        const playlistUrl = `/rtsp-streams/${urlHash}/stream.m3u8`;

        // 3.5 Robustly terminate any existing orphaned ffmpeg process writing to this hash's HLS directory
        try {
          const pids = execSync(`pgrep -f "ffmpeg.*${urlHash}"`).toString().split('\n').filter(Boolean);
          for (const pid of pids) {
            console.log(`[API RTSP] Terminating orphaned FFmpeg process associated with hash ${urlHash} (PID: ${pid})`);
            process.kill(parseInt(pid, 10), 'SIGKILL');
          }
        } catch (e) {}

        const startFFmpegStream = (mode: 'copy' | 'hardware' | 'software'): Promise<boolean> => {
          return new Promise((resolve) => {
            // Check if the stream was already cancelled before we start FFmpeg
            const activeRefs = refCounts.get(rtspUrl) || 0;
            if (activeRefs <= 0) {
              console.log(`[API RTSP] Инициализация была отменена (refCount = ${activeRefs}). Прерываем запуск FFmpeg.`);
              resolve(false);
              return;
            }

            // Setup/clean public folder
            if (fs.existsSync(outputDir)) {
              try {
                fs.rmSync(outputDir, { recursive: true, force: true });
              } catch (e) {}
            }
            fs.mkdirSync(outputDir, { recursive: true });

            // Build FFmpeg args
            const ffmpegArgs: string[] = [];

            // Global and input configuration to actively resolve timestamp / packet loss bugs.
            // We avoid rewriting timestamps with wallclock time to prevent scrambling B-frame DTS/PTS.
            ffmpegArgs.push(
              '-fflags', '+genpts+discardcorrupt',
              '-avoid_negative_ts', 'make_zero',
              '-rtsp_transport', 'tcp',
              '-protocol_whitelist', 'rtsp,rtp,udp,tcp',
              '-i', rtspUrl
            );

            if (mode === 'copy') {
              ffmpegArgs.push('-codec:v', 'copy');
              if (detectedCodec === 'h265') {
                ffmpegArgs.push('-tag:v', 'hvc1');
              }
            } else if (mode === 'hardware') {
              ffmpegArgs.push(
                '-codec:v', detectedCodec === 'h265' ? 'hevc_videotoolbox' : 'h264_videotoolbox',
                '-realtime', '1',
                '-g', '30', // Force keyframe every 30 frames (~1.2s at 25fps) for HLS stability, match hls_time
                '-b:v', '2M'
              );
              if (detectedCodec === 'h265') {
                ffmpegArgs.push('-tag:v', 'hvc1');
              }
            } else {
              // Software Transcode Mode (Highly compatible libx264/libx265)
              ffmpegArgs.push(
                '-codec:v', detectedCodec === 'h265' ? 'libx265' : 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-g', '30', // Force keyframe every 30 frames (~1.2s at 25fps) for HLS stability, match hls_time
                '-b:v', '2M'
              );
              if (outputCodec === 'h265') {
                ffmpegArgs.push('-tag:v', 'hvc1');
                ffmpegArgs.push('-x265-params', 'keyint=30:min-keyint=30:no-open-gop=1:repeat-headers=1');
              }
            }

            ffmpegArgs.push(
              // Map video stream (required) and audio stream (optional)
              '-map', '0:v:0',
              '-map', '0:a:0?',
              // Audio: transcode to AAC for web compatibility
              '-codec:a', 'aac',
              '-b:a', '64k',
              '-ac', '2',
              '-ar', '44100',
              // Live HLS slicing optimizations for low latency
              '-f', 'hls',
              '-hls_time', '1.0', // 1.0s chunk segments for network stability
              '-hls_list_size', '10', // 10 segments in sliding window
              '-hls_flags', 'delete_segments+split_by_time',
              '-hls_segment_filename', path.join(outputDir, 'seg_%03d.ts'),
              playlistPath
            );

            console.log(`[API RTSP] Запуск FFmpeg (Режим: ${mode.toUpperCase()}): ${ffmpegPath} ${ffmpegArgs.join(' ')}`);

            let ffmpegExited = false;
            let ffmpegExitCode: number | null = null;

            const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
              detached: false,
              stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderrOutput = '';
            ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
              stderrOutput += chunk.toString();
            });

            // Check again if cancelled immediately after spawn
            const activeRefsAfterSpawn = refCounts.get(rtspUrl) || 0;
            if (activeRefsAfterSpawn <= 0) {
              console.log(`[API RTSP] Инициализация была отменена во время запуска (refCount = ${activeRefsAfterSpawn}). Убиваем процесс.`);
              try {
                ffmpegProcess.kill('SIGKILL');
              } catch (e) {}
              resolve(false);
              return;
            }

            // Save active process handle keyed by its specific rtspUrl
            const existingInRegistry = registry.get(rtspUrl);
            if (existingInRegistry) {
              console.log(`[API RTSP] Parallel process already registered in registry for ${rtspUrl}. Killing this newly spawned process.`);
              try {
                ffmpegProcess.kill('SIGKILL');
              } catch (e) {}
              resolve(true);
              return;
            }

            registry.set(rtspUrl, {
              process: ffmpegProcess,
              rtspUrl,
              startTime: Date.now(),
              playlistUrl,
              codec: outputCodec,
            });

            ffmpegProcess.on('exit', (code, signal) => {
              ffmpegExited = true;
              ffmpegExitCode = code;
              console.log(`[API RTSP] FFmpeg процесс (Режим: ${mode.toUpperCase()}) завершился с кодом: ${code}, сигнал: ${signal}`);
              if (code !== 0 && stderrOutput) {
                console.error(`[API RTSP] FFmpeg stderr (последние 500 символов):\n${stderrOutput.slice(-500)}`);
              }
              
              // Only remove registry if it's the active process for this URL
              const current = registry.get(rtspUrl);
              if (current && current.process === ffmpegProcess) {
                registry.delete(rtspUrl);
              }
            });

            // Poll for HLS playlist creation
            const checkInterval = 250;
            const maxTimeout = 12000; // 12 seconds timeout
            let elapsed = 0;

            const timer = setInterval(() => {
              elapsed += checkInterval;

              if (ffmpegExited) {
                clearInterval(timer);
                console.warn(`[API RTSP] FFmpeg процесс завершился до инициализации HLS (код: ${ffmpegExitCode}).`);
                resolve(false);
                return;
              }

              if (fs.existsSync(playlistPath)) {
                try {
                  const stat = fs.statSync(playlistPath);
                  if (stat.size > 80) {
                    const files = fs.readdirSync(outputDir);
                    const hasSegments = files.some(f => f.endsWith('.ts'));
                    if (hasSegments && !ffmpegExited) {
                      clearInterval(timer);
                      resolve(true);
                      return;
                    }
                  }
                } catch (e) {}
              }

              if (elapsed >= maxTimeout) {
                clearInterval(timer);
                console.warn(`[API RTSP] Превышено время ожидания создания HLS плейлиста.`);
                try {
                  ffmpegProcess.kill('SIGKILL');
                } catch (e) {}
                registry.delete(rtspUrl);
                resolve(false);
              }
            }, checkInterval);
          });
        };

        // First attempt: try highly optimized Hardware-Transcode Mode (to force short GOP for 200ms latency)
        let isPlaylistCreated = await startFFmpegStream('hardware');

        if (!isPlaylistCreated) {
          console.warn('[API RTSP] Hardware Transcode-Mode не удался.');
          console.log('[API RTSP] Переход на Copy-Mode...');

          if (fs.existsSync(outputDir)) {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
          }
          isPlaylistCreated = await startFFmpegStream('copy');
        }

        if (!isPlaylistCreated) {
          console.warn('[API RTSP] Copy-Mode не удался.');
          console.log('[API RTSP] Автоматический переход на программное транскодирование (Software Transcode-Mode)...');

          if (fs.existsSync(outputDir)) {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e) {}
          }
          isPlaylistCreated = await startFFmpegStream('software');
        }

        if (isPlaylistCreated) {
          console.log('[API RTSP] HLS Манифест успешно создан. Поток готов к проигрыванию!');
          return { success: true, url: playlistUrl, codec: outputCodec };
        } else {
          return { success: false, error: 'Не удалось инициализировать HLS поток ни в одном из режимов.' };
        }
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : 'System error';
        return { success: false, error: errMessage };
      }
    })();

    // Register active initialization promise
    pendingInit.set(rtspUrl, initPromise);

    try {
      const result = await initPromise;
      if (result.success) {
        return NextResponse.json({
          success: true,
          url: result.url,
          codec: result.codec,
        });
      } else {
        return NextResponse.json({ error: result.error }, { status: 504 });
      }
    } finally {
      // Clean up dynamic map entry
      pendingInit.delete(rtspUrl);
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown system error';
    console.error('[API RTSP] Системная ошибка:', err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
