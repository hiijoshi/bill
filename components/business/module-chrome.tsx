'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ModuleChrome({
  eyebrow,
  title,
  description,
  actions,
  badges,
  children,
  className
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  badges?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-5', className)}>
      <div className="premium-panel overflow-hidden rounded-[2rem] border border-white/60">
        <div className="grid-pattern border-b border-white/55 px-5 py-5 md:px-7 md:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {eyebrow}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950 md:text-3xl">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 md:text-[15px]">
                {description}
              </p>
              {badges ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {badges}
                </div>
              ) : null}
            </div>
            {actions ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {actions}
              </div>
            ) : null}
          </div>
        </div>
        {children ? (
          <div className="px-5 py-5 md:px-7 md:py-6">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function MetricRail({
  items
}: {
  items: Array<{
    label: string
    value: string
    tone?: string
    helper?: string
  }>
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-[1.4rem] border border-slate-200 bg-white/88 px-4 py-4 shadow-[0_12px_26px_rgba(15,23,42,0.05)]"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</div>
          <div className={cn('mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950', item.tone)}>
            {item.value}
          </div>
          {item.helper ? (
            <div className="mt-1 text-xs text-slate-500">{item.helper}</div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
