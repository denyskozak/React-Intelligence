import { Component, type ErrorInfo, type ReactNode, Profiler, useEffect } from "react";
import { captureProfilerCommit, captureReactError, cleanupReactIntelligence, configureReactIntelligence } from "./runtime";
import type { ReactIntelligenceProviderProps } from "./types";

class ReactIntelligenceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureReactError(error, { componentStack: errorInfo.componentStack ?? undefined });
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function ReactIntelligenceProvider({ children, ...options }: ReactIntelligenceProviderProps) {
  useEffect(() => {
    configureReactIntelligence(options);
    return cleanupReactIntelligence;
  }, [
    options.appId,
    options.endpoint,
    options.environment,
    options.release,
    options.userId,
    options.captureConsole,
    options.captureNetwork,
    options.capturePerformance,
    options.captureUserActions,
    options.sampleRate,
    options.scrubText
  ]);

  return (
    <ReactIntelligenceErrorBoundary>
      <Profiler
        id="ReactApp"
        onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
          captureProfilerCommit({ id, phase, actualDuration, baseDuration, startTime, commitTime });
        }}
      >
        {children}
      </Profiler>
    </ReactIntelligenceErrorBoundary>
  );
}
