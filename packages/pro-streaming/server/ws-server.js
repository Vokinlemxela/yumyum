import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import { WebSocketServer } from 'ws';

const port = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3002;
const host = process.env.WS_HOST || undefined;
const wss = new WebSocketServer({ port, host });

console.log(`[WS RTSP Server] Running on ws://${host ?? 'localhost'}:${port}`);

// Operators can require a shared secret for access to this server.
const authToken = process.env.WS_AUTH_TOKEN || '';
if (!authToken) {
  console.warn(
    '[WS RTSP Server] WARNING: WS_AUTH_TOKEN is not set — this server is running UNAUTHENTICATED. ' +
    'Any client that can reach this WS port can request an RTSP stream. Set WS_AUTH_TOKEN in production.'
  );
}

/** Constant-time string compare (falls back to a length check when sizes differ, same as crypto.timingSafeEqual requires equal-length buffers). */
function tokensMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

// Restrict which RTSP destinations clients may request.
// Operator-controlled allowlist of RTSP hosts, e.g. "cam1.lan,10.0.0.5".
// When set, it is treated as a STRICT allowlist: only these hosts are
// permitted, private/loopback ranges included (an operator listing an
// internal camera is doing so deliberately). When unset, we fall back to
// rejecting loopback/link-local/private/multicast targets by default.
const allowedHostsList = (process.env.RTSP_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const allowedHostsSet = new Set(allowedHostsList);

/** true if `ip` (a literal IPv4 address) falls in a reserved/internal range. */
function isDisallowedIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT, treat as internal
  return false;
}

/** true if `ip` (a literal IPv6 address, as returned by net.isIP) falls in a reserved/internal range. */
function isDisallowedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true; // unspecified
  // IPv4-mapped IPv6 (::ffff:10.0.0.5) — check the embedded IPv4.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isDisallowedIPv4(mapped[1]);
  // fe80::/10 link-local: first 10 bits are 1111111010, i.e. the first
  // hextet is in [fe80, febf].
  const firstHextet = parseInt(normalized.split(':')[0] || '0', 16);
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

/**
 * Decide whether `hostname` (already lower-cased, no brackets/port) is a
 * permitted RTSP target.
 *
 * Hostname checks apply to the supplied name. FFmpeg resolves DNS separately,
 * so deployments that accept untrusted names must also restrict outbound access.
 */
function isHostAllowed(hostname) {
  const host = hostname.toLowerCase();

  if (allowedHostsSet.size > 0) {
    // Strict allowlist mode: only listed hosts pass, everything else is denied.
    return allowedHostsSet.has(host);
  }

  // Default-safe mode: reject known-internal targets.
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'localdomain') return false;

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return !isDisallowedIPv4(host);
  if (ipVersion === 6) return !isDisallowedIPv6(host);

  // Reject non-canonical numeric IP forms (short-form "127.1", octal
  // "017700000001", hex "0x7f000001", or plain decimal "2130706433" for
  // 127.0.0.1). Node's URL parser does not canonicalize hosts for the
  // rtsp: scheme (it's opaque, unlike http:), so these pass through
  // net.isIP() as "not an IP" and would otherwise fall through to the
  // "allow" branch below — a classic SSRF filter-bypass technique, since
  // OS resolvers/ffmpeg often still parse them back into a loopback or
  // private address. Any all-digit or 0x-prefixed host is almost never a
  // legitimate camera hostname, so we fail closed on it.
  if (/^(0x[0-9a-f]+|[0-9]+(\.[0-9]+){0,3})$/i.test(host)) {
    return false;
  }

  // Non-literal hostname: pragmatic checks for common internal TLD/suffix
  // conventions. Anything else (public hostnames, real DNS names) is
  // allowed to pass through to ffmpeg/DNS resolution.
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    return false;
  }

  return true;
}

/** Extract the hostname (no brackets, no port) from an rtsp:// URL. Returns null if unparseable. */
function extractRtspHost(rtspUrl) {
  try {
    const parsed = new URL(rtspUrl);
    if (parsed.protocol !== 'rtsp:') return null;
    return parsed.hostname || null; // URL already strips [] from IPv6 and the port
  } catch (err) {
    return null;
  }
}

wss.on('connection', (ws, req) => {
  const urlIndex = req.url.indexOf('?');
  if (urlIndex === -1) {
    ws.close(1008, 'Missing query parameters');
    return;
  }

  const urlParams = new URLSearchParams(req.url.substring(urlIndex));

  // ─── Auth check ───────────────────────────────────────────────────
  if (authToken) {
    const headerAuth = req.headers['authorization'] || '';
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(headerAuth);
    const presentedToken = urlParams.get('token') || (bearerMatch ? bearerMatch[1] : '') || '';

    if (!presentedToken || !tokensMatch(presentedToken, authToken)) {
      console.error('[WS RTSP Server] Rejected connection: missing or invalid auth token');
      ws.close(4401, 'Unauthorized');
      return;
    }
  }

  const rtspUrl = urlParams.get('url');

  if (!rtspUrl) {
    console.error('[WS RTSP Server] Missing RTSP URL in connection parameters');
    ws.close(1008, 'Missing RTSP URL');
    return;
  }

  // Decoded character safety validation
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(rtspUrl);
  } catch (err) {
    ws.close(1008, 'Invalid URL Encoding');
    return;
  }

  if (
    !rtspUrl.startsWith('rtsp://') ||
    !/^rtsp:\/\/[a-zA-Z0-9._:\/@?&=%~!\$\(\)\*\+,-]+$/.test(decodedUrl) ||
    // `&` is allowed: legitimate RTSP query separator (?channel=1&subtype=0),
    // harmless because ffmpeg is spawned without a shell (args array below).
    /[\s"'`;<>|\\]/.test(decodedUrl)
  ) {
    console.error('[WS RTSP Server] Invalid RTSP URL rejected:', decodedUrl);
    ws.close(1008, 'Invalid RTSP URL');
    return;
  }

  // SSRF guard: block loopback/link-local/private/multicast RTSP targets
  // unless explicitly allowlisted via RTSP_ALLOWED_HOSTS. See isHostAllowed().
  const rtspHost = extractRtspHost(decodedUrl);
  if (!rtspHost || !isHostAllowed(rtspHost)) {
    console.error('[WS RTSP Server] RTSP target rejected by SSRF policy (host not allowed):', rtspHost || decodedUrl);
    ws.close(1008, 'RTSP host not allowed');
    return;
  }

  // Resolve FFmpeg path
  let ffmpegPath = 'ffmpeg';
  const pathsToSearch = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
  for (const p of pathsToSearch) {
    try {
      if (p === 'ffmpeg' || fs.existsSync(p)) {
        ffmpegPath = p;
        break;
      }
    } catch (err) {}
  }

  console.log(`[WS RTSP Server] Spawning FFmpeg copy-piping for: ${decodedUrl}`);

  const ffmpegArgs = [
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-avoid_negative_ts', 'make_zero',
    '-rtsp_transport', 'tcp',
    // Restrict ffmpeg's input protocol handlers to RTSP + its transport
    // protocols, so a crafted "URL" can't be coerced into file:/http(s):/
    // concat: etc. gadgets even if it slipped past the regex/SSRF checks above.
    '-protocol_whitelist', 'rtsp,rtp,udp,tcp',
    '-i', decodedUrl,
    '-map', '0:v:0',
    '-codec:v', 'copy',
    '-bsf:v', 'setts=pts=N*3600:dts=N*3600',
    '-map', '0:a:0?',
    '-codec:a', 'aac',
    '-b:a', '64k',
    '-ac', '2',
    '-ar', '44100',
    '-ignore_unknown',
    '-f', 'mpegts',
    '-mpegts_flags', '+initial_discontinuity',
    'pipe:1'
  ];

  const proc = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Optional debug capture: tee the streamed MPEG-TS to a file (WS_CAPTURE=path),
  // capped so it doesn't grow forever. Used to reproduce decode issues offline.
  const capturePath = process.env.WS_CAPTURE;
  let captureStream = capturePath ? fs.createWriteStream(capturePath) : null;
  let captured = 0;
  const CAPTURE_CAP = 8 * 1024 * 1024;
  if (captureStream) console.log(`[WS RTSP Server] Capturing stream to ${capturePath}`);

  proc.stdout.on('data', (chunk) => {
    if (captureStream && captured < CAPTURE_CAP) {
      captureStream.write(chunk);
      captured += chunk.length;
      if (captured >= CAPTURE_CAP) {
        captureStream.end();
        captureStream = null;
        console.log(`[WS RTSP Server] Capture complete (${captured} bytes).`);
      }
    }
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk);
    }
  });

  let stderrBuffer = '';
  proc.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
  });

  proc.on('close', (code) => {
    console.log(`[WS RTSP Server] FFmpeg process closed with code ${code}`);
    if (code !== 0 && code !== 255) {
      console.error(`[WS RTSP Server] FFmpeg failed. Exit code: ${code}. Stderr logs:\n${stderrBuffer.trim()}`);
    }
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[WS RTSP Server] Client disconnected. Cleaning up process.');
    try {
      proc.kill('SIGKILL');
    } catch (e) {}
  });

  ws.on('error', (err) => {
    console.error('[WS RTSP Server] WebSocket client error occurred:', err);
    try {
      proc.kill('SIGKILL');
    } catch (e) {}
  });
});
