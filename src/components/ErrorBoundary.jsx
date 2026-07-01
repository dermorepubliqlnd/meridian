import { Component } from "react";

// Safety net so a bug in one page (e.g. reading a field before data has
// loaded) shows a recoverable message instead of a blank white screen with
// a dead back button. Added 2026-07-01 after that exact failure mode hit
// Project Detail twice.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Meridian crashed:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 max-w-sm text-center">
            <p className="text-sm font-medium text-navy mb-1">Something went wrong.</p>
            <p className="text-xs text-gray-500 mb-4">
              This page hit an unexpected error. Your data is safe — try going back to the dashboard.
            </p>
            <button
              onClick={this.handleReload}
              className="bg-navy text-white text-xs font-medium px-3 py-1.5 rounded-md hover:bg-navy-light"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
