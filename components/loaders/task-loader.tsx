import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookCopy,
  Boxes,
  CreditCard,
  FileClock,
  Landmark,
  Loader2,
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
    accentClassName: 'from-sky-500 to-cyan-500',
    accentSoftClassName: 'from-sky-50 via-white to-cyan-50'
  },
  reports: {
    eyebrow: 'Report Workspace',
    title: 'Building reports',
    message: 'Arranging filters, balances, ledgers, and export-ready summaries.',
    icon: FileClock,
    chips: ['Filters', 'Summaries', 'Exports'],
    accentClassName: 'from-amber-500 to-orange-500',
    accentSoftClassName: 'from-amber-50 via-white to-orange-50'
  },
  payment: {
    eyebrow: 'Payment Desk',
    title: 'Loading payment data',
    message: 'Matching settlements, payment modes, and bill history.',
    icon: CreditCard,
    chips: ['Bills', 'Modes', 'History'],
    accentClassName: 'from-emerald-500 to-teal-500',
    accentSoftClassName: 'from-emerald-50 via-white to-teal-50'
  },
  journal: {
    eyebrow: 'Journal Voucher',
    title: 'Preparing ledger rows',
    message: 'Bringing account heads, parties, banks, and balance controls together.',
    icon: BookCopy,
    chips: ['Ledgers', 'Debit', 'Credit'],
    accentClassName: 'from-rose-500 to-orange-500',
    accentSoftClassName: 'from-rose-50 via-white to-orange-50'
  },
  bank: {
    eyebrow: 'Bank Workspace',
    title: 'Reading bank entries',
    message: 'Collecting bank accounts, uploaded statements, and settlement matches.',
    icon: Landmark,
    chips: ['Accounts', 'Statements', 'Settlement'],
    accentClassName: 'from-cyan-500 to-blue-600',
    accentSoftClassName: 'from-cyan-50 via-white to-sky-50'
  },
  transfer: {
    eyebrow: 'Internal Transfer',
    title: 'Preparing transfer desk',
    message: 'Bringing cash and bank accounts into one clean transfer flow.',
    icon: RefreshCcw,
    chips: ['From', 'To', 'Reconcile'],
    accentClassName: 'from-indigo-500 to-cyan-500',
    accentSoftClassName: 'from-indigo-50 via-white to-blue-50'
  },
  purchase: {
    eyebrow: 'Purchase Flow',
    title: 'Loading purchase workspace',
    message: 'Arranging farmers, products, mandi charges, and bill details.',
    icon: ShoppingCart,
    chips: ['Farmer', 'Mandi', 'Billing'],
    accentClassName: 'from-rose-500 to-amber-500',
    accentSoftClassName: 'from-rose-50 via-white to-orange-50'
  },
  sales: {
    eyebrow: 'Sales Flow',
    title: 'Preparing sales screen',
    message: 'Gathering parties, stock items, taxes, and invoice totals.',
    icon: Receipt,
    chips: ['Party', 'Invoice', 'Dispatch'],
    accentClassName: 'from-fuchsia-500 to-orange-500',
    accentSoftClassName: 'from-fuchsia-50 via-white to-rose-50'
  },
  master: {
    eyebrow: 'Master Setup',
    title: 'Syncing master records',
    message: 'Fetching companies, master values, and configuration controls.',
    icon: BookCopy,
    chips: ['Masters', 'Setup', 'Lookup'],
    accentClassName: 'from-slate-600 to-zinc-500',
    accentSoftClassName: 'from-slate-50 via-white to-zinc-50'
  },
  stock: {
    eyebrow: 'Stock Control',
    title: 'Scanning stock position',
    message: 'Counting movements, balances, and inventory attention points.',
    icon: Boxes,
    chips: ['Movement', 'Balance', 'Alerts'],
    accentClassName: 'from-lime-500 to-emerald-500',
    accentSoftClassName: 'from-lime-50 via-white to-emerald-50'
  },
  access: {
    eyebrow: 'Security Check',
    title: 'Checking access',
    message: 'Verifying permission matrix and allowed company scope.',
    icon: ShieldCheck,
    chips: ['User', 'Company', 'Privileges'],
    accentClassName: 'from-blue-500 to-violet-500',
    accentSoftClassName: 'from-blue-50 via-white to-indigo-50'
  },
  print: {
    eyebrow: 'Print Preview',
    title: 'Preparing print layout',
    message: 'Composing invoice pages, totals, and printable sections.',
    icon: Printer,
    chips: ['Layout', 'Pages', 'Preview'],
    accentClassName: 'from-stone-500 to-slate-500',
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

function LoaderCard({
  theme,
  title,
  message,
  className,
  compact
}: {
  theme: LoaderTheme
  title?: string
  message?: string
  className?: string
  compact?: boolean
}) {
  const Icon = theme.icon

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br shadow-[0_28px_80px_-50px_rgba(15,23,42,0.2)]',
        theme.accentSoftClassName,
        compact ? 'max-w-2xl p-5' : 'max-w-4xl p-6 md:p-7',
        className
      )}
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-white/80 bg-white/90 shadow-sm">
            <div className={cn('absolute inset-x-2 top-0 h-1 rounded-b-full bg-gradient-to-r', theme.accentClassName)} />
            <Icon className="h-5 w-5 text-slate-700" />
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">{theme.eyebrow}</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 md:text-2xl">{title || theme.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{message || theme.message}</p>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/80 bg-white/90 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {theme.chips.map((chip) => (
          <div key={chip} className="rounded-2xl border border-white/80 bg-white/88 px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">In Progress</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{chip}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-white/80 bg-white/88 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-slate-700">Preparing workspace</span>
          <span className="text-slate-500">Please wait</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/80">
          <div className={cn('h-full w-[62%] rounded-full bg-gradient-to-r', theme.accentClassName)} />
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
        fullscreen ? 'min-h-screen bg-[#f5f7fb] py-10' : compact ? 'min-h-[180px] py-6' : 'min-h-[320px] py-8',
        className
      )}
    >
      <LoaderCard theme={theme} title={title} message={message} compact={compact} />
    </div>
  )
}
