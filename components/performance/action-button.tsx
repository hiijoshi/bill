'use client'

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'

type ActionButtonState = 'idle' | 'loading' | 'success' | 'error'

type ActionButtonProps = Omit<ComponentProps<typeof Button>, 'children'> & {
  idleLabel: string
  loadingLabel?: string
  successLabel?: string
  errorLabel?: string
  state?: ActionButtonState
}

export function ActionButton({
  idleLabel,
  loadingLabel = 'Saving...',
  successLabel,
  errorLabel,
  state = 'idle',
  disabled,
  ...props
}: ActionButtonProps) {
  const effectiveDisabled = disabled || state === 'loading'

  return (
    <Button {...props} disabled={effectiveDisabled}>
      {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {state === 'success' ? <CheckCircle2 className="h-4 w-4" /> : null}
      {state === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
      {state === 'loading'
        ? loadingLabel
        : state === 'success'
          ? successLabel || idleLabel
          : state === 'error'
            ? errorLabel || idleLabel
            : idleLabel}
    </Button>
  )
}
