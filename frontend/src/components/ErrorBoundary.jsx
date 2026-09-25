import { Component } from "react";

/**
 * Keeps a rendering error in one view from blanking the whole page, and shows what broke so a
 * reader (often on a phone, with no console) can screenshot it. ``resetKey`` clears the error
 * when the reader moves to another view or address.
 */
export default class ErrorBoundary extends Component {
  state = { error: null, key: undefined };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error" role="alert">
        <b>Something went wrong showing this page.</b>
        <div style={{ margin: "6px 0 10px", overflowWrap: "anywhere" }}>{String(error?.message || error)}</div>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
