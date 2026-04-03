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
  accentClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: { label: 'Loading dashboard', accentClassName: 'from-sky-500 to-cyan-500' },
  reports: { label: 'Loading reports', accentClassName: 'from-amber-500 to-orange-500' },
  payment: { label: 'Loading payment', accentClassName: 'from-emerald-500 to-teal-500' },
  journal: { label: 'Loading journal', accentClassName: 'from-rose-500 to-orange-500' },
  bank: { label: 'Loading bank', accentClassName: 'from-cyan-500 to-blue-600' },
  transfer: { label: 'Loading transfer', accentClassName: 'from-indigo-500 to-cyan-500' },
  purchase: { label: 'Loading purchase', accentClassName: 'from-rose-500 to-amber-500' },
  sales: { label: 'Loading sales', accentClassName: 'from-fuchsia-500 to-orange-500' },
  master: { label: 'Loading master', accentClassName: 'from-slate-600 to-zinc-500' },
  stock: { label: 'Loading stock', accentClassName: 'from-lime-500 to-emerald-500' },
  access: { label: 'Loading', accentClassName: 'from-blue-500 to-violet-500' },
  print: { label: 'Loading print', accentClassName: 'from-stone-500 to-slate-500' }
}

type TaskLoaderProps = {
  kind: TaskLoaderKind
  title?: string
  message?: string
  className?: string
  fullscreen?: boolean
  compact?: boolean
}

function LoaderVideo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_20px_48px_-36px_rgba(15,23,42,0.28)]',
        compact ? 'h-16 w-16 p-1.5' : 'h-20 w-20 p-2'
      )}
    >
      <video
        className="project-loader-video h-full w-full object-contain"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/loaders/billing-loader.webm" type="video/webm" />
        <source src="/loaders/billing-loader.mp4" type="video/mp4" />
      </video>
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
      className={cn(
        'flex w-full items-center justify-center px-4',
        fullscreen ? 'min-h-screen py-8' : compact ? 'min-h-[120px] py-4' : 'min-h-[160px] py-5',
        className
      )}
    >
      <div className="inline-flex flex-col items-center gap-3 text-center">
        <LoaderVideo compact={compact} />
        <div className="space-y-1">
          <div className="text-sm font-medium text-slate-700">{label}</div>
          <div className={cn('mx-auto h-1 w-14 rounded-full bg-gradient-to-r', theme.accentClassName)} />
        </div>
      </div>
    </div>
  )
}
