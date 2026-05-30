import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  // When provided, a thrown child renders this compact fallback INSTEAD of the
  // full-page one — used to isolate a single widget (chart, grid) so its crash
  // doesn't blank the whole route. A string is rendered as muted text.
  fallback?: ReactNode;
  // Optional label for the console log so we can tell which boundary caught it.
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary. At the top level it prevents a single thrown render anywhere
 * (a malformed price, a bad image crashing a parent) from blanking the entire
 * app. With a `fallback` it scopes the blast radius to one widget.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surface to the console for debugging; a real logging sink can hook here.
    console.error(`Uncaught render error${this.props.label ? ` [${this.props.label}]` : ""}:`, error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Scoped fallback: render the widget-level fallback in place, no reload.
    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === "string" ? (
        <div className="p-4 text-center text-sm text-muted-foreground">{this.props.fallback}</div>
      ) : (
        this.props.fallback
      );
    }

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
