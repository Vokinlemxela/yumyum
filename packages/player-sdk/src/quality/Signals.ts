export interface ReceiverNetworkSample {
  /** Fraction of lost video RTP packets in the most recent interval. */
  lossRatio?: number;
  /** ICE receiver-side bandwidth estimate, when available. */
  capacityKbps?: number;
}

export interface StreamSignals {
  /** Present for paced RTP. Its delivered bitrate does not estimate link capacity. */
  receiverNetwork?: ReceiverNetworkSample;
  throughputKbps: number;
  throughputSamples: number;
  droppedFps: number;
  effectiveFps: number;
  targetFps: number;
  avgQueueLen: number;
  decoderReady: boolean;
  ts: number;
}
