import DashboardLayout from '@/app/components/DashboardLayout'
import { PaymentWorkspaceSkeleton } from '@/components/performance/page-placeholders'

export default function Loading() {
  return (
    <DashboardLayout companyId="">
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <PaymentWorkspaceSkeleton />
        </div>
      </div>
    </DashboardLayout>
  )
}
