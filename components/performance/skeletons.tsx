'use client'

import { cn } from '@/lib/utils'

type SkeletonBlockProps = {
  className?: string
}

export function SkeletonBlock({ className }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-slate-200/80', className)}
    />
  )
}

type SummaryCardSkeletonsProps = {
  count?: number
  className?: string
}

export function SummaryCardSkeletons({
  count = 4,
  className
}: SummaryCardSkeletonsProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SkeletonBlock className="mb-3 h-4 w-24" />
          <SkeletonBlock className="h-8 w-32" />
          <SkeletonBlock className="mt-4 h-3 w-20" />
        </div>
      ))}
    </div>
  )
}

type FilterBarSkeletonProps = {
  fields?: number
  className?: string
}

export function FilterBarSkeleton({
  fields = 4,
  className
}: FilterBarSkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

type TableSkeletonProps = {
  rows?: number
  columns?: number
  className?: string
  compact?: boolean
}

export function TableSkeleton({
  rows = 8,
  columns = 6,
  className,
  compact = false
}: TableSkeletonProps) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, index) => (
            <SkeletonBlock key={index} className="h-3 w-4/5" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className={cn('grid gap-3 px-4', compact ? 'py-2.5' : 'py-3.5')}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <SkeletonBlock
                key={columnIndex}
                className={cn(
                  compact ? 'h-3.5' : 'h-4',
                  columnIndex === columns - 1 ? 'w-2/3' : rowIndex % 2 === 0 ? 'w-5/6' : 'w-4/6'
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

type SectionCardSkeletonProps = {
  className?: string
  lines?: number
}

export function SectionCardSkeleton({
  className,
  lines = 4
}: SectionCardSkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      <SkeletonBlock className="mb-4 h-5 w-40" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <SkeletonBlock key={index} className={cn('h-4', index === lines - 1 ? 'w-1/2' : 'w-full')} />
        ))}
      </div>
    </div>
  )
}

type DashboardSectionSkeletonProps = {
  className?: string
}

export function DashboardSectionSkeleton({ className }: DashboardSectionSkeletonProps) {
  return (
    <div className={cn('space-y-6', className)}>
      <SummaryCardSkeletons />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <TableSkeleton rows={6} columns={6} />
        <SectionCardSkeleton lines={6} />
      </div>
    </div>
  )
}

type FormSkeletonProps = {
  fields?: number
  className?: string
}

export function FormSkeleton({
  fields = 6,
  className
}: FormSkeletonProps) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
