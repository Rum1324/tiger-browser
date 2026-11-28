import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface FallbackProps {
  error: Error
  /** Draw the children again (the state that crashed may have changed). */
  retry(): void
}

/**
 * Catches a render error in one region so the rest of the chrome keeps working (a broken ask panel
 * must not take the address field with it). `name` labels the region in the log line.
 */
export class ErrorBoundary extends Component<
  {
    name: string
    fallback: (p: FallbackProps) => ReactNode
    children: ReactNode
    onError?: (e: Error, region: string) => void
  },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, this.props.name)
    // The message and component stack only: no page content or member data is in either.
    console.error(`[tiger-ui] ${this.props.name}: ${error.message}`, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error) return this.props.fallback({ error, retry: () => this.setState({ error: null }) })
    return this.props.children
  }
}
