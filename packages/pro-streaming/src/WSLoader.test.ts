import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, type PluginContext } from '@yumyum-player/core';
import { proStreaming } from './index.js';

// Stub global WebSocket
class MockWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public binaryType: string = '';

  public onopen: (() => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {}

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure' });
    }
  }

  triggerOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  triggerMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  triggerError(err: any) {
    if (this.onerror) this.onerror(err);
  }

  triggerClose(code = 1006, reason = 'Abnormal closure') {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

import { WSLoader } from './WSLoader.js';

it('registers the WebSocket transport with the default plugin', () => {
  const logger = new Logger('test');
  const registerLoader = vi.fn<PluginContext['registerLoader']>();
  proStreaming().install({ logger, registerLoader, registerDecoder: vi.fn() });

  expect(registerLoader).toHaveBeenCalledWith(['ws', 'wss'], expect.any(Function));
  const [, factory] = registerLoader.mock.calls[0];
  expect(factory({ logger, onData: vi.fn(), onMockPacket: null, onError: null })).toBeInstanceOf(WSLoader);
});

describe('WSLoader', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const makeDeps = () => ({
    onData: vi.fn(),
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

  it('has kind = push', () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    expect(loader.kind).toBe('push');
  });

  it('getDuration returns Infinity (live)', () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    expect(loader.getDuration()).toBe(Infinity);
  });

  it('seek returns false (live)', () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    expect(loader.seek(10)).toBe(false);
  });

  it('performs WS connection and starts heartbeat', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);

    const loadPromise = loader.load('ws://localhost/live');

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('ws://localhost/live');

    ws.triggerOpen();
    await loadPromise;

    // Heartbeat should start
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('does unbounded reconnect with growing delay (exponential + jitter)', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);

    const loadPromise = loader.load('ws://localhost/live');
    const ws1 = MockWebSocket.instances[0];
    ws1.triggerOpen();
    await loadPromise;

    // Simulate connection drop
    ws1.triggerClose();

    // Reconnect attempt #1: base 1000ms. With 20% jitter, backoff is in [800, 1200]
    expect(MockWebSocket.instances).toHaveLength(1); // No new instance yet

    await vi.advanceTimersByTimeAsync(1300); // Exceeds max 1200ms
    expect(MockWebSocket.instances).toHaveLength(2); // Attempt #1 started

    const ws2 = MockWebSocket.instances[1];
    ws2.triggerClose();

    // Reconnect attempt #2: base 2000ms. Delay is in [1600, 2400]
    await vi.advanceTimersByTimeAsync(2500);
    expect(MockWebSocket.instances).toHaveLength(3); // Attempt #2 started

    const ws3 = MockWebSocket.instances[2];
    ws3.triggerClose();

    // Reconnect attempt #3: base 4000ms. Delay is in [3200, 4800]
    await vi.advanceTimersByTimeAsync(4900);
    expect(MockWebSocket.instances).toHaveLength(4); // Attempt #3 started
  });

  it('resets reconnectAttempts after 5 seconds of stable connection', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);

    const loadPromise = loader.load('ws://localhost/live');
    const ws1 = MockWebSocket.instances[0];
    ws1.triggerOpen();
    await loadPromise;

    // Disconnect
    ws1.triggerClose();
    await vi.advanceTimersByTimeAsync(1300); // Reconnect #1
    expect(MockWebSocket.instances).toHaveLength(2);

    const ws2 = MockWebSocket.instances[1];
    ws2.triggerOpen();

    // Wait 5 seconds without messages (stable connection)
    await vi.advanceTimersByTimeAsync(5100);

    // Close again. Reconnect attempt should be #1 (base 1000ms, range [800, 1200])
    ws2.triggerClose();

    await vi.advanceTimersByTimeAsync(1300);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('stop() is a no-op and does not clear reconnect delay or disconnect', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);

    const loadPromise = loader.load('ws://localhost/live');
    const ws1 = MockWebSocket.instances[0];
    ws1.triggerOpen();
    await loadPromise;

    loader.stop(); // should be no-op for push loader

    expect(ws1.readyState).toBe(1); // OPEN, not closed
  });

  it('destroy() stops reconnect attempts and closes current socket', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);

    const loadPromise = loader.load('ws://localhost/live');
    const ws1 = MockWebSocket.instances[0];
    ws1.triggerOpen();
    await loadPromise;

    loader.destroy();

    expect(ws1.readyState).toBe(3); // CLOSED

    // If a close event occurs after destroy, it should not trigger a reconnect
    ws1.triggerClose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockWebSocket.instances).toHaveLength(1); // No new connections
  });

  it('exposes quality levels and parses main/sub variants from search parameters', () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    loader.load('ws://localhost/live?stream=sub');

    const levels = loader.getLevels();
    expect(levels).toHaveLength(2);
    expect(levels[0].id).toBe('main');
    expect(levels[0].url).toBe('ws://localhost/live?stream=main');
    expect(levels[1].id).toBe('sub');
    expect(levels[1].url).toBe('ws://localhost/live?stream=sub');
  });

  it('provides default quality levels if not explicitly present in URL', () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    loader.load('ws://localhost/live');

    const levels = loader.getLevels();
    expect(levels).toHaveLength(2);
    expect(levels[0].id).toBe('main');
    expect(levels[0].url).toBe('ws://localhost/live');
    expect(levels[1].id).toBe('sub');
    expect(levels[1].url).toBe('ws://localhost/live?stream=sub');
  });

  it('switches quality and reconnects to the new URL', async () => {
    const deps = makeDeps();
    const loader = new WSLoader(deps as any);
    
    const loadPromise = loader.load('ws://localhost/live?stream=main');
    const ws1 = MockWebSocket.instances[0];
    ws1.triggerOpen();
    await loadPromise;

    expect(loader.getActiveId()).toBe('main');

    // Switch quality to 'sub'
    const switchPromise = loader.quality.switchQuality('sub');
    
    // First socket should be closed
    expect(ws1.readyState).toBe(3); // CLOSED

    // Next socket should be created with the sub URL
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1];
    expect(ws2.url).toBe('ws://localhost/live?stream=sub');

    ws2.triggerOpen();
    await switchPromise;

    expect(loader.getActiveId()).toBe('sub');
  });

  describe('WSLoader throughput estimation', () => {
  const createWSLoader = () => {
    const deps = makeDeps();
    return new WSLoader(deps as any);
  };

  it('starts with zero throughput', async () => {
    const loader = createWSLoader();
    const loadPromise = loader.load('ws://localhost/live');
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.triggerOpen();
    await loadPromise;

    const tp = loader.getThroughput!();
    expect(tp.throughputKbps).toBe(0);
    expect(tp.throughputSamples).toBe(0);

    loader.destroy();
  });

  it('tracks bytes from messages and updates on interval', async () => {
    vi.useFakeTimers();
    const loader = createWSLoader();
    const loadPromise = loader.load('ws://localhost/live');
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.triggerOpen();
    await loadPromise;

    // Simulate receiving 10KB of data
    const buffer = new ArrayBuffer(10240);
    ws.triggerMessage(buffer);

    // Advance timer by 1s to trigger throughput calculation
    vi.advanceTimersByTime(1000);

    const tp = loader.getThroughput!();
    expect(tp.throughputKbps).toBeGreaterThan(0);
    expect(tp.throughputSamples).toBe(1);

    loader.destroy();
    vi.useRealTimers();
  });

  it('clears throughput interval on disconnect', async () => {
    vi.useFakeTimers();
    const loader = createWSLoader();
    const loadPromise = loader.load('ws://localhost/live');
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.triggerOpen();
    await loadPromise;

    loader.destroy();
    
    // Advance several seconds — should not accumulate samples
    vi.advanceTimersByTime(5000);
    const tp = loader.getThroughput!();
    // May have had 0 or 1 sample from the initial interval setup
    expect(tp.throughputSamples).toBeLessThanOrEqual(1);

    vi.useRealTimers();
  });
});
});
