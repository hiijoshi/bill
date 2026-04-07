'use client'

import { DashboardSectionSkeleton, FilterBarSkeleton, FormSkeleton, SectionCardSkeleton, SummaryCardSkeletons, TableSkeleton } from '@/components/performance/skeletons'

export function PaymentWorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="h-9 w-56 animate-pulse rounded-md bg-slate-200/80" />
        <div className="flex gap-2">
          <div className="h-10 w-32 animate-pulse rounded-md bg-slate-200/80" />
          <div className="h-10 w-32 animate-pulse rounded-md bg-slate-200/80" />
        </div>
      </div>
      <SummaryCardSkeletons count={4} />
      <FilterBarSkeleton fields={4} />
      <TableSkeleton rows={8} columns={8} />
    </div>
  )
}

export function PaymentDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="h-9 w-64 animate-pulse rounded-md bg-slate-200/80" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-10 w-36 animate-pulse rounded-md bg-slate-200/80" />
          ))}
        </div>
      </div>
      <SummaryCardSkeletons count={3} />
      <FilterBarSkeleton fields={4} />
      <TableSkeleton rows={8} columns={9} />
      <TableSkeleton rows={6} columns={8} />
    </div>
  )
}

export function TransactionListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-9 w-52 animate-pulse rounded-md bg-slate-200/80" />
      <FilterBarSkeleton fields={8} />
      <SummaryCardSkeletons count={4} />
      <TableSkeleton rows={10} columns={8} />
    </div>
  )
}

export function ReportWorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <SectionCardSkeleton lines={3} />
      <FilterBarSkeleton fields={6} />
      <SummaryCardSkeletons count={4} />
      <TableSkeleton rows={10} columns={8} />
    </div>
  )
}

export function StockWorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <SummaryCardSkeletons count={4} />
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <FormSkeleton fields={6} />
        <SectionCardSkeleton lines={7} />
      </div>
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}

export function MainDashboardSkeleton() {
  return <DashboardSectionSkeleton />
}
