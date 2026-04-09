import { AppLoaderShell } from '@/components/loaders/app-loader-shell'

export default function BankStatementUploadLoading() {
  return (
    <AppLoaderShell
      kind="bank"
      fullscreen
      title="Preparing bank reconciliation"
      message="Loading bank accounts, ERP targets, and recent statement activity."
    />
  )
}
