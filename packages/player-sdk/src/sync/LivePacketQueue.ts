/** Demux output stays compressed until its decode deadline. Each track keeps
 * decode order, which can differ from presentation order with B-frames. */
export interface MediaPacket {
  type: 'VIDEO' | 'AUDIO';
  codec: 'h264' | 'h265' | 'mjpeg' | 'aac';
  pts: number;
  data: Uint8Array;
  isKeyframe?: boolean;
  parsedCodec?: string;
  description?: Uint8Array;
}

const DECODE_AHEAD = 0.24;
const FETCH_AHEAD = 1.5;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PACKETS = 4096;

export class LivePacketQueue {
  private video: MediaPacket[] = [];
  private audio: MediaPacket[] = [];
  private bytes = 0;
  private anchor: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waitForKeyframe = false;
  private catchingUp = false;
  private lastArrival = 0;
  public lastSentPTS: number | undefined;

  constructor(
    private send: (packet: MediaPacket) => void,
    private videoBusy: () => boolean,
    private onDrop: (count: number) => void,
    private onCatchUp: (pts: number) => void,
  ) {}

  get bufferedBytes(): number { return this.bytes; }

  get hasLookahead(): boolean {
    const tail = Math.max(this.video.at(-1)?.pts ?? -Infinity, this.audio.at(-1)?.pts ?? -Infinity);
    return this.anchor !== undefined && tail - this.mediaNow() > FETCH_AHEAD;
  }

  private mediaNow() { return performance.now() / 1000 + (this.anchor ?? 0); }

  push(packet: MediaPacket) {
    const now = performance.now() / 1000;
    if (this.waitForKeyframe) {
      if (packet.type !== 'VIDEO' || !packet.isKeyframe) return;
      this.waitForKeyframe = false;
      this.anchor = undefined;
    }
    const empty = !this.audio.length && !this.video.length;
    if (this.anchor === undefined || (empty && now - this.lastArrival > 1 && Math.abs(packet.pts - this.mediaNow()) > 1)) {
      this.anchor = packet.pts - now;
    }
    this.lastArrival = now;
    (packet.type === 'VIDEO' ? this.video : this.audio).push(packet);
    this.bytes += packet.data.byteLength;
    if (this.bytes > MAX_BYTES || this.video.length + this.audio.length > MAX_PACKETS) {
      const index = this.lastKeyframeBefore(Infinity);
      if (index > 0) {
        this.skipTo(index);
        this.anchor = this.video[0].pts - now;
      }
      if (this.bytes > MAX_BYTES || this.video.length + this.audio.length > MAX_PACKETS) {
        this.onDrop(this.video.length);
        this.reset();
        this.waitForKeyframe = true;
        return;
      }
    }
    if (this.timer === undefined) this.drain();
  }

  private lastKeyframeBefore(pts: number): number {
    for (let i = this.video.length - 1; i >= 0; i--) {
      if (this.video[i].isKeyframe && this.video[i].pts <= pts) return i;
    }
    return -1;
  }

  private skipTo(index: number) {
    const pts = this.video[index].pts;
    for (const packet of this.video.splice(0, index)) this.bytes -= packet.data.byteLength;
    this.onDrop(index);
    while (this.audio.length && this.audio[0].pts < pts) this.bytes -= this.audio.shift()!.data.byteLength;
  }

  private drain() {
    this.timer = undefined;
    const clock = this.mediaNow();
    if (this.video.length && this.video[0].pts < clock - 1) {
      const index = this.lastKeyframeBefore(clock);
      if (index > 0) this.skipTo(index);
      if (!this.catchingUp && !this.videoBusy()) {
        // A long GOP still needs decoding from its IDR. Drop its stale decoded
        // preroll, otherwise the live clock re-anchors several seconds behind.
        this.catchingUp = true;
        this.onCatchUp(clock);
        while (this.audio.length && this.audio[0].pts < clock) this.bytes -= this.audio.shift()!.data.byteLength;
      }
    } else {
      this.catchingUp = false;
    }

    for (const track of [this.video, this.audio]) {
      // Bound each turn even after background throttling or a decoder stall.
      for (let n = 0; n < 12 && track.length && track[0].pts <= clock + DECODE_AHEAD; n++) {
        if (track === this.video && this.videoBusy()) break;
        const packet = track.shift()!;
        this.bytes -= packet.data.byteLength;
        this.lastSentPTS = Math.max(this.lastSentPTS ?? packet.pts, packet.pts);
        this.send(packet);
      }
    }

    if (this.video.length || this.audio.length) {
      const next = Math.min(this.video[0]?.pts ?? Infinity, this.audio[0]?.pts ?? Infinity);
      const delay = Math.min(100, Math.max(16, (next - clock - DECODE_AHEAD) * 1000));
      this.timer = setTimeout(() => this.drain(), delay);
    }
  }

  reset() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.audio = [];
    this.video = [];
    this.bytes = 0;
    this.anchor = undefined;
    this.waitForKeyframe = false;
    this.catchingUp = false;
    this.lastSentPTS = undefined;
  }
}
