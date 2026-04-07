import DashboardLayout from '@/app/components/DashboardLayout'
import { ReportWorkspaceSkeleton } from '@/components/performance/page-placeholders'

export default function Loading() {
  return (
    <DashboardLayout companyId="" lockViewport>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 md:p-8">
          <ReportWorkspaceSkeleton />
        </div>
      </div>
    </DashboardLayout>
  )
}
