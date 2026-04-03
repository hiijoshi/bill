import { cn } from '@/lib/utils'

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

function LoaderMark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none flex items-center justify-center',
        compact ? 'h-10 w-10' : 'h-14 w-14'
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 88 88"
        className={cn(compact ? 'h-9 w-9' : 'h-12 w-12')}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M18 20L69 22"
          stroke="#0F2B4A"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M18 68L69 70"
          stroke="#0F2B4A"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M26 24C29 35 34 39 39 44C34 50 29 54 26 64"
          stroke="#0F2B4A"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M61 24C58 35 53 39 48 44C53 50 58 54 61 64"
          stroke="#0F2B4A"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M39 49C42 44 47 43 51 46C55 49 55 55 50 57C45 59 38 57 37 52C36 51 37 50 39 49Z"
          fill="#FF6F7C"
        />
      </svg>
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
