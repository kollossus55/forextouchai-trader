import React from 'react';

export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[PageErrorBoundary]', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-2xl mx-auto mt-16 p-6 rounded-xl bg-slate-900 border border-rose-500/30 text-slate-100">
          <h2 className="text-xl font-bold text-rose-400 mb-2">This page hit an error</h2>
          <p className="text-sm text-slate-400 mb-4">
            The rest of the app is still working. Reload the page to try again.
          </p>
          <pre className="text-xs bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto mb-4 whitespace-pre-wrap break-all">
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              Reload page
            </button>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}