import DashboardLayout from '@/app/components/DashboardLayout'
import { TransactionListSkeleton } from '@/components/performance/page-placeholders'

export default function Loading() {
  return (
    <DashboardLayout companyId="">
      <div className="space-y-6 p-6">
        <TransactionListSkeleton />
      </div>
    </DashboardLayout>
  )
}
