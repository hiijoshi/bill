import { cn } from '@/lib/utils'
import type { CSSProperties } from 'react'

export type TaskLoaderKind =
  | 'dashboard'
  | 'reports'
  | 'payment'
  | 'journal'
  | 'bank'
  | 'transfer'
  | 'purchase'
  | 'sales'
  | 'master'
  | 'stock'
  | 'access'
  | 'print'

type LoaderTheme = {
  label: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: { label: 'Loading dashboard' },
  reports: { label: 'Loading reports' },
  payment: { label: 'Loading payment' },
  journal: { label: 'Loading journal' },
  bank: { label: 'Loading bank' },
  transfer: { label: 'Loading transfer' },
  purchase: { label: 'Loading purchase' },
  sales: { label: 'Loading sales' },
  master: { label: 'Loading master' },
  stock: { label: 'Loading stock' },
  access: { label: 'Loading' },
  print: { label: 'Loading print' }
}

type TaskLoaderProps = {
  kind: TaskLoaderKind
  title?: string
  message?: string
  className?: string
  fullscreen?: boolean
  compact?: boolean
}

const DOT_POSITIONS = [
  { x: '52%', y: '18%', delay: '0s' },
  { x: '24%', y: '48%', delay: '0.12s' },
  { x: '74%', y: '40%', delay: '0.24s' },
  { x: '42%', y: '76%', delay: '0.36s' },
  { x: '68%', y: '72%', delay: '0.48s' }
] as const

export function LoaderMark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none flex items-center justify-center',
        compact ? 'h-10 w-10' : 'h-14 w-14'
      )}
      aria-hidden="true"
    >
      <div className={cn('relative', compact ? 'h-8 w-8' : 'h-10 w-10')}>
        {DOT_POSITIONS.map((dot, index) => (
          <span
            key={index}
            className={cn(
              'task-loader-dot absolute rounded-full bg-slate-950/85',
              compact ? 'h-2.5 w-2.5' : 'h-3 w-3'
            )}
            style={
              {
                '--loader-x': dot.x,
                '--loader-y': dot.y,
                animationDelay: dot.delay
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

export function TaskLoader({ kind, title, message, className, fullscreen = false, compact = false }: TaskLoaderProps) {
  const theme = LOADER_THEMES[kind]
  const label = title || message || theme.label

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'flex w-full items-center justify-center px-4',
        fullscreen ? 'min-h-screen py-8' : compact ? 'min-h-[104px] py-4' : 'min-h-[132px] py-5',
        className
      )}
    >
      <LoaderMark compact={compact} />
    </div>
  )
}
