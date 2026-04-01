import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  BookCopy,
  Boxes,
  CreditCard,
  FileClock,
  Landmark,
  Package,
  Printer,
  Receipt,
  RefreshCcw,
  Scale,
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

type LoaderTheme = {
  eyebrow: string
  title: string
  message: string
  icon: LucideIcon
  chips: string[]
  accentClassName: string
  panelClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: {
    eyebrow: 'Business Overview',
    title: 'Preparing dashboard',
    message: 'Stacking sales, purchase, stock, and payment insights for the selected company.',
    icon: BarChart3,
    chips: ['Sales pulse', 'Stock scan', 'Cash flow'],
    accentClassName: 'from-sky-500/20 via-blue-500/12 to-cyan-400/12',
    panelClassName: 'from-sky-50 via-white to-cyan-50'
  },
  reports: {
    eyebrow: 'Report Workspace',
    title: 'Building reports',
    message: 'Arranging filters, balances, ledgers, and export-ready summaries.',
    icon: FileClock,
    chips: ['Filters', 'Summaries', 'Exports'],
    accentClassName: 'from-amber-500/20 via-orange-500/12 to-yellow-400/12',
    panelClassName: 'from-amber-50 via-white to-orange-50'
  },
  payment: {
    eyebrow: 'Payment Desk',
    title: 'Loading payment data',
    message: 'Matching settlements, payment modes, and bill history.',
    icon: CreditCard,
    chips: ['Bills', 'Modes', 'History'],
    accentClassName: 'from-emerald-500/20 via-teal-500/12 to-cyan-400/12',
    panelClassName: 'from-emerald-50 via-white to-teal-50'
  },
  journal: {
    eyebrow: 'Journal Voucher',
    title: 'Preparing ledger rows',
    message: 'Bringing account heads, parties, banks, and balance controls together.',
    icon: BookCopy,
    chips: ['Ledgers', 'Debit', 'Credit'],
    accentClassName: 'from-violet-500/20 via-fuchsia-500/12 to-pink-400/12',
    panelClassName: 'from-violet-50 via-white to-fuchsia-50'
  },
  bank: {
    eyebrow: 'Bank Workspace',
    title: 'Reading bank entries',
    message: 'Collecting bank accounts, uploaded statements, and settlement matches.',
    icon: Landmark,
    chips: ['Accounts', 'Statements', 'Settlement'],
    accentClassName: 'from-cyan-500/20 via-sky-500/12 to-blue-400/12',
    panelClassName: 'from-cyan-50 via-white to-sky-50'
  },
  transfer: {
    eyebrow: 'Internal Transfer',
    title: 'Preparing transfer desk',
    message: 'Bringing cash and bank accounts into one clean transfer flow.',
    icon: RefreshCcw,
    chips: ['From', 'To', 'Reconcile'],
    accentClassName: 'from-indigo-500/20 via-blue-500/12 to-cyan-400/12',
    panelClassName: 'from-indigo-50 via-white to-blue-50'
  },
  purchase: {
    eyebrow: 'Purchase Flow',
    title: 'Loading purchase workspace',
    message: 'Arranging farmers, products, mandi charges, and bill details.',
    icon: ShoppingCart,
    chips: ['Farmer', 'Mandi', 'Billing'],
    accentClassName: 'from-rose-500/20 via-orange-500/12 to-amber-400/12',
    panelClassName: 'from-rose-50 via-white to-orange-50'
  },
  sales: {
    eyebrow: 'Sales Flow',
    title: 'Preparing sales screen',
    message: 'Gathering parties, stock items, taxes, and invoice totals.',
    icon: Receipt,
    chips: ['Party', 'Invoice', 'Dispatch'],
    accentClassName: 'from-fuchsia-500/20 via-rose-500/12 to-orange-400/12',
    panelClassName: 'from-fuchsia-50 via-white to-rose-50'
  },
  master: {
    eyebrow: 'Master Setup',
    title: 'Syncing master records',
    message: 'Fetching companies, master values, and configuration controls.',
    icon: BookCopy,
    chips: ['Masters', 'Setup', 'Lookup'],
    accentClassName: 'from-slate-500/20 via-zinc-500/12 to-neutral-400/12',
    panelClassName: 'from-slate-50 via-white to-zinc-50'
  },
  stock: {
    eyebrow: 'Stock Control',
    title: 'Scanning stock position',
    message: 'Counting movements, balances, and inventory attention points.',
    icon: Boxes,
    chips: ['Movement', 'Balance', 'Alerts'],
    accentClassName: 'from-lime-500/20 via-emerald-500/12 to-teal-400/12',
    panelClassName: 'from-lime-50 via-white to-emerald-50'
  },
  access: {
    eyebrow: 'Security Check',
    title: 'Checking access',
    message: 'Verifying permission matrix and allowed company scope.',
    icon: ShieldCheck,
    chips: ['User', 'Company', 'Privileges'],
    accentClassName: 'from-blue-500/20 via-indigo-500/12 to-violet-400/12',
    panelClassName: 'from-blue-50 via-white to-indigo-50'
  },
  print: {
    eyebrow: 'Print Preview',
    title: 'Preparing print layout',
    message: 'Composing invoice pages, totals, and printable sections.',
    icon: Printer,
    chips: ['Layout', 'Pages', 'Preview'],
    accentClassName: 'from-stone-500/20 via-slate-500/12 to-zinc-400/12',
    panelClassName: 'from-stone-50 via-white to-slate-50'
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

function LoaderScene({ icon: Icon, chips, accentClassName, panelClassName }: Pick<LoaderTheme, 'icon' | 'chips' | 'accentClassName' | 'panelClassName'>) {
  return (
    <div className={cn('relative min-h-[220px] overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br p-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.2)]', panelClassName)}>
      <div className={cn('task-loader-glow absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br blur-3xl', accentClassName)} />
      <div className="task-loader-glow absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-white/80 blur-3xl" />

      <div className="absolute inset-x-5 top-5 flex flex-wrap gap-2">
        {chips.map((chip, index) => (
          <span
            key={chip}
            className="task-loader-float inline-flex rounded-full border border-white/80 bg-white/85 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm"
            style={{ animationDelay: `${index * 0.15}s` }}
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.35)]">
          <div className="task-loader-orbit absolute inset-[-10px] rounded-full border border-slate-300/70" />
          <div className="task-loader-orbit-reverse absolute inset-[-24px] rounded-full border border-slate-200/90" />
          <div className="task-loader-bob rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
            <Icon className="h-8 w-8" />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((value) => (
          <div key={value} className="task-loader-card rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
            <div className="task-loader-shimmer h-2.5 w-14 rounded-full bg-slate-200" />
            <div className="task-loader-shimmer mt-3 h-7 rounded-xl bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TaskLoader({ kind, title, message, className, fullscreen = false, compact = false }: TaskLoaderProps) {
  const theme = LOADER_THEMES[kind]
  const Icon = theme.icon

  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex min-h-[160px] items-center justify-center px-4 py-6', className)}
      >
        <div className={cn('w-full max-w-xl overflow-hidden rounded-[26px] border border-slate-200 bg-white/92 p-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]')}>
          <div className="flex items-center gap-3">
            <div className="task-loader-bob rounded-2xl bg-slate-900 p-3 text-white">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">{theme.eyebrow}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{title || theme.title}</div>
              <div className="mt-1 text-sm text-slate-500">{message || theme.message}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((value) => (
              <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="task-loader-shimmer h-2.5 w-16 rounded-full bg-slate-200" />
                <div className="task-loader-shimmer mt-3 h-8 rounded-xl bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full items-center justify-center px-4 py-8',
        fullscreen ? 'min-h-screen bg-[#f5f6fb]' : 'min-h-[360px]',
        className
      )}
    >
      <div className="w-full max-w-5xl overflow-hidden rounded-[34px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.22)] md:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <LoaderScene
            icon={theme.icon}
            chips={theme.chips}
            accentClassName={theme.accentClassName}
            panelClassName={theme.panelClassName}
          />

          <div className="space-y-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                <Activity className="h-3.5 w-3.5" />
                {theme.eyebrow}
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
                {title || theme.title}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 md:text-base">
                {message || theme.message}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {theme.chips.map((chip, index) => (
                <div
                  key={chip}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
                  style={{ animationDelay: `${index * 0.12}s` }}
                >
                  <div className="task-loader-shimmer h-2.5 w-14 rounded-full bg-slate-200" />
                  <div className="mt-3 text-sm font-semibold text-slate-700">{chip}</div>
                  <div className="task-loader-shimmer mt-2 h-8 rounded-xl bg-slate-200" />
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-[28px] border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="task-loader-shimmer h-10 w-10 rounded-2xl bg-slate-200" />
                <div className="flex-1 space-y-2">
                  <div className="task-loader-shimmer h-3 w-28 rounded-full bg-slate-200" />
                  <div className="task-loader-shimmer h-9 rounded-2xl bg-slate-200" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="task-loader-shimmer h-11 rounded-2xl bg-slate-200" />
                <div className="task-loader-shimmer h-11 rounded-2xl bg-slate-200" />
              </div>
              <div className="task-loader-shimmer h-24 rounded-[24px] bg-slate-200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
