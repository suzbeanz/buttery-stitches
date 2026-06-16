import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render/runtime errors anywhere below it so a single failing component
 * can never blank the whole app. Shows a friendly, recoverable message (with the
 * error text, so problems are diagnosable) instead of an empty screen.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it for debugging without taking the UI down.
    console.error("Buttery Stitches hit an error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-cream p-6 text-center text-navy">
        <div className="text-4xl" aria-hidden>
          🧈
        </div>
        <h1 className="font-label uppercase tracking-[0.08em] text-2xl font-semibold">
          Something hiccuped
        </h1>
        <p className="max-w-md text-sm text-navy/70">
          The app ran into a problem, but your design is safe in memory. Reload to
          pick up where you left off.
        </p>
        <pre className="max-w-md overflow-auto rounded-sm border-2 border-ink/15 bg-butter-50 p-3 text-left text-xs text-navy/60">
          {error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="rounded-sm border-2 border-ink bg-ink px-6 py-2.5 font-label text-sm font-semibold uppercase tracking-[0.1em] text-cream shadow-press-sm transition-transform hover:bg-ink-deep active:translate-y-[2px] active:shadow-none"
        >
          Reload
        </button>
      </div>
    );
  }
}
