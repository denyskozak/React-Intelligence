import type { ReactNode } from "react";

export interface ReactIntelligenceOptions {
  appId: string;
  endpoint: string;
  environment?: string;
  release?: string;
  userId?: string;
  captureConsole?: boolean;
  captureNetwork?: boolean;
  captureUserActions?: boolean;
  capturePerformance?: boolean;
  sampleRate?: number;
  scrubText?: boolean;
}

export interface ReactIntelligenceProviderProps extends ReactIntelligenceOptions {
  children: ReactNode;
}
