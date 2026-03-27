export function isAbortError(error: unknown): boolean {
  if (!error) return false

  const matchesAbortToken = (value: string): boolean => {
    const message = value.toLowerCase()
    return (
      message.includes('aborted') ||
      message.includes('aborterror') ||
      message.includes('requesttimeout') ||
      message.includes('timeouterror') ||
      message.includes('request timed out')
    )
  }

  if (typeof error === 'string') {
    return matchesAbortToken(error)
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    if (matchesAbortToken(error.message)) {
      return true
    }
  }

  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown }
  if (candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR') {
    return true
  }

  if (typeof candidate?.message === 'string') {
    if (matchesAbortToken(candidate.message)) {
      return true
    }
  }

  if (typeof (error as { toString?: () => string }).toString === 'function') {
    const text = String((error as { toString: () => string }).toString())
    if (matchesAbortToken(text)) {
      return true
    }
  }

  const reason = (candidate as { reason?: unknown })?.reason
  if (reason && reason !== error) {
    return isAbortError(reason)
  }

  const cause = candidate?.cause as unknown
  if (cause && cause !== error) {
    return isAbortError(cause)
  }

  return false
}
