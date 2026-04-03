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
  accentClassName: string
  surfaceClassName: string
}

const LOADER_THEMES: Record<TaskLoaderKind, LoaderTheme> = {
  dashboard: {
    eyebrow: 'Business Overview',
    title: 'Preparing dashboard',
    message: 'Loading company overview, balances, and key business totals.',
    accentClassName: 'from-sky-500 via-blue-500 to-cyan-500',
    surfaceClassName: 'from-sky-50 via-white to-cyan-50'
  },
  reports: {
    eyebrow: 'Report Workspace',
    title: 'Building reports',
    message: 'Fetching filters, ledgers, and report data for the selected company.',
    accentClassName: 'from-amber-500 via-orange-500 to-yellow-500',
    surfaceClassName: 'from-amber-50 via-white to-orange-50'
  },
  payment: {
    eyebrow: 'Payment Desk',
    title: 'Loading payment data',
    message: 'Preparing settlements, payment modes, and payment history.',
    accentClassName: 'from-emerald-500 via-teal-500 to-cyan-500',
    surfaceClassName: 'from-emerald-50 via-white to-teal-50'
  },
  journal: {
    eyebrow: 'Journal Voucher',
    title: 'Preparing journal entry',
    message: 'Loading ledger data, parties, and account heads.',
    accentClassName: 'from-rose-500 via-orange-500 to-amber-500',
    surfaceClassName: 'from-rose-50 via-white to-orange-50'
  },
  bank: {
    eyebrow: 'Bank Workspace',
    title: 'Preparing bank workspace',
    message: 'Loading bank records, statement tools, and settlement data.',
    accentClassName: 'from-cyan-500 via-sky-500 to-blue-600',
    surfaceClassName: 'from-cyan-50 via-white to-sky-50'
  },
  transfer: {
    eyebrow: 'Internal Transfer',
    title: 'Preparing transfer desk',
    message: 'Loading transfer accounts and reconciliation details.',
    accentClassName: 'from-indigo-500 via-blue-500 to-cyan-500',
    surfaceClassName: 'from-indigo-50 via-white to-blue-50'
  },
  purchase: {
    eyebrow: 'Purchase Flow',
    title: 'Preparing purchase entry',
    message: 'Loading farmers, mandi types, products, and purchase logic.',
    accentClassName: 'from-rose-500 via-orange-500 to-amber-500',
    surfaceClassName: 'from-rose-50 via-white to-orange-50'
  },
  sales: {
    eyebrow: 'Sales Flow',
    title: 'Preparing sales screen',
    message: 'Loading parties, items, taxes, and sales entry data.',
    accentClassName: 'from-fuchsia-500 via-rose-500 to-orange-500',
    surfaceClassName: 'from-fuchsia-50 via-white to-rose-50'
  },
  master: {
    eyebrow: 'Master Setup',
    title: 'Syncing master records',
    message: 'Loading master data, lookup values, and configuration.',
    accentClassName: 'from-slate-600 via-zinc-500 to-neutral-500',
    surfaceClassName: 'from-slate-50 via-white to-zinc-50'
  },
  stock: {
    eyebrow: 'Stock Control',
    title: 'Scanning stock position',
    message: 'Loading stock movement, balances, and item summaries.',
    accentClassName: 'from-lime-500 via-emerald-500 to-teal-500',
    surfaceClassName: 'from-lime-50 via-white to-emerald-50'
  },
  access: {
    eyebrow: 'Security Check',
    title: 'Checking access',
    message: 'Verifying access and session scope for this workspace.',
    accentClassName: 'from-blue-500 via-indigo-500 to-violet-500',
    surfaceClassName: 'from-blue-50 via-white to-indigo-50'
  },
  print: {
    eyebrow: 'Print Preview',
    title: 'Preparing print layout',
    message: 'Building printable sections, pages, and totals.',
    accentClassName: 'from-stone-500 via-slate-500 to-zinc-500',
    surfaceClassName: 'from-stone-50 via-white to-slate-50'
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

function LoaderVideo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[28px] border border-white/85 bg-white/92 shadow-[0_26px_60px_-42px_rgba(15,23,42,0.24)]',
        compact ? 'h-24 w-24 p-2.5' : 'h-40 w-40 p-3'
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
  return (
    <div
      className={cn(
        'relative w-full max-w-xl overflow-hidden rounded-[30px] border border-slate-200/80 bg-gradient-to-br p-5 shadow-[0_26px_70px_-46px_rgba(15,23,42,0.2)]',
        theme.surfaceClassName,
        className
      )}
    >
      <div className={cn('pointer-events-none absolute -right-14 -top-14 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-3xl', theme.accentClassName)} />
      <div className="relative flex items-center gap-4">
        <LoaderVideo compact />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">{theme.eyebrow}</div>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">{title || theme.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{message || theme.message}</p>
        </div>
      </div>
    </div>
  )
}

function FullLoaderCard({
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
  return (
    <div
      className={cn(
        'relative w-full max-w-2xl overflow-hidden rounded-[34px] border border-slate-200/80 bg-gradient-to-br px-8 py-9 shadow-[0_34px_90px_-54px_rgba(15,23,42,0.22)]',
        theme.surfaceClassName,
        className
      )}
    >
      <div className={cn('pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-gradient-to-br opacity-20 blur-3xl', theme.accentClassName)} />
      <div className="relative flex flex-col items-center text-center">
        <LoaderVideo />
        <div className={cn('mt-6 h-1 w-20 rounded-full bg-gradient-to-r', theme.accentClassName)} />
        <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">{theme.eyebrow}</div>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{title || theme.title}</h2>
        <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">{message || theme.message}</p>
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
          ? 'min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] py-10'
          : compact
          ? 'min-h-[170px] py-6'
          : 'min-h-[320px] py-8',
        className
      )}
    >
      {compact ? (
        <CompactLoaderCard theme={theme} title={title} message={message} />
      ) : (
        <FullLoaderCard theme={theme} title={title} message={message} />
      )}
    </div>
  )
}
