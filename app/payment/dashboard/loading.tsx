import DashboardLayout from '@/app/components/DashboardLayout'
import { PaymentDashboardSkeleton } from '@/components/performance/page-placeholders'

export default function Loading() {
  return (
    <DashboardLayout companyId="">
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <PaymentDashboardSkeleton />
        </div>
      </div>
    </DashboardLayout>
  )
}
