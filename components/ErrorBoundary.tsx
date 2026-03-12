'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { isAbortError } from '@/lib/http'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; reset: () => void }>
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    if (isAbortError(error)) {
      return { hasError: false, error: null }
    }
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (isAbortError(error)) return
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    // You can log the error to an error reporting service here
    // logErrorToService(error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback
      return <FallbackComponent error={this.state.error} reset={this.reset} />
    }

    return this.props.children
  }
}

function DefaultErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
          <svg
            className="w-6 h-6 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        
        <h2 className="text-xl font-semibold text-center text-gray-900 mb-2">
          Something went wrong
        </h2>
        
        <p className="text-gray-600 text-center mb-6">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        
        <div className="space-y-3">
          <Button
            onClick={reset}
            className="w-full"
            variant="default"
          >
            Try again
          </Button>
          
          <Button
            onClick={() => window.location.reload()}
            className="w-full"
            variant="outline"
          >
            Reload page
          </Button>
        </div>
        
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 p-4 bg-gray-100 rounded text-sm">
            <summary className="cursor-pointer font-medium mb-2">
              Error details (development only)
            </summary>
            <pre className="whitespace-pre-wrap text-xs text-red-600">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export default ErrorBoundary
