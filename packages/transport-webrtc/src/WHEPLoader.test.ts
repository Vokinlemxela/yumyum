import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, type PluginContext } from '@yumyum-player/core';
import { transportWebrtc } from './index.js';
import { WHEPLoader, whepToHttpUrl, detectEncodedTransformSupport } from './WHEPLoader.js';

// ─── Pure function tests (no browser APIs needed) ───────────────────

it('registers the WHEP transport with the default plugin', () => {
  const logger = new Logger('test');
  const registerLoader = vi.fn<PluginContext['registerLoader']>();
  transportWebrtc().install({ logger, registerLoader, registerDecoder: vi.fn() });

  expect(registerLoader).toHaveBeenCalledWith(['whep', 'whep+https'], expect.any(Function));
  const [, factory] = registerLoader.mock.calls[0];
  expect(factory({ logger, onData: vi.fn(), onMockPacket: null, onError: null })).toBeInstanceOf(WHEPLoader);
});

describe('whepToHttpUrl', () => {
  it('converts whep:// to http://', () => {
    expect(whepToHttpUrl('whep://vms.local/whep/cam_1/whep'))
      .toBe('http://vms.local/whep/cam_1/whep');
  });

  it('converts whep+https:// to https://', () => {
    expect(whepToHttpUrl('whep+https://vms.example.com/whep/cam_2/whep'))
      .toBe('https://vms.example.com/whep/cam_2/whep');
  });

  it('passes through http:// URLs unchanged', () => {
    expect(whepToHttpUrl('http://example.com/whep'))
      .toBe('http://example.com/whep');
  });

  it('passes through https:// URLs unchanged', () => {
    expect(whepToHttpUrl('https://example.com/whep'))
      .toBe('https://example.com/whep');
  });

  it('handles whep:// with port numbers', () => {
    expect(whepToHttpUrl('whep://192.168.1.1:8554/cam/whep'))
      .toBe('http://192.168.1.1:8554/cam/whep');
  });

  it('handles whep+https:// with query parameters', () => {
    expect(whepToHttpUrl('whep+https://vms.local/whep/cam?token=abc'))
      .toBe('https://vms.local/whep/cam?token=abc');
  });
});

describe('detectEncodedTransformSupport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null when neither RTCRtpScriptTransform nor createEncodedStreams is available', () => {
    // Default Node.js env — no WebRTC APIs
    expect(detectEncodedTransformSupport()).toBeNull();
  });

  it('returns "script-transform" when RTCRtpScriptTransform is available', () => {
    vi.stubGlobal('RTCRtpScriptTransform', class {});
    expect(detectEncodedTransformSupport()).toBe('script-transform');
  });

  it('returns "encoded-streams" when createEncodedStreams is on RTCRtpReceiver prototype', () => {
    // Simulate legacy Chrome 86–109
    const FakeReceiver = function () {} as unknown as typeof RTCRtpReceiver;
    FakeReceiver.prototype = { createEncodedStreams: () => ({}) } as unknown as RTCRtpReceiver;
    vi.stubGlobal('RTCRtpReceiver', FakeReceiver);
    expect(detectEncodedTransformSupport()).toBe('encoded-streams');
  });

  it('prefers script-transform over encoded-streams when both exist', () => {
    vi.stubGlobal('RTCRtpScriptTransform', class {});
    const FakeReceiver = function () {} as unknown as typeof RTCRtpReceiver;
    FakeReceiver.prototype = { createEncodedStreams: () => ({}) } as unknown as RTCRtpReceiver;
    vi.stubGlobal('RTCRtpReceiver', FakeReceiver);
    expect(detectEncodedTransformSupport()).toBe('script-transform');
  });
});

// ─── WHEPLoader integration tests (mocked browser APIs) ──────────────

describe('WHEPLoader', () => {
  // Mock RTCPeerConnection, fetch, AudioContext etc.
  const mockAddTransceiver = vi.fn();
  const mockCreateOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n' });
  const mockSetLocalDescription = vi.fn().mockResolvedValue(undefined);
  const mockSetRemoteDescription = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn();

  let mockPc: Record<string, unknown>;
  let onTrackHandler: ((event: unknown) => void) | null = null;
  let onIceGatheringChange: (() => void) | null = null;
  let lastPcInstance: any = null;

  beforeEach(() => {
    lastPcInstance = null;
    mockPc = {
      addTransceiver: mockAddTransceiver,
      createOffer: mockCreateOffer,
      setLocalDescription: mockSetLocalDescription,
      setRemoteDescription: mockSetRemoteDescription,
      close: mockClose,
      iceGatheringState: 'complete',
      localDescription: { sdp: 'v=0\r\no=- test offer\r\n' },
      ontrack: null,
      oniceconnectionstatechange: null,
      onicegatheringstatechange: null,
    };

    // Use a class so `new RTCPeerConnection(...)` works
    vi.stubGlobal('RTCPeerConnection', class {
      addTransceiver = mockAddTransceiver;
      createOffer = mockCreateOffer;
      setLocalDescription = mockSetLocalDescription;
      setRemoteDescription = mockSetRemoteDescription;
      close = mockClose;
      iceGatheringState = 'complete';
      localDescription = { sdp: 'v=0\r\no=- test offer\r\n' };
      iceConnectionState = 'new';
      ontrack: ((event: unknown) => void) | null = null;
      oniceconnectionstatechange: (() => void) | null = null;
      onicegatheringstatechange: (() => void) | null = null;
      getStats = vi.fn().mockResolvedValue(new Map());
      constructor() {
        lastPcInstance = this;
      }
    });

    vi.stubGlobal('RTCSessionDescription', class {
      type: string;
      sdp: string;
      constructor(init: { type: string; sdp: string }) {
        this.type = init.type;
        this.sdp = init.sdp;
      }
    });

    vi.stubGlobal('RTCRtpScriptTransform', undefined);

    // Simulate legacy encoded streams support
    const FakeReceiver = function () {} as unknown as typeof RTCRtpReceiver;
    FakeReceiver.prototype = { createEncodedStreams: () => ({}) } as unknown as RTCRtpReceiver;
    vi.stubGlobal('RTCRtpReceiver', FakeReceiver);

    // Mock AudioContext
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      resume = vi.fn().mockResolvedValue(undefined);
      destination = {};
      createMediaStreamSource = vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      close = vi.fn();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    onTrackHandler = null;
    onIceGatheringChange = null;
  });

  const makeDeps = () => ({
    onData: vi.fn(),
    onSegmentMeta: vi.fn(),
    onMockPacket: vi.fn(),
    onError: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getLevel: () => 'silent' as const,
      createChild: () => makeDeps().logger,
    },
  });

  it('has kind = push', async () => {
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);
    expect(loader.kind).toBe('push');
  });

  it('getDuration returns Infinity (live)', async () => {
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);
    expect(loader.getDuration()).toBe(Infinity);
  });

  it('seek returns false (live)', async () => {
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);
    expect(loader.seek(10)).toBe(false);
  });

  it('rejects load() when Encoded Transform is not supported', async () => {
    // Remove all WebRTC APIs
    vi.stubGlobal('RTCRtpScriptTransform', undefined);
    vi.stubGlobal('RTCRtpReceiver', undefined);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await expect(loader.load('whep://localhost/cam/whep'))
      .rejects.toThrow('Browser does not support Encoded Transform');

    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it('performs WHEP handshake: POST offer, set remote description', async () => {
    // Mock fetch to return SDP answer
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: new Map([['Location', '/whep/cam/whep/session123']]),
    });
    // Wrap headers with a get() method
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: (name: string) => name === 'Location' ? '/whep/cam/whep/session123' : null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep://localhost:8889/cam/whep');

    // Verify POST to correct URL
    expect(mockFetch).toHaveBeenCalledOnce();
    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(fetchUrl).toBe('http://localhost:8889/cam/whep');
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers).toMatchObject({ 'Content-Type': 'application/sdp' });

    // Verify PeerConnection was configured
    expect(mockAddTransceiver).toHaveBeenCalledWith('video', { direction: 'recvonly' });
    expect(mockAddTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' });
    expect(mockSetLocalDescription).toHaveBeenCalledOnce();
    expect(mockSetRemoteDescription).toHaveBeenCalledOnce();

    expect(loader.getConnectionState()).toBe('connected');

    loader.destroy();
  });

  it('signals error when WHEP endpoint returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    }));

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await expect(loader.load('whep://localhost/cam/whep'))
      .rejects.toThrow('WHEP endpoint returned 404');

    expect(deps.onError).toHaveBeenCalledOnce();

    loader.destroy();
  });

  it('sends DELETE on destroy when session URL is known', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: (name: string) => name === 'Location' ? '/whep/cam/session1' : null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep://localhost/cam/whep');
    mockFetch.mockClear();

    loader.destroy();

    // DELETE should have been called
    expect(mockFetch).toHaveBeenCalledOnce();
    const [deleteUrl, deleteOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(deleteUrl).toContain('/whep/cam/session1');
    expect(deleteOpts.method).toBe('DELETE');
  });

  it('uses whep+https:// → https:// for the fetch URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep+https://secure.vms.com/whep/cam/whep');

    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    expect(fetchUrl).toBe('https://secure.vms.com/whep/cam/whep');

    loader.destroy();
  });

  it('start() and stop() are no-ops for push loader', async () => {
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    // These should not throw
    loader.start(() => false);
    loader.stop();

    loader.destroy();
  });

  it('reconnects after 5 seconds in disconnected ICE state', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep://localhost/cam/whep');
    mockFetch.mockClear();

    expect(lastPcInstance).not.toBeNull();
    
    // Transition to disconnected
    lastPcInstance.iceConnectionState = 'disconnected';
    lastPcInstance.oniceconnectionstatechange();

    // Reconnect should NOT trigger immediately
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance 5.1 seconds to trigger scheduleReconnect()
    await vi.advanceTimersByTimeAsync(5100);

    // Reconnect scheduled with base 1000ms (range [800, 1200] ms).
    // Advance another 1300ms to run it.
    await vi.advanceTimersByTimeAsync(1300);

    expect(mockFetch).toHaveBeenCalledOnce();
    
    loader.destroy();
    vi.useRealTimers();
  });

  it('cancels disconnected reconnect if state goes back to connected', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep://localhost/cam/whep');
    mockFetch.mockClear();

    expect(lastPcInstance).not.toBeNull();
    
    // Transition to disconnected
    lastPcInstance.iceConnectionState = 'disconnected';
    lastPcInstance.oniceconnectionstatechange();

    // Advance 3 seconds
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch).not.toHaveBeenCalled();

    // Transition back to connected
    lastPcInstance.iceConnectionState = 'connected';
    lastPcInstance.oniceconnectionstatechange();

    // Advance remaining time + reconnect time
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockFetch).not.toHaveBeenCalled();

    loader.destroy();
    vi.useRealTimers();
  });

  it('reconnects immediately when ICE connection failed', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    await loader.load('whep://localhost/cam/whep');
    mockFetch.mockClear();

    expect(lastPcInstance).not.toBeNull();
    
    // Transition to failed
    lastPcInstance.iceConnectionState = 'failed';
    lastPcInstance.oniceconnectionstatechange();

    // Reconnect scheduled immediately (base 1000ms, range [800, 1200])
    await vi.advanceTimersByTimeAsync(1300);

    expect(mockFetch).toHaveBeenCalledOnce();

    loader.destroy();
    vi.useRealTimers();
  });

  it('exposes quality levels and parses main/sub variants from search parameters', async () => {
    vi.stubGlobal('RTCRtpScriptTransform', class {});
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);
    
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    await loader.load('whep://localhost/cam/whep?stream=sub');

    const levels = loader.getLevels();
    expect(levels).toHaveLength(2);
    expect(levels[0].id).toBe('main');
    expect(levels[0].url).toBe('whep://localhost/cam/whep?stream=main');
    expect(levels[1].id).toBe('sub');
    expect(levels[1].url).toBe('whep://localhost/cam/whep?stream=sub');

    loader.destroy();
  });

  it('provides default quality levels if not explicitly present in URL', async () => {
    vi.stubGlobal('RTCRtpScriptTransform', class {});
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    await loader.load('whep://localhost/cam/whep');

    const levels = loader.getLevels();
    expect(levels).toHaveLength(2);
    expect(levels[0].id).toBe('main');
    expect(levels[0].url).toBe('whep://localhost/cam/whep');
    expect(levels[1].id).toBe('sub');
    expect(levels[1].url).toBe('whep://localhost/cam/whep?stream=sub');

    loader.destroy();
  });

  it('switches quality and reconnects to the new WHEP URL', async () => {
    vi.stubGlobal('RTCRtpScriptTransform', class {});
    const deps = makeDeps();
    const { WHEPLoader } = await import('./WHEPLoader.js');
    const loader = new WHEPLoader(deps as never, deps.logger as never);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    await loader.load('whep://localhost/cam/whep?stream=main');
    expect(loader.getActiveId()).toBe('main');

    mockFetch.mockClear();

    await loader.quality.switchQuality('sub');

    expect(loader.getActiveId()).toBe('sub');
    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost/cam/whep?stream=sub');

    loader.destroy();
  });

  describe('WHEPLoader throughput estimation', () => {
    it('polls getStats and calculates smoothed throughput', async () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      const { WHEPLoader } = await import('./WHEPLoader.js');
      const loader = new WHEPLoader(deps as never, deps.logger as never);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: vi.fn().mockResolvedValue('v=0\r\no=- answer\r\n'),
        headers: { get: () => null },
      });
      vi.stubGlobal('fetch', mockFetch);

      await loader.load('whep://localhost/cam/whep');
      const pcInstance = lastPcInstance;
      expect(pcInstance).not.toBeNull();

      // Configure mock stats reports: first report is 100000 bytes
      const report1 = { type: 'inbound-rtp', kind: 'video', bytesReceived: 100000 };
      const stats1 = [report1];
      pcInstance.getStats = vi.fn().mockResolvedValue(stats1);

      // Trigger first stats poll
      await vi.advanceTimersByTimeAsync(1000);

      // Now set report2 to 200000 bytes
      const report2 = { type: 'inbound-rtp', kind: 'video', bytesReceived: 200000 };
      const stats2 = [report2];
      pcInstance.getStats = vi.fn().mockResolvedValue(stats2);

      // Advance by another 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      const tp = loader.getThroughput!();
      expect(tp.throughputSamples).toBe(1);
      expect(tp.throughputKbps).toBeGreaterThan(0);

      loader.destroy();
      vi.useRealTimers();
    });
  });
});
