// If a screen crashes, show what happened and a way out instead of a blank
// page (A-047). Used twice: around each screen inside the layout (the menu
// keeps working, and moving to another page resets it), and around the
// whole app as a last resort.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When this changes (e.g. the page address), the boundary tries again. */
  resetKey?: string
  /** The outermost boundary has no router, so it links home with a plain link. */
  whole?: boolean
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <section className={`crash${this.props.whole ? ' crash-whole' : ''}`} role="alert">
        <h1>Something went wrong</h1>
        <p>This page couldn't be shown. Nothing you saved before this is lost.</p>
        <p className="muted small">Reload to try again. If it keeps happening, tell the Managing Director what you were doing, and include the details below.</p>
        <div className="form-actions">
          <button className="primary" onClick={() => window.location.reload()}>Reload</button>
          <a className="button-link" href="/">Go to your home screen</a>
        </div>
        <details>
          <summary className="small">Details for the Managing Director</summary>
          <pre className="small">{`${window.location.pathname}${window.location.search}\n${error.name}: ${error.message}`}</pre>
        </details>
      </section>
    )
  }
}
