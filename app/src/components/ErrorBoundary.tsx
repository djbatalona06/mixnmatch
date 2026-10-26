// If a screen crashes, show a way out instead of a blank page.
import { Component, type ReactNode } from "react";
import { buttonClass } from "./ui";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto mt-24 max-w-md space-y-4 px-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted">Your transfers keep running on our server. Reload to get back to them.</p>
        <a href="/dashboard" className={buttonClass("primary")}>
          Reload
        </a>
      </div>
    );
  }
}
