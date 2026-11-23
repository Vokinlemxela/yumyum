import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMUXER_WORKER_SOURCE } from './DemuxerWorkerInline.js';

const MiB = 1024 * 1024;
const SAMPLE_DURATION = 250; // 4 fps in the fixture's 1000 Hz media timescale.

// Four black 16×16 AVC frames encoded by FFmpeg with libx264, an empty moov,
// default-base-is-moof and a single fragment. The SEI NAL was stripped.
const fixture = readFileSync(new URL('./fixtures/fmp4-video.mp4', import.meta.url));
const moovOffset = fixture.readUInt32BE(0);
const moofOffset = moovOffset + fixture.readUInt32BE(moovOffset);
const mdatOffset = moofOffset + fixture.readUInt32BE(moofOffset);
const init = fixture.subarray(0, moofOffset);
const firstNAL = mdatOffset + 8;
const secondNAL = firstNAL + 4 + fixture.readUInt32BE(firstNAL);
const keyframe = fixture.subarray(firstNAL, secondNAL);
const deltaFrame = fixture.subarray(secondNAL, secondNAL + 4 + fixture.readUInt32BE(secondNAL));

function uint32(...values: number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  return bytes;
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const size = 8 + payload.reduce((total, bytes) => total + bytes.length, 0);
  return Buffer.concat([uint32(size), Buffer.from(type, 'ascii'), ...payload], size);
}

function paddedSample(sample: Buffer, size: number): Buffer {
  // Grow the access unit with an AVC filler_data NAL after the coded slice.
  const filler = Buffer.alloc(size - sample.length - 4, 0xff);
  filler[0] = 0x0c;
  filler[filler.length - 1] = 0x80;
  return Buffer.concat([sample, uint32(filler.length), filler], size);
}

function fragment(sequence: number, decodeTime: number, ...samples: Buffer[]) {
  const mfhd = box('mfhd', uint32(0, sequence));
  const tfhd = box('tfhd', uint32(0x020000, 1)); // default-base-is-moof, track 1
  const tfdt = box('tfdt', uint32(0, decodeTime));
  const entries = uint32(...samples.flatMap((sample) => {
    const isIDR = (sample[4] & 0x1f) === 5;
    const flags = isIDR ? 0x02000000 : 0x01010000;
    return [SAMPLE_DURATION, sample.length, flags];
  }));
  // Headers for moof, traf, trun and mdat, plus all fragment metadata.
  const dataOffset = 4 * 8 + mfhd.length + tfhd.length + tfdt.length + 12 + entries.length;
  const trun = box('trun', uint32(0x000701, samples.length, dataOffset), entries);
  return {
    moof: box('moof', mfhd, box('traf', tfhd, tfdt, trun)),
    mdat: box('mdat', ...samples),
  };
}

interface WorkerOutput {
  type: 'VIDEO' | 'AUDIO' | 'ERROR';
  data?: Uint8Array;
}

function startWorker() {
  const messages: WorkerOutput[] = [];
  const worker: {
    onmessage?: (event: { data: unknown }) => void;
    postMessage: (message: WorkerOutput, transfer?: Transferable[]) => void;
  } = {
    postMessage(message, transfer) {
      messages.push(structuredClone(message, { transfer }));
    },
  };

  // Run the same bundled worker source the player passes to the browser Blob.
  new Function('self', DEMUXER_WORKER_SOURCE)(worker);
  const receive = worker.onmessage!;
  receive({ data: { type: 'INIT', data: { videoCodec: 'h264', audioCodec: 'aac' } } });

  return {
    messages,
    send(type: 'DEMUX' | 'STREAM_DEMUX', bytes: Buffer) {
      const buffer = Uint8Array.from(bytes).buffer;
      receive({ data: structuredClone({ type, data: buffer }, { transfer: [buffer] }) });
    },
    segment(mediaBase: number) {
      receive({ data: { type: 'SEGMENT_META', mediaBase } });
    },
  };
}

function expectVideo(message: WorkerOutput, sample: Buffer, pts: number, isKeyframe: boolean) {
  expect(message).toMatchObject({ type: 'VIDEO', codec: 'h264', parsedCodec: 'avc1.42c033', pts, isKeyframe });
  expect(message.data && Buffer.compare(message.data, sample)).toBe(0);
}

describe('fMP4 demux worker', () => {
  it('delivers every fragment from a segment larger than 5 MiB and rebases the next segment', () => {
    const worker = startWorker();
    const firstSample = paddedSample(keyframe, 3 * MiB);
    const secondSample = paddedSample(deltaFrame, 3 * MiB);
    const first = fragment(1, 12_000, firstSample);
    const second = fragment(2, 12_250, secondSample);

    worker.segment(30);
    worker.send('DEMUX', Buffer.concat([init, first.moof, first.mdat, second.moof, second.mdat]));
    expect(worker.messages).toHaveLength(2);
    expectVideo(worker.messages[0], firstSample, 30, true);
    expectVideo(worker.messages[1], secondSample, 30.25, false);

    const next = fragment(1, 100, keyframe);
    worker.segment(30.5);
    worker.send('DEMUX', Buffer.concat([init, next.moof, next.mdat]));
    expect(worker.messages).toHaveLength(3);
    expectVideo(worker.messages[2], keyframe, 30.5, true);
  });

  it('delivers the individual samples from a single mdat larger than 5 MiB', () => {
    const worker = startWorker();
    const firstSample = paddedSample(keyframe, 3 * MiB);
    const secondSample = paddedSample(deltaFrame, 3 * MiB);
    const media = fragment(1, 12_000, firstSample, secondSample);

    worker.segment(10);
    worker.send('DEMUX', Buffer.concat([init, media.moof, media.mdat]));
    expect(worker.messages).toHaveLength(2);
    expectVideo(worker.messages[0], firstSample, 10, true);
    expectVideo(worker.messages[1], secondSample, 10.25, false);
  });

  it.each([5, init.length])('reads a large mdat after an initial %i-byte stream chunk and continues with the next fragment', (initSplit) => {
    const worker = startWorker();
    const firstSample = paddedSample(keyframe, 3 * MiB);
    const secondSample = paddedSample(deltaFrame, 3 * MiB);
    const media = fragment(1, 12_000, firstSample, secondSample);
    const next = fragment(2, 12_500, keyframe);

    worker.send('STREAM_DEMUX', init.subarray(0, initSplit));
    worker.send('STREAM_DEMUX', Buffer.concat([init.subarray(initSplit), media.moof, media.mdat.subarray(0, 5)]));
    worker.send('STREAM_DEMUX', media.mdat.subarray(5, MiB));
    expect(worker.messages).toHaveLength(0);

    for (let offset = MiB; offset < 5 * MiB; offset += MiB) {
      worker.send('STREAM_DEMUX', media.mdat.subarray(offset, offset + MiB));
    }
    worker.send('STREAM_DEMUX', Buffer.concat([media.mdat.subarray(5 * MiB), next.moof.subarray(0, 3)]));
    expect(worker.messages).toHaveLength(2);
    expectVideo(worker.messages[0], firstSample, 0, true);
    expectVideo(worker.messages[1], secondSample, 0.25, false);

    worker.send('STREAM_DEMUX', Buffer.concat([next.moof.subarray(3), next.mdat]));
    expect(worker.messages).toHaveLength(3);
    expectVideo(worker.messages[2], keyframe, 0.5, true);
  });

  it('recovers on the next discrete segment after an incomplete mdat', () => {
    const worker = startWorker();
    const broken = fragment(1, 9000, keyframe);
    worker.send('DEMUX', Buffer.concat([init, broken.moof, broken.mdat.subarray(0, 10)]));
    expect(worker.messages.filter((message) => message.type === 'VIDEO')).toHaveLength(0);

    const next = fragment(1, 100, keyframe);
    worker.segment(11);
    worker.send('DEMUX', Buffer.concat([init, next.moof, next.mdat]));
    const videos = worker.messages.filter((message) => message.type === 'VIDEO');
    expect(videos).toHaveLength(1);
    expectVideo(videos[0], keyframe, 11, true);
  });

  it('continues streaming after an mdat header declares an unsupported size', () => {
    const worker = startWorker();
    const badHeader = Buffer.concat([uint32(0xffff_ffff), Buffer.from('mdat', 'ascii')]);
    worker.send('STREAM_DEMUX', Buffer.concat([init, badHeader]));
    expect(worker.messages.filter((message) => message.type === 'VIDEO')).toHaveLength(0);

    const next = fragment(1, 100, keyframe);
    worker.send('STREAM_DEMUX', Buffer.concat([next.moof, next.mdat]));
    const videos = worker.messages.filter((message) => message.type === 'VIDEO');
    expect(videos).toHaveLength(1);
    expectVideo(videos[0], keyframe, 0, true);
  });
});

describe('video sample descriptions', () => {
  it('identifies HEVC in an unhinted playlist and returns to AVC on the next init', () => {
    const worker = startWorker();
    const hevcInit = Buffer.from(init);
    const entry = hevcInit.indexOf('avc1', moovOffset);
    const configuration = hevcInit.indexOf('avcC', entry);
    expect(entry).toBeGreaterThan(0);
    expect(configuration).toBeGreaterThan(entry);
    hevcInit.write('hvc1', entry, 'ascii');
    hevcInit.write('hvcC', configuration, 'ascii');
    const record = configuration + 4;
    hevcInit.fill(0, record, record + 23);
    hevcInit.set([1, 1, 0x60, 0, 0, 0, 0x80], record);
    hevcInit[record + 12] = 150;
    hevcInit[record + 21] = 3;
    const irap = Buffer.from([0, 0, 0, 3, 0x26, 1, 0x80]);
    const h = fragment(1, 0, irap);
    worker.send('DEMUX', Buffer.concat([hevcInit, h.moof, h.mdat]));
    expect(worker.messages[0]).toMatchObject({ type: 'VIDEO', codec: 'h265', parsedCodec: 'hvc1.1.6.L150.80', isKeyframe: true });
    expect(worker.messages[0]).toHaveProperty('description');
    const a = fragment(2, 250, keyframe);
    worker.send('DEMUX', Buffer.concat([init, a.moof, a.mdat]));
    expect(worker.messages[1]).toMatchObject({ type: 'VIDEO', codec: 'h264', parsedCodec: 'avc1.42c033' });
  });
});
