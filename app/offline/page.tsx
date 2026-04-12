'use client'

import Link from 'next/link'
import { CloudOff, RefreshCw, ShieldCheck } from 'lucide-react'

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6 py-10">
      <div className="premium-panel w-full max-w-xl rounded-[2rem] p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-950 text-white">
          <CloudOff className="h-7 w-7" />
        </div>

        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
          You’re offline
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
          Mbill ERP can still open safely, but protected live business data, ledger refreshes, uploads, and reconciliation actions need an internet connection.
        </p>

        <div className="mt-6 grid gap-3 text-left md:grid-cols-2">
          <div className="rounded-[1.35rem] border border-slate-200 bg-white/80 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Safe by design
            </div>
            <p className="mt-2 text-sm text-slate-600">
              API data is not cached for offline replay, so stale ERP transactions do not silently appear as fresh records.
            </p>
          </div>
          <div className="rounded-[1.35rem] border border-slate-200 bg-white/80 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <RefreshCw className="h-4 w-4 text-sky-600" />
              Reconnect to continue
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Once you are back online, reload to continue uploads, reports, settlements, and other live workflows.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </button>
          <Link
            href="/main/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
