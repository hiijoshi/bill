import { redirect } from 'next/navigation'

import BankStatementUploadClient from '@/app/payment/bank-statement/upload/BankStatementUploadClient'
import { loadBankStatementWorkspace } from '@/lib/server-bank-statement-workspace'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function BankStatementUploadPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const workspace = companyId
    ? await loadBankStatementWorkspace(companyId).catch(() => null)
    : null

  return (
    <BankStatementUploadClient
      initialCompanyId={companyId}
      initialWorkspace={workspace}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
