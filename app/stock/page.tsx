import { redirect } from 'next/navigation'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toQueryString(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value) {
      search.set(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry) search.append(key, entry)
      }
    }
  }
  return search.toString()
}

export default async function StockPage({ searchParams }: PageProps) {
  const params = await searchParams
  const query = toQueryString(params)
  redirect(query ? `/stock/adjustment?${query}` : '/stock/adjustment')
}
