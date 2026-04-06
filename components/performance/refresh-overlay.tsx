'use client'

import { RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

type RefreshOverlayProps = {
  refreshing: boolean
  label?: string
  className?: string
  subtle?: boolean
}

export function RefreshOverlay({
  refreshing,
  label = 'Refreshing',
  className,
  subtle = false
}: RefreshOverlayProps) {
  if (!refreshing) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 rounded-[inherit] border border-sky-100/70 bg-white/55 backdrop-blur-[1px]',
        subtle ? 'bg-white/40' : '',
        className
      )}
      aria-live="polite"
      aria-label={label}
    >
      <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/95 px-3 py-1 text-xs font-medium text-sky-700 shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        {label}
      </div>
    </div>
  )
}
