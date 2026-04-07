import { unstable_cache, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

type CacheOptions = {
  revalidate?: number | false
  tags?: string[]
}

export function withApiCache<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyFn: (...args: TArgs) => string[],
  options: CacheOptions = {}
) {
  return async (...args: TArgs): Promise<TResult> => {
    const cacheKey = keyFn(...args)

    const cachedFn = unstable_cache(
      async () => {
        return await fn(...args)
      },
      cacheKey,
      {
        revalidate: options.revalidate ?? 300, // 5 minutes default
        tags: options.tags
      }
    )

    return cachedFn()
  }
}

export function invalidateApiCache(tags: string[]) {
  for (const tag of tags) {
    revalidateTag(tag, 'page')
  }
}