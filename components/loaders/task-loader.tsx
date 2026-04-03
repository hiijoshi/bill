import type { LucideIcon } from 'lucide-react'
import {
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

type LoaderTheme = {
  eyebrow: string
  title: string
  message: string
  icon: LucideIcon
  chips: string[]
  accentClassName: string
  accentSoftClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: {
    eyebrow: 'Business Overview',
    title: 'Preparing dashboard',
    message: 'Stacking sales, purchase, stock, and payment insights for the selected company.',
    icon: BarChart3,
    chips: ['Sales pulse', 'Stock scan', 'Cash flow'],
    accentClassName: 'from-sky-500 via-blue-500 to-cyan-500',
    accentSoftClassName: 'from-sky-50 via-white to-cyan-50'
  },
  reports: {
    eyebrow: 'Report Workspace',
    title: 'Building reports',
    message: 'Arranging filters, balances, ledgers, and export-ready summaries.',
    icon: FileClock,
    chips: ['Filters', 'Summaries', 'Exports'],
    accentClassName: 'from-amber-500 via-orange-500 to-yellow-500',
    accentSoftClassName: 'from-amber-50 via-white to-orange-50'
  },
  payment: {
    eyebrow: 'Payment Desk',
    title: 'Loading payment data',
    message: 'Matching settlements, payment modes, and bill history.',
    icon: CreditCard,
    chips: ['Bills', 'Modes', 'History'],
    accentClassName: 'from-emerald-500 via-teal-500 to-cyan-500',
    accentSoftClassName: 'from-emerald-50 via-white to-teal-50'
  },
  journal: {
    eyebrow: 'Journal Voucher',
    title: 'Preparing ledger rows',
    message: 'Bringing account heads, parties, banks, and balance controls together.',
    icon: BookCopy,
    chips: ['Ledgers', 'Debit', 'Credit'],
    accentClassName: 'from-rose-500 via-orange-500 to-amber-500',
    accentSoftClassName: 'from-rose-50 via-white to-orange-50'
  },
  bank: {
    eyebrow: 'Bank Workspace',
    title: 'Reading bank entries',
    message: 'Collecting bank accounts, uploaded statements, and settlement matches.',
    icon: Landmark,
    chips: ['Accounts', 'Statements', 'Settlement'],
    accentClassName: 'from-cyan-500 via-sky-500 to-blue-600',
    accentSoftClassName: 'from-cyan-50 via-white to-sky-50'
  },
  transfer: {
    eyebrow: 'Internal Transfer',
    title: 'Preparing transfer desk',
    message: 'Bringing cash and bank accounts into one clean transfer flow.',
    icon: RefreshCcw,
    chips: ['From', 'To', 'Reconcile'],
    accentClassName: 'from-indigo-500 via-blue-500 to-cyan-500',
    accentSoftClassName: 'from-indigo-50 via-white to-blue-50'
  },
  purchase: {
    eyebrow: 'Purchase Flow',
    title: 'Preparing purchase entry',
    message: 'Loading farmers, mandi types, products, and purchase charge logic.',
    icon: ShoppingCart,
    chips: ['Farmer', 'Mandi', 'Billing'],
    accentClassName: 'from-rose-500 via-orange-500 to-amber-500',
    accentSoftClassName: 'from-rose-50 via-white to-orange-50'
  },
  sales: {
    eyebrow: 'Sales Flow',
    title: 'Preparing sales screen',
    message: 'Gathering parties, stock items, taxes, and invoice totals.',
    icon: Receipt,
    chips: ['Party', 'Invoice', 'Dispatch'],
    accentClassName: 'from-fuchsia-500 via-rose-500 to-orange-500',
    accentSoftClassName: 'from-fuchsia-50 via-white to-rose-50'
  },
  master: {
    eyebrow: 'Master Setup',
    title: 'Syncing master records',
    message: 'Fetching companies, master values, and configuration controls.',
    icon: BookCopy,
    chips: ['Masters', 'Setup', 'Lookup'],
    accentClassName: 'from-slate-600 via-zinc-500 to-neutral-500',
    accentSoftClassName: 'from-slate-50 via-white to-zinc-50'
  },
  stock: {
    eyebrow: 'Stock Control',
    title: 'Scanning stock position',
    message: 'Counting movements, balances, and inventory attention points.',
    icon: Boxes,
    chips: ['Movement', 'Balance', 'Alerts'],
    accentClassName: 'from-lime-500 via-emerald-500 to-teal-500',
    accentSoftClassName: 'from-lime-50 via-white to-emerald-50'
  },
  access: {
    eyebrow: 'Security Check',
    title: 'Checking access',
    message: 'Verifying permission matrix and allowed company scope.',
    icon: ShieldCheck,
    chips: ['User', 'Company', 'Privileges'],
    accentClassName: 'from-blue-500 via-indigo-500 to-violet-500',
    accentSoftClassName: 'from-blue-50 via-white to-indigo-50'
  },
  print: {
    eyebrow: 'Print Preview',
    title: 'Preparing print layout',
    message: 'Composing invoice pages, totals, and printable sections.',
    icon: Printer,
    chips: ['Layout', 'Pages', 'Preview'],
    accentClassName: 'from-stone-500 via-slate-500 to-zinc-500',
    accentSoftClassName: 'from-stone-50 via-white to-slate-50'
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

function LoadingDots({ theme, compact = false }: { theme: LoaderTheme; compact?: boolean }) {
  const dotSizes = compact ? ['h-2.5 w-2.5', 'h-2 w-2', 'h-2.5 w-2.5'] : ['h-3 w-3', 'h-2.5 w-2.5', 'h-3 w-3']

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-white/85 bg-white/92 px-3.5 py-2 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.28)]">
      <div className="relative flex items-center gap-2 px-1.5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
        {dotSizes.map((size, index) => (
          <span
            key={`${size}-${index}`}
            className={cn(
              'task-loader-dot relative rounded-full bg-gradient-to-br shadow-[0_0_0_6px_rgba(255,255,255,0.84)]',
              size,
              theme.accentClassName
            )}
            style={{ animationDelay: `${index * 0.16}s` }}
          />
        ))}
      </div>

      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Loading</div>
        {!compact ? <div className="text-sm font-semibold text-slate-800">Fast Sync</div> : null}
      </div>
    </div>
  )
}

function FocusChip({
  chip,
  index,
  theme
}: {
  chip: string
  index: number
  theme: LoaderTheme
}) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)]">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-xs font-semibold text-white shadow-sm',
            theme.accentClassName
          )}
        >
          {String(index + 1).padStart(2, '0')}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">In Progress</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{chip}</div>
        </div>
      </div>
    </div>
  )
}

function SnapshotPanel({ theme }: { theme: LoaderTheme }) {
  const chartHeights = [
    [26, 44, 34],
    [18, 36, 50],
    [30, 40, 24]
  ]

  return (
    <div className="rounded-[28px] border border-slate-900/90 bg-slate-950 p-5 text-white shadow-[0_32px_80px_-48px_rgba(15,23,42,0.75)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/45">Sync Snapshot</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">No full-page motion</div>
          <div className="mt-2 text-sm leading-6 text-white/65">
            The page stays calm. Only the loading dots animate so the screen feels faster and cleaner.
          </div>
        </div>
        <div className={cn('h-10 w-10 rounded-2xl bg-gradient-to-br shadow-lg', theme.accentClassName)} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {theme.chips.map((chip, index) => (
          <div key={chip} className="rounded-[20px] border border-white/10 bg-white/5 p-3">
            <div className="flex h-16 items-end gap-1.5">
              {chartHeights[index]?.map((height, barIndex) => (
                <div
                  key={`${chip}-${barIndex}`}
                  className="flex-1 rounded-full bg-white/10"
                >
                  <div
                    className={cn('w-full rounded-full bg-gradient-to-t', theme.accentClassName)}
                    style={{ height }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
              Stage {index + 1}
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{chip}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ['Fast', 'Small loading motion only'],
          ['Focused', 'No card or page animation'],
          ['Premium', 'Clean but more project style']
        ].map(([title, text]) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">{title}</div>
            <div className="mt-2 text-sm text-white/78">{text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompactLoaderCard({
  theme,
  title,
  message,
  className
}: {
  theme: LoaderTheme
  title?: string
  message?: string
  className?: string
}) {
  const Icon = theme.icon

  return (
    <div
      className={cn(
        'relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/94 p-5 shadow-[0_28px_70px_-46px_rgba(15,23,42,0.2)]',
        className
      )}
    >
      <div className={cn('pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-gradient-to-br opacity-15 blur-3xl', theme.accentClassName)} />

      <div className="relative">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-slate-200/80 bg-white shadow-sm">
              <div className={cn('absolute inset-x-2 top-0 h-1 rounded-b-full bg-gradient-to-r', theme.accentClassName)} />
              <Icon className="h-5 w-5 text-slate-800" />
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{theme.eyebrow}</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title || theme.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{message || theme.message}</p>
            </div>
          </div>

          <LoadingDots theme={theme} compact />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {theme.chips.map((chip, index) => (
            <FocusChip key={chip} chip={chip} index={index} theme={theme} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LoaderCard({
  theme,
  title,
  message,
  className
}: {
  theme: LoaderTheme
  title?: string
  message?: string
  className?: string
}) {
  const Icon = theme.icon

  return (
    <div
      className={cn(
        'relative w-full max-w-5xl overflow-hidden rounded-[34px] border border-slate-200/80 bg-gradient-to-br p-6 shadow-[0_36px_90px_-54px_rgba(15,23,42,0.24)] md:p-7',
        theme.accentSoftClassName,
        className
      )}
    >
      <div className={cn('pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br opacity-20 blur-3xl', theme.accentClassName)} />
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent" />

      <div className="relative">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/90 bg-white/92 shadow-[0_20px_44px_-28px_rgba(15,23,42,0.2)]">
              <div className={cn('absolute inset-x-2 top-0 h-1.5 rounded-b-full bg-gradient-to-r', theme.accentClassName)} />
              <Icon className="h-6 w-6 text-slate-900" />
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{theme.eyebrow}</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{title || theme.title}</h2>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{message || theme.message}</p>
            </div>
          </div>

          <LoadingDots theme={theme} />
        </div>

        <div className="mt-7 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[30px] border border-white/85 bg-white/82 p-5 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.22)] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">Workspace Focus</div>
                <div className="mt-2 text-xl font-semibold text-slate-950">Only the loading badge moves</div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                Fast and calm
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {theme.chips.map((chip, index) => (
                <FocusChip key={chip} chip={chip} index={index} theme={theme} />
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ['Quick render', 'Static card layout with one focused motion area.'],
                ['Project style', 'Accent gradients and shaped panels tuned for Mbill.'],
                ['Less distraction', 'No moving bars, no floating cards, no page effects.']
              ].map(([title, text]) => (
                <div key={title} className="rounded-[22px] border border-slate-200/80 bg-slate-50/90 p-4">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{text}</div>
                </div>
              ))}
            </div>
          </div>

          <SnapshotPanel theme={theme} />
        </div>
      </div>
    </div>
  )
}

export function TaskLoader({ kind, title, message, className, fullscreen = false, compact = false }: TaskLoaderProps) {
  const theme = LOADER_THEMES[kind]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full items-center justify-center px-4',
        fullscreen
          ? 'min-h-screen bg-[linear-gradient(180deg,#f7f8fc_0%,#eef2ff_100%)] py-10'
          : compact
          ? 'min-h-[190px] py-6'
          : 'min-h-[360px] py-8',
        className
      )}
    >
      {compact ? (
        <CompactLoaderCard theme={theme} title={title} message={message} />
      ) : (
        <LoaderCard theme={theme} title={title} message={message} />
      )}
    </div>
  )
}
