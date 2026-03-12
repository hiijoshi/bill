export function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === 'string') {
    const message = error.toLowerCase()
    return message.includes('aborted') || message.includes('aborterror')
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    const message = error.message.toLowerCase()
    if (message.includes('aborted') || message.includes('aborterror')) {
      return true
    }
  }

  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown }
  if (candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR') {
    return true
  }

  if (typeof candidate?.message === 'string') {
    const message = candidate.message.toLowerCase()
    if (message.includes('aborted') || message.includes('aborterror')) {
      return true
    }
  }

  if (typeof (error as { toString?: () => string }).toString === 'function') {
    const text = String((error as { toString: () => string }).toString()).toLowerCase()
    if (text.includes('aborted') || text.includes('aborterror')) {
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
