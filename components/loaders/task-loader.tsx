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
  eyebrow: string
  accentClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: { label: 'Loading dashboard', eyebrow: 'Dashboard', accentClassName: 'from-sky-500 to-cyan-500' },
  reports: { label: 'Loading reports', eyebrow: 'Reports', accentClassName: 'from-amber-500 to-orange-500' },
  payment: { label: 'Loading payment', eyebrow: 'Payment', accentClassName: 'from-emerald-500 to-teal-500' },
  journal: { label: 'Loading journal', eyebrow: 'Journal', accentClassName: 'from-rose-500 to-orange-500' },
  bank: { label: 'Loading bank', eyebrow: 'Bank', accentClassName: 'from-cyan-500 to-blue-600' },
  transfer: { label: 'Loading transfer', eyebrow: 'Transfer', accentClassName: 'from-indigo-500 to-cyan-500' },
  purchase: { label: 'Loading purchase', eyebrow: 'Purchase', accentClassName: 'from-rose-500 to-amber-500' },
  sales: { label: 'Loading sales', eyebrow: 'Sales', accentClassName: 'from-fuchsia-500 to-orange-500' },
  master: { label: 'Loading master', eyebrow: 'Master', accentClassName: 'from-slate-600 to-zinc-500' },
  stock: { label: 'Loading stock', eyebrow: 'Stock', accentClassName: 'from-lime-500 to-emerald-500' },
  access: { label: 'Loading', eyebrow: 'Access', accentClassName: 'from-blue-500 to-violet-500' },
  print: { label: 'Loading print', eyebrow: 'Print', accentClassName: 'from-stone-500 to-slate-500' }
}

type TaskLoaderProps = {
  kind: TaskLoaderKind
  title?: string
  message?: string
  className?: string
  fullscreen?: boolean
  compact?: boolean
}

function LoaderMark({
  compact = false,
  accentClassName,
  eyebrow
}: {
  compact?: boolean
  accentClassName: string
  eyebrow: string
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.24)]',
        compact ? 'h-12 w-12 p-1.5' : 'h-14 w-14 p-2'
      )}
      aria-hidden="true"
    >
      <div className={cn('flex h-full w-full items-center justify-center rounded-[16px] bg-gradient-to-br text-white', accentClassName)}>
        <span className={cn('font-semibold tracking-[0.24em]', compact ? 'text-[9px]' : 'text-[10px]')}>
          {eyebrow.slice(0, 2).toUpperCase()}
        </span>
      </div>
    </div>
  )
}

export function TaskLoader({ kind, title, message, className, fullscreen = false, compact = false }: TaskLoaderProps) {
  const theme = LOADER_THEMES[kind]
  const label = title || message || theme.label
  const description = message && title && message !== title ? message : ''

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full items-center justify-center px-4',
        fullscreen ? 'min-h-screen py-8' : compact ? 'min-h-[104px] py-4' : 'min-h-[132px] py-5',
        className
      )}
    >
      <div
        className={cn(
          'inline-flex items-center gap-3 rounded-[26px] border border-slate-200/80 bg-white/95 px-4 py-3 text-left shadow-[0_24px_60px_-42px_rgba(15,23,42,0.28)] backdrop-blur-sm',
          compact ? 'max-w-[220px]' : 'max-w-[320px]'
        )}
      >
        <LoaderMark compact={compact} accentClassName={theme.accentClassName} eyebrow={theme.eyebrow} />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            {theme.eyebrow}
          </div>
          <div className="truncate text-sm font-semibold text-slate-800">{label}</div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full bg-gradient-to-br', theme.accentClassName)} />
            <span className="text-xs text-slate-500">{description || 'Please wait a moment'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
