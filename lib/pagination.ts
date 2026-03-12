export interface PaginationParams {
  enabled: boolean
  page: number
  pageSize: number
  skip: number
  search?: string
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  config?: { defaultPageSize?: number; maxPageSize?: number }
): PaginationParams {
  const defaultPageSize = config?.defaultPageSize ?? 50
  const maxPageSize = config?.maxPageSize ?? 200

  const pageRaw = searchParams.get('page')
  const pageSizeRaw = searchParams.get('pageSize') ?? searchParams.get('limit')
  const enabled = pageRaw !== null || pageSizeRaw !== null || searchParams.get('withMeta') === 'true'

  const page = toPositiveInt(pageRaw, 1)
  const requestedPageSize = toPositiveInt(pageSizeRaw, defaultPageSize)
  const pageSize = Math.min(requestedPageSize, maxPageSize)
  const skip = (page - 1) * pageSize

  const rawSearch = searchParams.get('search')
  const search = rawSearch && rawSearch.trim() ? rawSearch.trim() : undefined

  return {
    enabled,
    page,
    pageSize,
    skip,
    search
  }
}

export function buildPaginationMeta(total: number, params: PaginationParams): PaginationMeta {
  const safeTotal = Math.max(0, total)
  const totalPages = Math.max(1, Math.ceil(safeTotal / params.pageSize))

  return {
    page: params.page,
    pageSize: params.pageSize,
    total: safeTotal,
    totalPages,
    hasNext: params.page < totalPages,
    hasPrev: params.page > 1
  }
}
