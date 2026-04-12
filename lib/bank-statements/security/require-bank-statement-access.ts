import { NextRequest, NextResponse } from 'next/server'
import { ensureCompanyAccessForAction, requireRoles, type RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { BankStatementError } from '../errors'

type AllowedRole = 'super_admin' | 'trader_admin' | 'company_admin' | 'company_user'
const BANK_STATEMENT_ALLOWED_ROLES: AllowedRole[] = ['super_admin', 'trader_admin', 'company_admin', 'company_user']

export async function requireBankStatementAccess(
  request: NextRequest,
  action: 'read' | 'write'
): Promise<
  | { ok: true; auth: RequestAuthContext }
  | { ok: false; response: NextResponse }
> {
  void action
  const authResult = requireRoles(request, BANK_STATEMENT_ALLOWED_ROLES)
  if (!authResult.ok) {
    const status = authResult.response.status
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN',
            message: status === 401 ? 'Authentication is required.' : 'You do not have permission to access bank statements.',
            retryable: status === 401
          }
        },
        { status }
      )
    }
  }

  return { ok: true, auth: authResult.auth }
}

export async function assertCompanyScope(
  request: NextRequest,
  companyId: string,
  action: 'read' | 'write'
): Promise<void> {
  const denied = await ensureCompanyAccessForAction(request, companyId, action)
  if (denied) {
    const payload = await denied.json().catch(() => ({ error: 'Company access denied' }))
    throw new BankStatementError('COMPANY_SCOPE_DENIED', String(payload?.error || 'Company access denied'), {
      status: denied.status
    })
  }
}

export async function assertBankBelongsToCompany(companyId: string, bankId: string) {
  const bank = await prisma.bank.findFirst({
    where: {
      id: bankId,
      companyId,
      isActive: true
    }
  })

  if (!bank) {
    throw new BankStatementError('BANK_SCOPE_DENIED', 'Selected bank account is not available for this company.', {
      status: 403
    })
  }

  return bank
}

export async function assertCompanyExists(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      traderId: true,
      deletedAt: true
    }
  })

  if (!company || company.deletedAt) {
    throw new BankStatementError('COMPANY_SCOPE_DENIED', 'Selected company was not found or is inactive.', {
      status: 404,
      details: { companyId }
    })
  }

  return company
}

export async function resolveBankStatementActorUser(auth: RequestAuthContext) {
  const resolvedUser = auth.userDbId
    ? await prisma.user.findFirst({
        where: {
          id: auth.userDbId,
          traderId: auth.traderId,
          deletedAt: null
        },
        select: {
          id: true,
          userId: true,
          traderId: true,
          companyId: true,
          role: true
        }
      })
    : await prisma.user.findFirst({
        where: {
          traderId: auth.traderId,
          userId: auth.userId,
          deletedAt: null
        },
        select: {
          id: true,
          userId: true,
          traderId: true,
          companyId: true,
          role: true
        }
      })

  if (!resolvedUser) {
    if (auth.role === 'super_admin') {
      return null
    }

    throw new BankStatementError('AUTH_REQUIRED', 'Authenticated user record was not found. Please sign in again.', {
      status: 401,
      retryable: true,
      details: {
        userId: auth.userId,
        userDbId: auth.userDbId,
        traderId: auth.traderId
      }
    })
  }

  return resolvedUser
}

export async function assertBatchBelongsToCompany(companyId: string, batchId: string) {
  const batch = await prisma.bankStatementBatch.findFirst({
    where: {
      id: batchId,
      companyId
    }
  })

  if (!batch) {
    throw new BankStatementError('BATCH_NOT_FOUND', 'Bank statement batch was not found for this company.', {
      status: 404
    })
  }

  return batch
}

export async function assertRowBelongsToCompany(companyId: string, rowId: string) {
  const row = await prisma.bankStatementRow.findFirst({
    where: {
      id: rowId,
      companyId
    }
  })

  if (!row) {
    throw new BankStatementError('ROW_NOT_FOUND', 'Bank statement row was not found for this company.', {
      status: 404
    })
  }

  return row
}
