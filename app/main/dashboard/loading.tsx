import DashboardLayout from '@/app/components/DashboardLayout'
import { MainDashboardSkeleton } from '@/components/performance/page-placeholders'

export default function Loading() {
  return (
    <DashboardLayout companyId="">
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto max-w-7xl space-y-8 p-6 md:p-8">
          <MainDashboardSkeleton />
        </div>
      </div>
    </DashboardLayout>
  )
}
