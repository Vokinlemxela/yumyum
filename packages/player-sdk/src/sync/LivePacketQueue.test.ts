import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePacketQueue, type MediaPacket } from './LivePacketQueue.js';

function sample(index: number, audio = false): MediaPacket {
  return {
    type: audio ? 'AUDIO' : 'VIDEO',
    codec: audio ? 'aac' : 'h264',
    pts: index / 25,
    data: new Uint8Array(16),
    isKeyframe: !audio && index % 25 === 0,
  };
}

describe('live HLS packet pacing', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('feeds a ten-second burst at camera cadence with a bounded decode lead for both tracks', () => {
    const video: number[] = [], audio: number[] = [];
    const onDrop = vi.fn();
    const queue = new LivePacketQueue(p => (p.type === 'VIDEO' ? video : audio).push(p.pts), () => false, onDrop, vi.fn());
    // fMP4 can deliver a complete video track before any audio from the same fragment.
    for (const isAudio of [false, true]) for (let i = 0; i < 250; i++) queue.push(sample(i, isAudio));
    expect(queue.hasLookahead).toBe(true);
    expect(video.length).toBeLessThan(10);
    expect(audio.length).toBeLessThan(10);
    for (let seconds = 1; seconds <= 10; seconds++) {
      vi.advanceTimersByTime(1000);
      for (const track of [audio, video]) {
        expect(track.length).toBeGreaterThanOrEqual(seconds * 25);
        expect(track.length).toBeLessThanOrEqual(seconds * 25 + 7);
      }
    }
    expect(onDrop).not.toHaveBeenCalled();
    expect(video).toEqual(audio);
    expect(queue.hasLookahead).toBe(false);
    expect(queue.bufferedBytes).toBe(0);
  });

  it('recovers at a recent keyframe instead of decoding seconds of stale video after a stall', () => {
    let congested = true;
    const video: MediaPacket[] = [];
    const onDrop = vi.fn();
    const onCatchUp = vi.fn();
    const queue = new LivePacketQueue(p => video.push(p), () => congested, onDrop, onCatchUp);
    for (let i = 0; i < 250; i++) queue.push(sample(i));
    vi.advanceTimersByTime(5550);
    expect(video).toHaveLength(0);
    congested = false;
    vi.advanceTimersByTime(300);
    expect(video[0].isKeyframe).toBe(true);
    expect(video[0].pts).toBeGreaterThanOrEqual(4);
    expect(video.at(-1)!.pts).toBeGreaterThan(5.5);
    expect(onDrop.mock.calls.reduce((sum, [n]) => sum + n, 0)).toBeGreaterThanOrEqual(100);
    queue.reset();
    const delivered = video.length;
    vi.advanceTimersByTime(10_000);
    expect(video).toHaveLength(delivered);
  });

  it('decodes a long GOP as preroll while presenting from the recovered live clock', () => {
    let congested = true;
    const onCatchUp = vi.fn();
    const queue = new LivePacketQueue(vi.fn(), () => congested, vi.fn(), onCatchUp);
    for (let i = 0; i < 250; i++) queue.push({ ...sample(i), isKeyframe: i === 0 });
    vi.advanceTimersByTime(5500);
    expect(onCatchUp).not.toHaveBeenCalled();
    congested = false;
    vi.advanceTimersByTime(500);
    expect(onCatchUp).toHaveBeenCalledTimes(1);
    expect(onCatchUp.mock.calls[0][0]).toBeCloseTo(5.5, 1);
    queue.reset();
  });

  it('caps retained payload size and waits for a keyframe after an oversized GOP', () => {
    const queue = new LivePacketQueue(vi.fn(), () => true, vi.fn(), vi.fn());
    const data = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 40; i++) {
      queue.push({ ...sample(i), isKeyframe: i === 0, data });
      expect(queue.bufferedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    }
    expect(queue.bufferedBytes).toBe(0);
    queue.push(sample(50));
    expect(queue.bufferedBytes).toBe(16);
    queue.reset();
  });
});
