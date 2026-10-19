import React, { Component } from "react";

interface State {
  hasError: boolean;
  message: string;
}

type Props = { children: React.ReactNode };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };
  props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("[UI ErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">!</div>
          <h2 className="text-lg font-black text-ink">Algo ha ido mal en esta pantalla</h2>
          <p className="mt-2 text-sm text-ink-muted">La terminal sigue activa. Puedes recargar para recuperar el estado del servidor.</p>
          <p className="mt-2 break-words font-mono text-[11px] text-ink-muted">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-xl bg-olive px-4 py-3 text-sm font-bold text-white"
          >
            Recargar terminal
          </button>
        </div>
      </div>
    );
  }
}
