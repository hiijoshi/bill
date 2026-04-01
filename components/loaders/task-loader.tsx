import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  BookCopy,
  Boxes,
  CreditCard,
  FileClock,
  Landmark,
  Printer,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  ShoppingCart
} from 'lucide-react'

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

type LoaderMotion = 'dashboard' | 'orbit' | 'stream' | 'ticker' | 'matrix'

type LoaderTheme = {
  eyebrow: string
  title: string
  message: string
  icon: LucideIcon
  chips: string[]
  motion: LoaderMotion
  glowClassName: string
  panelClassName: string
  solidAccentClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: {
    eyebrow: 'Business Overview',
    title: 'Preparing dashboard',
    message: 'Stacking sales, purchase, stock, and payment insights for the selected company.',
    icon: BarChart3,
    chips: ['Sales pulse', 'Stock scan', 'Cash flow'],
    motion: 'dashboard',
    glowClassName: 'from-sky-500/20 via-blue-500/12 to-cyan-400/12',
    panelClassName: 'from-sky-50 via-white to-cyan-50',
    solidAccentClassName: 'from-sky-500 via-blue-600 to-cyan-500'
  },
  reports: {
    eyebrow: 'Report Workspace',
    title: 'Building reports',
    message: 'Arranging filters, balances, ledgers, and export-ready summaries.',
    icon: FileClock,
    chips: ['Filters', 'Summaries', 'Exports'],
    motion: 'ticker',
    glowClassName: 'from-amber-500/20 via-orange-500/12 to-yellow-400/12',
    panelClassName: 'from-amber-50 via-white to-orange-50',
    solidAccentClassName: 'from-amber-400 via-orange-500 to-yellow-500'
  },
  payment: {
    eyebrow: 'Payment Desk',
    title: 'Loading payment data',
    message: 'Matching settlements, payment modes, and bill history.',
    icon: CreditCard,
    chips: ['Bills', 'Modes', 'History'],
    motion: 'orbit',
    glowClassName: 'from-emerald-500/20 via-teal-500/12 to-cyan-400/12',
    panelClassName: 'from-emerald-50 via-white to-teal-50',
    solidAccentClassName: 'from-emerald-500 via-teal-500 to-cyan-500'
  },
  journal: {
    eyebrow: 'Journal Voucher',
    title: 'Preparing ledger rows',
    message: 'Bringing account heads, parties, banks, and balance controls together.',
    icon: BookCopy,
    chips: ['Ledgers', 'Debit', 'Credit'],
    motion: 'matrix',
    glowClassName: 'from-violet-500/20 via-fuchsia-500/12 to-pink-400/12',
    panelClassName: 'from-violet-50 via-white to-fuchsia-50',
    solidAccentClassName: 'from-violet-500 via-fuchsia-500 to-pink-500'
  },
  bank: {
    eyebrow: 'Bank Workspace',
    title: 'Reading bank entries',
    message: 'Collecting bank accounts, uploaded statements, and settlement matches.',
    icon: Landmark,
    chips: ['Accounts', 'Statements', 'Settlement'],
    motion: 'orbit',
    glowClassName: 'from-cyan-500/20 via-sky-500/12 to-blue-400/12',
    panelClassName: 'from-cyan-50 via-white to-sky-50',
    solidAccentClassName: 'from-cyan-500 via-sky-500 to-blue-600'
  },
  transfer: {
    eyebrow: 'Internal Transfer',
    title: 'Preparing transfer desk',
    message: 'Bringing cash and bank accounts into one clean transfer flow.',
    icon: RefreshCcw,
    chips: ['From', 'To', 'Reconcile'],
    motion: 'stream',
    glowClassName: 'from-indigo-500/20 via-blue-500/12 to-cyan-400/12',
    panelClassName: 'from-indigo-50 via-white to-blue-50',
    solidAccentClassName: 'from-indigo-500 via-blue-500 to-cyan-500'
  },
  purchase: {
    eyebrow: 'Purchase Flow',
    title: 'Loading purchase workspace',
    message: 'Arranging farmers, products, mandi charges, and bill details.',
    icon: ShoppingCart,
    chips: ['Farmer', 'Mandi', 'Billing'],
    motion: 'stream',
    glowClassName: 'from-rose-500/20 via-orange-500/12 to-amber-400/12',
    panelClassName: 'from-rose-50 via-white to-orange-50',
    solidAccentClassName: 'from-rose-500 via-orange-500 to-amber-500'
  },
  sales: {
    eyebrow: 'Sales Flow',
    title: 'Preparing sales screen',
    message: 'Gathering parties, stock items, taxes, and invoice totals.',
    icon: Receipt,
    chips: ['Party', 'Invoice', 'Dispatch'],
    motion: 'ticker',
    glowClassName: 'from-fuchsia-500/20 via-rose-500/12 to-orange-400/12',
    panelClassName: 'from-fuchsia-50 via-white to-rose-50',
    solidAccentClassName: 'from-fuchsia-500 via-rose-500 to-orange-500'
  },
  master: {
    eyebrow: 'Master Setup',
    title: 'Syncing master records',
    message: 'Fetching companies, master values, and configuration controls.',
    icon: BookCopy,
    chips: ['Masters', 'Setup', 'Lookup'],
    motion: 'matrix',
    glowClassName: 'from-slate-500/20 via-zinc-500/12 to-neutral-400/12',
    panelClassName: 'from-slate-50 via-white to-zinc-50',
    solidAccentClassName: 'from-slate-500 via-zinc-500 to-neutral-500'
  },
  stock: {
    eyebrow: 'Stock Control',
    title: 'Scanning stock position',
    message: 'Counting movements, balances, and inventory attention points.',
    icon: Boxes,
    chips: ['Movement', 'Balance', 'Alerts'],
    motion: 'ticker',
    glowClassName: 'from-lime-500/20 via-emerald-500/12 to-teal-400/12',
    panelClassName: 'from-lime-50 via-white to-emerald-50',
    solidAccentClassName: 'from-lime-500 via-emerald-500 to-teal-500'
  },
  access: {
    eyebrow: 'Security Check',
    title: 'Checking access',
    message: 'Verifying permission matrix and allowed company scope.',
    icon: ShieldCheck,
    chips: ['User', 'Company', 'Privileges'],
    motion: 'orbit',
    glowClassName: 'from-blue-500/20 via-indigo-500/12 to-violet-400/12',
    panelClassName: 'from-blue-50 via-white to-indigo-50',
    solidAccentClassName: 'from-blue-500 via-indigo-500 to-violet-500'
  },
  print: {
    eyebrow: 'Print Preview',
    title: 'Preparing print layout',
    message: 'Composing invoice pages, totals, and printable sections.',
    icon: Printer,
    chips: ['Layout', 'Pages', 'Preview'],
    motion: 'matrix',
    glowClassName: 'from-stone-500/20 via-slate-500/12 to-zinc-400/12',
    panelClassName: 'from-stone-50 via-white to-slate-50',
    solidAccentClassName: 'from-stone-500 via-slate-500 to-zinc-500'
  }
}

type TaskLoaderProps = {
  kind: TaskLoaderKind
  title?: string
  message?: string
  className?: string
  fullscreen?: boolean
  compact?: boolean
}

type SceneProps = {
  theme: LoaderTheme
}

function MotionPanel({ theme, children, className }: SceneProps & { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[30px] border border-white/70 bg-gradient-to-br p-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.2)]',
        theme.panelClassName,
        className
      )}
    >
      <div className={cn('task-loader-glow absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br blur-3xl', theme.glowClassName)} />
      <div className="task-loader-glow absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-white/75 blur-3xl" />
      {children}
    </div>
  )
}

function DashboardScene({ theme }: SceneProps) {
  const Icon = theme.icon

  return (
    <MotionPanel theme={theme} className="min-h-[260px] md:min-h-[320px]">
      <div className="absolute inset-x-5 top-5 flex flex-wrap gap-2">
        {theme.chips.map((chip, index) => (
          <span
            key={chip}
            className="task-loader-float inline-flex rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 shadow-sm"
            style={{ animationDelay: `${index * 0.15}s` }}
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-32 w-32 items-center justify-center rounded-full border border-slate-200/80 bg-white/92 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.35)]">
          <div className="task-loader-orbit absolute inset-[-10px] rounded-full border border-slate-300/70" />
          <div className="task-loader-orbit-reverse absolute inset-[-22px] rounded-full border border-slate-200/85" />
          <div className="task-loader-pulse-ring absolute inset-[-34px] rounded-full border border-white/70" />
          <div className={cn('task-loader-bob rounded-[22px] bg-gradient-to-br p-4 text-white shadow-lg', theme.solidAccentClassName)}>
            <Icon className="h-8 w-8" />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 grid gap-3 sm:grid-cols-3">
        {theme.chips.map((chip, index) => (
          <div
            key={chip}
            className="task-loader-card rounded-3xl border border-white/80 bg-white/86 p-4 shadow-sm"
            style={{ animationDelay: `${index * 0.14}s` }}
          >
            <div className="flex items-center gap-3">
              <div className={cn('h-9 w-9 rounded-2xl bg-gradient-to-br shadow-sm', theme.solidAccentClassName)} />
              <div className="min-w-0 flex-1">
                <div className="task-loader-shimmer h-2.5 w-14 rounded-full bg-slate-200" />
                <div className="mt-3 text-sm font-semibold text-slate-700">{chip}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MotionPanel>
  )
}

function OrbitScene({ theme }: SceneProps) {
  const Icon = theme.icon

  return (
    <MotionPanel theme={theme} className="min-h-[240px]">
      <div className="absolute inset-6 rounded-[26px] border border-white/65 bg-white/42" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-44 w-44">
          <div className="task-loader-orbit absolute inset-0 rounded-full border border-white/80" />
          <div className="task-loader-orbit-reverse absolute inset-[16px] rounded-full border border-white/70" />
          <div className="task-loader-pulse-ring absolute inset-[32px] rounded-full border border-slate-300/45" />

          {[
            'left-[8px] top-1/2 -translate-y-1/2',
            'right-[12px] top-[30px]',
            'bottom-[18px] left-[34px]'
          ].map((position, index) => (
            <div
              key={position}
              className={cn(
                'task-loader-satellite absolute h-4 w-4 rounded-full bg-gradient-to-br shadow-[0_0_0_8px_rgba(255,255,255,0.28)]',
                position,
                theme.solidAccentClassName
              )}
              style={{ animationDelay: `${index * 0.25}s` }}
            />
          ))}

          <div className="absolute inset-[46px] flex items-center justify-center rounded-full border border-white/80 bg-white/90 shadow-[0_18px_38px_-28px_rgba(15,23,42,0.4)]">
            <div className={cn('task-loader-bob rounded-[22px] bg-gradient-to-br p-4 text-white shadow-lg', theme.solidAccentClassName)}>
              <Icon className="h-7 w-7" />
            </div>
          </div>
        </div>
      </div>
    </MotionPanel>
  )
}

function StreamScene({ theme }: SceneProps) {
  const Icon = theme.icon

  return (
    <MotionPanel theme={theme} className="min-h-[240px]">
      <div className="absolute inset-6 rounded-[26px] border border-white/65 bg-white/45" />
      <div className="absolute left-1/2 top-10 -translate-x-1/2">
        <div className={cn('task-loader-bob flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br text-white shadow-lg', theme.solidAccentClassName)}>
          <Icon className="h-6 w-6" />
        </div>
      </div>

      <div className="absolute inset-x-10 top-[98px] h-px bg-slate-300/55" />
      <div className={cn('task-loader-stream absolute inset-x-10 top-[98px] h-px bg-gradient-to-r', theme.solidAccentClassName)} />

      <div className="absolute inset-x-10 bottom-10 grid grid-cols-3 gap-4">
        {theme.chips.map((chip, index) => (
          <div key={chip} className="relative rounded-[24px] border border-white/80 bg-white/88 px-4 py-5 shadow-sm">
            <div className={cn('task-loader-stream-dot absolute left-1/2 top-[-9px] h-4 w-4 -translate-x-1/2 rounded-full bg-gradient-to-br shadow-sm', theme.solidAccentClassName)} style={{ animationDelay: `${index * 0.18}s` }} />
            <div className="task-loader-shimmer h-2.5 w-14 rounded-full bg-slate-200" />
            <div className="mt-3 text-sm font-semibold text-slate-700">{chip}</div>
          </div>
        ))}
      </div>
    </MotionPanel>
  )
}

function TickerScene({ theme }: SceneProps) {
  const Icon = theme.icon

  return (
    <MotionPanel theme={theme} className="min-h-[240px]">
      <div className="absolute inset-6 rounded-[26px] border border-white/65 bg-white/48" />
      <div className="absolute left-6 top-6 flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br text-white', theme.solidAccentClassName)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">Live Queue</div>
      </div>

      <div className="absolute inset-x-8 bottom-9 space-y-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="relative overflow-hidden rounded-[22px] border border-white/80 bg-white/88 px-4 py-4 shadow-sm">
            <div className={cn('task-loader-ticker absolute inset-y-0 left-[-35%] w-[45%] bg-gradient-to-r opacity-90 blur-[1px]', theme.solidAccentClassName)} style={{ animationDelay: `${row * 0.25}s` }} />
            <div className="relative">
              <div className="task-loader-shimmer h-2.5 w-16 rounded-full bg-slate-200" />
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-slate-300" />
                <div className="task-loader-shimmer h-8 flex-1 rounded-2xl bg-slate-200" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </MotionPanel>
  )
}

function MatrixScene({ theme }: SceneProps) {
  const Icon = theme.icon

  return (
    <MotionPanel theme={theme} className="min-h-[240px]">
      <div className="absolute inset-6 rounded-[26px] border border-white/65 bg-white/45" />
      <div className="absolute left-1/2 top-7 -translate-x-1/2">
        <div className={cn('task-loader-bob flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br text-white shadow-lg', theme.solidAccentClassName)}>
          <Icon className="h-6 w-6" />
        </div>
      </div>

      <div className="absolute inset-x-8 bottom-8 top-24 grid grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((cell) => (
          <div
            key={cell}
            className={cn(
              'task-loader-matrix-cell rounded-[22px] border border-white/80 bg-white/88 shadow-sm',
              cell === 1 || cell === 4 ? 'task-loader-matrix-cell-strong' : ''
            )}
            style={{ animationDelay: `${cell * 0.12}s` }}
          />
        ))}
      </div>
    </MotionPanel>
  )
}

function StandardScene({ theme }: SceneProps) {
  switch (theme.motion) {
    case 'orbit':
      return <OrbitScene theme={theme} />
    case 'stream':
      return <StreamScene theme={theme} />
    case 'ticker':
      return <TickerScene theme={theme} />
    case 'matrix':
      return <MatrixScene theme={theme} />
    case 'dashboard':
      return <DashboardScene theme={theme} />
  }
}

function LoaderChips({ theme }: SceneProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {theme.chips.map((chip, index) => (
        <div key={chip} className="rounded-[24px] border border-slate-200/80 bg-white/86 px-4 py-4 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.28)]">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br text-xs font-semibold text-white shadow-sm', theme.solidAccentClassName)}>
              {String(index + 1).padStart(2, '0')}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Loading</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">{chip}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function LoaderStatus({ theme }: SceneProps) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.28)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">System Sync</div>
        <div className="text-xs font-medium text-slate-500">Preparing workspace</div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200/90">
        <div className={cn('task-loader-meter h-full w-[62%] rounded-full bg-gradient-to-r', theme.solidAccentClassName)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/85 p-3">
          <div className="task-loader-shimmer h-2.5 w-16 rounded-full bg-slate-200" />
          <div className="task-loader-shimmer mt-3 h-9 rounded-2xl bg-slate-200" />
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/85 p-3">
          <div className="task-loader-shimmer h-2.5 w-12 rounded-full bg-slate-200" />
          <div className="task-loader-shimmer mt-3 h-9 rounded-2xl bg-slate-200" />
        </div>
      </div>
    </div>
  )
}

function CompactLoader({ theme, title, message, className }: SceneProps & { title?: string; message?: string; className?: string }) {
  const Icon = theme.icon

  return (
    <div role="status" aria-live="polite" className={cn('flex min-h-[160px] items-center justify-center px-4 py-6', className)}>
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] p-5 shadow-[0_26px_70px_-44px_rgba(15,23,42,0.22)]">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <div className="task-loader-pulse-ring absolute inset-0 rounded-[22px] border border-slate-200/80" />
            <div className={cn('task-loader-bob relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br text-white shadow-lg', theme.solidAccentClassName)}>
              <Icon className="h-5 w-5" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{theme.eyebrow}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{title || theme.title}</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">{message || theme.message}</div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200/90">
              <div className={cn('task-loader-meter h-full w-[58%] rounded-full bg-gradient-to-r', theme.solidAccentClassName)} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {theme.chips.map((chip) => (
            <span key={chip} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              {chip}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TaskLoader({ kind, title, message, className, fullscreen = false, compact = false }: TaskLoaderProps) {
  const theme = LOADER_THEMES[kind]

  if (compact) {
    return <CompactLoader theme={theme} title={title} message={message} className={className} />
  }

  const isDashboard = kind === 'dashboard'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full items-center justify-center px-4 py-8',
        fullscreen ? 'min-h-screen bg-[#f4f6fb]' : 'min-h-[360px]',
        className
      )}
    >
      {isDashboard ? (
        <div className="w-full max-w-5xl overflow-hidden rounded-[34px] border border-slate-200/80 bg-white/94 p-5 shadow-[0_32px_90px_-46px_rgba(15,23,42,0.22)] md:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.04fr_0.96fr] lg:items-center">
            <DashboardScene theme={theme} />

            <div className="space-y-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  <Activity className="h-3.5 w-3.5" />
                  {theme.eyebrow}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">{title || theme.title}</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 md:text-base">{message || theme.message}</p>
              </div>

              <LoaderChips theme={theme} />
              <LoaderStatus theme={theme} />
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-4xl rounded-[34px] border border-slate-200/80 bg-white/94 p-5 shadow-[0_32px_90px_-50px_rgba(15,23,42,0.18)] md:p-6">
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-center">
            <StandardScene theme={theme} />

            <div className="space-y-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-sm">
                  <Activity className="h-3.5 w-3.5" />
                  {theme.eyebrow}
                </div>
                <h2 className="mt-4 text-[1.9rem] font-semibold tracking-tight text-slate-950">{title || theme.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 md:text-base">{message || theme.message}</p>
              </div>

              <LoaderChips theme={theme} />
              <LoaderStatus theme={theme} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
