import { redirect } from 'next/navigation'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SelfTransferEntryRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams
  const nextParams = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(params)) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (typeof value === 'string' && value.trim()) {
          nextParams.append(key, value)
        }
      }
      continue
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
      nextParams.set(key, rawValue)
    }
  }

  nextParams.set('entry', 'self-transfer')
  redirect(`/payment/cash-bank/entry?${nextParams.toString()}`)
}
