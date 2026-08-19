import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error?: Error;
}

export class DashboardErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dashboard render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" className="card flex min-h-64 flex-col items-center justify-center p-8 text-center">
      <p className="text-xl font-semibold">This view could not be rendered</p>
      <p className="mt-2 max-w-xl text-sm text-muted">{this.state.error.message}</p>
      <button onClick={() => window.location.reload()} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink">Reload dashboard</button>
    </div>;
  }
}
