import { redirect } from 'next/navigation'

export default function MandiTypeMasterRedirectPage() {
  redirect('/super-admin/masters?resource=mandi-types')
}

