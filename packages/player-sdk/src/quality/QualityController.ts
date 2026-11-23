import { QualitySource, QualityLevel } from './QualitySource.js';
import { StreamSignals } from './Signals.js';
import { TimingPolicy } from '../sync/TimingPolicy.js';
import { Logger } from '../utils/Logger.js';

export interface QualityControllerOptions {
  mode?: 'auto' | 'manual';
  cooldownSeconds?: number;
  downDwellSeconds?: number;
  upDwellSeconds?: number;
  safetyFactor?: number;
  upHeadroomFactor?: number;
  droppedFpsThreshold?: number;
  fpsRatioThreshold?: number;
  queueStarvationThreshold?: number;
}

export class QualityController {
  private mode: 'auto' | 'manual' = 'manual';
  private maxAllowedKind: 'main' | 'sub' | null = null;
  private lastAttemptTime = -Infinity;
  private lastSwitchTime = 0;
  private switching = false;
  private lastSwitchReason = 'None';
  private downDwellStartTime: number | null = null;
  private upDwellStartTime: number | null = null;

  // Options/parameters
  private readonly cooldownMs: number;
  private readonly downDwellMs: number;
  private readonly upDwellMs: number;
  private readonly safetyFactor: number;
  private readonly upHeadroomFactor: number;
  private readonly droppedFpsThreshold: number;
  private readonly fpsRatioThreshold: number;
  private readonly queueStarvationThreshold: number;

  public onQualitySwitch: ((toId: string, reason: string) => void) | null = null;

  constructor(
    private readonly source: QualitySource,
    private readonly logger: Logger,
    options: QualityControllerOptions = {}
  ) {
    this.mode = options.mode ?? 'manual';
    this.cooldownMs = (options.cooldownSeconds ?? TimingPolicy.ABR_COOLDOWN_SECONDS) * 1000;
    this.downDwellMs = (options.downDwellSeconds ?? TimingPolicy.ABR_DOWN_DWELL_SECONDS) * 1000;
    this.upDwellMs = (options.upDwellSeconds ?? TimingPolicy.ABR_UP_DWELL_SECONDS) * 1000;
    this.safetyFactor = options.safetyFactor ?? TimingPolicy.ABR_SAFETY_FACTOR;
    this.upHeadroomFactor = options.upHeadroomFactor ?? TimingPolicy.ABR_UP_HEADROOM_FACTOR;
    this.droppedFpsThreshold = options.droppedFpsThreshold ?? TimingPolicy.ABR_DROPPED_FPS_THRESHOLD;
    this.fpsRatioThreshold = options.fpsRatioThreshold ?? TimingPolicy.ABR_FPS_RATIO_THRESHOLD;
    this.queueStarvationThreshold = options.queueStarvationThreshold ?? TimingPolicy.ABR_QUEUE_STARVATION_THRESHOLD;
  }

  public getMode(): 'auto' | 'manual' {
    return this.mode;
  }

  public setMode(mode: 'auto' | 'manual'): void {
    if (this.mode !== mode) {
      this.logger.info(`ABR Mode changed to: ${mode}`);
      this.mode = mode;
      this.downDwellStartTime = null;
      this.upDwellStartTime = null;
    }
  }

  public getMaxQualityKind(): 'main' | 'sub' | null {
    return this.maxAllowedKind;
  }

  /**
   * Returns the kind ('main' | 'sub') of the REAL underlying rendition currently
   * playing, independent of the controller mode. Unlike the player's
   * `getActiveQuality()` — which collapses to the literal 'auto' whenever mode is
   * auto — this reflects what is actually on screen even while auto-ABR (or a
   * density restriction) has pre-empted the active level. Returns `null` when the
   * active rendition is unknown or carries no kind.
   */
  public getActiveRenditionKind(): 'main' | 'sub' | null {
    const activeId = this.source.getActiveId();
    const level = this.source.getLevels().find(l => l.id === activeId);
    if (level?.kind === 'main' || level?.kind === 'sub') {
      return level.kind;
    }
    return null;
  }

  public setMaxQualityKind(kind: 'main' | 'sub' | null): void {
    if (this.maxAllowedKind !== kind) {
      this.logger.info(`ABR density limit restriction changed to: ${kind}`);
      this.maxAllowedKind = kind;
      this.downDwellStartTime = null;
      this.upDwellStartTime = null;

      // Apply the restriction immediately regardless of mode. This is a hard
      // ceiling (e.g. grid density limiting) and must be enforced in manual
      // mode too — clearing/raising the ceiling is a no-op here since
      // evaluateRestriction() only ever forces a DOWN-switch when the active
      // level violates the (new, non-null) restriction.
      this.evaluateRestriction();
    }
  }

  public reportSignals(signals: StreamSignals, isLive = false): void {
    if (this.mode !== 'auto') {
      return;
    }

    const now = performance.now();
    if (this.switching || now - this.lastAttemptTime < this.cooldownMs) {
      return; // Inside cooldown period
    }

    const levels = this.source.getLevels().filter(level => level.id !== 'auto');
    const current = levels.find(level => level.id === this.source.getActiveId());
    if (levels.length < 2 || !current || this.evaluateRestriction()) return;

    // Visual preference and decode cost follow geometry/role. Network pressure
    // uses bitrate independently: an HD substream can cost more bandwidth than 4K.
    levels.sort(comparePictureQuality);
    const position = levels.indexOf(current);
    const allowed = (level: QualityLevel) => !(this.maxAllowedKind === 'sub' && level.kind === 'main');
    const lowerPicture = levels.slice(position + 1).filter(allowed);
    const bandwidth = signals.receiverNetwork
      ? signals.receiverNetwork.capacityKbps ?? 0 : signals.throughputKbps;
    const loss = signals.receiverNetwork?.lossRatio;
    const lowBandwidth = !!current.bitrateKbps && bandwidth > 0 && bandwidth < current.bitrateKbps * this.safetyFactor;
    const packetLoss = loss !== undefined && loss >= 0.05;
    const targetFps = Math.min(signals.targetFps, current.fps ?? Infinity);

    let reason = '';
    if (signals.droppedFps > this.droppedFpsThreshold) {
      reason = `High frame drops: ${signals.droppedFps} FPS`;
    } else if (signals.decoderReady && signals.effectiveFps < targetFps * this.fpsRatioThreshold) {
      reason = `Low rendering FPS: ${signals.effectiveFps}/${targetFps}`;
    } else if (!isLive && signals.decoderReady && signals.avgQueueLen < this.queueStarvationThreshold) {
      reason = `Frame queue starvation: avg len ${signals.avgQueueLen}`;
    }
    const playbackPressure = !!reason;
    if (!reason && packetLoss) reason = `RTP packet loss: ${(loss * 100).toFixed(1)}%`;
    if (!reason && lowBandwidth) reason = `Insufficient bandwidth: ${bandwidth.toFixed(0)} Kbps`;

    if (reason) {
      this.upDwellStartTime = null;
      this.downDwellStartTime ??= now;
      if (now - this.downDwellStartTime < this.downDwellMs) return;
      let candidates = playbackPressure ? lowerPicture : levels.filter(allowed);
      if (lowBandwidth || packetLoss) {
        if (current.bitrateKbps) {
          const currentRate = current.bitrateKbps;
          candidates = candidates.filter(level => level.bitrateKbps && level.bitrateKbps < currentRate)
            .sort((a, b) => b.bitrateKbps! - a.bitrateKbps!);
        } else {
          // An explicitly configured lower RTP profile can be tried on packet loss.
          candidates = lowerPicture;
        }
      }
      if (playbackPressure && bandwidth > 0 && current.bitrateKbps) {
        const currentRate = current.bitrateKbps;
        candidates = candidates.filter(level => !level.bitrateKbps || level.bitrateKbps <= currentRate ||
          level.bitrateKbps * this.safetyFactor <= bandwidth);
      }
      if (candidates[0]) this.switchQuality(candidates[0].id, `Down-switch: ${reason}`);
      return;
    }
    this.downDwellStartTime = null;

    const next = levels.slice(0, position).reverse().find(allowed);
    const healthyReception = !signals.receiverNetwork || (loss !== undefined && loss <= 0.01);
    if (next?.bitrateKbps && bandwidth >= next.bitrateKbps * this.upHeadroomFactor &&
        signals.decoderReady && signals.droppedFps === 0 && healthyReception) {
      this.upDwellStartTime ??= now;
      if (now - this.upDwellStartTime >= this.upDwellMs) {
        this.switchQuality(next.id, `Up-switch: Bandwidth ${bandwidth.toFixed(0)} Kbps`);
      }
    } else {
      this.upDwellStartTime = null;
    }
  }

  public getDiagnostics() {
    return {
      mode: this.mode,
      maxAllowedKind: this.maxAllowedKind,
      lastSwitchReason: this.lastSwitchReason,
      lastSwitchTime: this.lastSwitchTime,
    };
  }

  /**
   * Forces a down-switch if the active level violates the density limit restriction.
   * Returns true if a switch was performed or is pending (cooldown active).
   *
   * Only ever forces DOWN: a violation means the active kind exceeds the
   * ceiling ('main' while maxAllowedKind is 'sub'). Since 'main'/'sub' is the
   * only ordering, that is equivalent to `maxAllowedKind === 'sub' && currentLevel.kind === 'main'`.
   * This must NOT trigger merely because the active kind differs from the
   * ceiling — e.g. raising the ceiling from 'sub' to 'main' while 'sub' is
   * active must leave the current manual selection alone (no forced up-switch).
   */
  private evaluateRestriction(): boolean {
    if (!this.maxAllowedKind) return false;

    const levels = this.getSortedLevels();
    const activeId = this.source.getActiveId();
    const activeIndex = levels.findIndex(l => l.id === activeId);
    if (activeIndex === -1) return false;

    const currentLevel = levels[activeIndex];
    const exceedsCeiling = this.maxAllowedKind === 'sub' && currentLevel.kind === 'main';
    if (exceedsCeiling) {
      // Find the highest available quality level that conforms to the restriction
      const conformingLevel = levels.find(l => l.kind === this.maxAllowedKind || !l.kind);
      if (conformingLevel && conformingLevel.id !== activeId) {
        this.switchQuality(conformingLevel.id, `Force conform to restriction: max kind ${this.maxAllowedKind}`);
        return true;
      }
    }
    return false;
  }

  private switchQuality(id: string, reason: string): void {
    if (this.switching) return;
    this.logger.info(`[QualityController] Switching quality to ${id}. Reason: ${reason}`);
    this.lastAttemptTime = performance.now();
    this.downDwellStartTime = null;
    this.upDwellStartTime = null;
    const confirm = () => {
      this.switching = false;
      if (this.source.getActiveId() !== id) return;
      this.lastSwitchTime = performance.now();
      this.lastSwitchReason = reason;
      this.onQualitySwitch?.(id, reason);
      this.evaluateRestriction();
    };
    const failed = (error: unknown) => {
      this.switching = false;
      this.logger.error(`[QualityController] Failed to switch quality to ${id}:`, error);
    };

    this.switching = true;
    try {
      const result = this.source.switchQuality(id);
      if (result) void result.then(confirm, failed);
      else confirm();
    } catch (error) {
      failed(error);
    }
  }

  /**
   * Returns quality levels sorted by bitrate descending (highest first).
   * Filters out any 'auto' levels.
   */
  private getSortedLevels(): QualityLevel[] {
    return this.source.getLevels()
      .filter(l => l.id !== 'auto')
      .sort((a, b) => (b.bitrateKbps || 0) - (a.bitrateKbps || 0));
  }
}

function comparePictureQuality(a: QualityLevel, b: QualityLevel): number {
  if (a.width && a.height && b.width && b.height) {
    const pixels = b.width * b.height - a.width * a.height;
    if (pixels) return pixels;
  }
  if (a.kind === 'main' && b.kind === 'sub') return -1;
  if (a.kind === 'sub' && b.kind === 'main') return 1;
  return (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0);
}
