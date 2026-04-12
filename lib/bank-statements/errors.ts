import { NextResponse } from 'next/server'
import type { BankStatementApiErrorCode } from './contracts'

export class BankStatementError extends Error {
  code: BankStatementApiErrorCode
  status: number
  retryable: boolean
  details?: Record<string, unknown>

  constructor(
    code: BankStatementApiErrorCode,
    message: string,
    options?: {
      status?: number
      retryable?: boolean
      details?: Record<string, unknown>
      cause?: unknown
    }
  ) {
    super(message)
    this.name = 'BankStatementError'
    this.code = code
    this.status = options?.status ?? 400
    this.retryable = options?.retryable ?? false
    this.details = options?.details
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

export function toBankStatementErrorResponse(error: unknown) {
  if (error instanceof BankStatementError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details
        }
      },
      { status: error.status }
    )
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unexpected bank statement error',
        retryable: false
      }
    },
    { status: 500 }
  )
}
