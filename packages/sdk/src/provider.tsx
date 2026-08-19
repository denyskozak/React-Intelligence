import { Component, type ErrorInfo, type ReactNode, Profiler, useEffect } from "react";
import { captureProfilerCommit, captureReactError, cleanupReactIntelligence, configureReactIntelligence } from "./runtime";
import type { IntelligenceProfilerProps, ReactIntelligenceProviderProps } from "./types";

export class ReactIntelligenceErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureReactError(error, { componentStack: errorInfo.componentStack ?? undefined });
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

export function ReactIntelligenceProvider({ children, profileRoot = false, ...options }: ReactIntelligenceProviderProps) {
  useEffect(() => {
    configureReactIntelligence(options);
    return cleanupReactIntelligence;
  }, [
    options.appId,
    options.endpoint,
    options.writeKey,
    options.processingMode,
    options.environment,
    options.release,
    options.userId,
    options.captureConsole,
    options.captureNetwork,
    options.capturePerformance,
    options.captureUserActions,
    options.sampleRate,
    options.scrubText,
    options.maxQueueSize,
    options.flushIntervalMs,
    options.persistOfflineEvents
  ]);

  return profileRoot ? <IntelligenceProfiler id="ReactApp">{children}</IntelligenceProfiler> : children;
}

export function IntelligenceProfiler({ id, children }: IntelligenceProfilerProps) {
  return (
    <Profiler
      id={id}
      onRender={(profilerId, phase, actualDuration, baseDuration, startTime, commitTime) => {
        captureProfilerCommit({ id: profilerId, phase, actualDuration, baseDuration, startTime, commitTime });
      }}
    >
      {children}
    </Profiler>
  );
}
