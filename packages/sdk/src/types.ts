import type { ReactNode } from "react";

export interface ReactIntelligenceOptions {
  appId: string;
  endpoint: string;
  writeKey?: string;
  processingMode?: "local" | "remote";
  environment?: string;
  release?: string;
  userId?: string;
  captureConsole?: boolean;
  captureNetwork?: boolean;
  captureUserActions?: boolean;
  capturePerformance?: boolean;
  sampleRate?: number;
  scrubText?: boolean;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  /** Persist the scrubbed pending queue in this origin so short offline periods do not lose telemetry. */
  persistOfflineEvents?: boolean;
}

export interface ReactIntelligenceProviderProps extends ReactIntelligenceOptions {
  children: ReactNode;
  profileRoot?: boolean;
}

export interface IntelligenceProfilerProps {
  id: string;
  children: ReactNode;
}
