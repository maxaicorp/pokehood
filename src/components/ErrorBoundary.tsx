import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary. Without this, a single thrown render anywhere in
 * the tree (a malformed price object, a bad image URL crashing a parent, etc.)
 * blanks the entire page with no message and no recovery short of a hard
 * refresh. This catches the throw and shows a recoverable fallback.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surface to the console for debugging; a real logging sink can hook here.
    console.error("Uncaught render error:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display font-bold text-xl text-foreground">Something went wrong</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          onClick={this.handleReload}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Reload page
        </button>
      </div>
    );
  }
}
