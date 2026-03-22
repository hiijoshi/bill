export type BankSyncProvider = 'manual' | 'account_aggregator'

export type BankSyncMode = 'manual_import' | 'auto_sync'

export interface NormalizedBankEntry {
  externalId: string
  postedAt: string
  amount: number
  currency: string
  direction: 'in' | 'out'
  description: string
  reference?: string | null
  bankName?: string | null
  accountMask?: string | null
  metadata?: Record<string, string | number | boolean | null>
}

export interface BankSyncCursor {
  cursor?: string | null
  fromDate?: string | null
  toDate?: string | null
}

export interface BankSyncFetchInput {
  companyId: string
  cursor?: BankSyncCursor | null
}

export interface BankSyncProviderStatus {
  provider: BankSyncProvider
  label: string
  mode: BankSyncMode
  configured: boolean
  ready: boolean
  supportsImport: boolean
  supportsAutoSync: boolean
  supportsHistoricalSync: boolean
  supportsWebhook: boolean
  message: string
}

export interface BankPaymentImportDraft {
  provider: BankSyncProvider
  companyId: string
  externalId: string
  payDate: string
  amount: number
  mode: 'bank' | 'online'
  direction: 'in' | 'out'
  txnRef: string | null
  note: string | null
  bankNameSnapshot: string | null
  beneficiaryBankAccount: string | null
  rawEntry: NormalizedBankEntry
}

export interface BankEntryProvider {
  provider: BankSyncProvider
  label: string
  getStatus(input: { companyId: string }): Promise<BankSyncProviderStatus>
  fetchEntries(input: BankSyncFetchInput): Promise<{
    entries: NormalizedBankEntry[]
    nextCursor?: BankSyncCursor | null
  }>
  toPaymentImportDraft(entry: NormalizedBankEntry, input: { companyId: string }): BankPaymentImportDraft
}

export const SUPPORTED_BANK_SYNC_PROVIDERS: BankSyncProvider[] = ['manual', 'account_aggregator']

function createPaymentImportDraft(
  provider: BankSyncProvider,
  entry: NormalizedBankEntry,
  input: { companyId: string }
): BankPaymentImportDraft {
  return {
    provider,
    companyId: input.companyId,
    externalId: entry.externalId,
    payDate: entry.postedAt,
    amount: Number(entry.amount || 0),
    mode: entry.reference ? 'online' : 'bank',
    direction: entry.direction,
    txnRef: entry.reference?.trim() || null,
    note: entry.description?.trim() || null,
    bankNameSnapshot: entry.bankName?.trim() || null,
    beneficiaryBankAccount: entry.accountMask?.trim() || null,
    rawEntry: entry
  }
}

export class ManualBankEntryProvider implements BankEntryProvider {
  provider: BankSyncProvider = 'manual'
  label = 'Manual Bank Entries'

  async getStatus(): Promise<BankSyncProviderStatus> {
    return {
      provider: this.provider,
      label: this.label,
      mode: 'manual_import',
      configured: true,
      ready: true,
      supportsImport: true,
      supportsAutoSync: false,
      supportsHistoricalSync: false,
      supportsWebhook: false,
      message: 'Manual bank and online entries are ready to use today.'
    }
  }

  async fetchEntries(): Promise<{ entries: NormalizedBankEntry[]; nextCursor: null }> {
    return {
      entries: [],
      nextCursor: null
    }
  }

  toPaymentImportDraft(entry: NormalizedBankEntry, input: { companyId: string }): BankPaymentImportDraft {
    return createPaymentImportDraft(this.provider, entry, input)
  }
}

export class AccountAggregatorBankEntryProvider implements BankEntryProvider {
  provider: BankSyncProvider = 'account_aggregator'
  label = 'Account Aggregator'

  async getStatus(): Promise<BankSyncProviderStatus> {
    return {
      provider: this.provider,
      label: this.label,
      mode: 'auto_sync',
      configured: false,
      ready: false,
      supportsImport: true,
      supportsAutoSync: true,
      supportsHistoricalSync: true,
      supportsWebhook: true,
      message: 'Integration contract is ready, but the live Account Aggregator connector is not configured yet.'
    }
  }

  async fetchEntries(): Promise<{ entries: NormalizedBankEntry[]; nextCursor: null }> {
    throw new Error('Account Aggregator connector is not configured yet')
  }

  toPaymentImportDraft(entry: NormalizedBankEntry, input: { companyId: string }): BankPaymentImportDraft {
    return createPaymentImportDraft(this.provider, entry, input)
  }
}

export function createBankEntryProvider(provider: BankSyncProvider = 'manual'): BankEntryProvider {
  if (provider === 'account_aggregator') {
    return new AccountAggregatorBankEntryProvider()
  }

  return new ManualBankEntryProvider()
}
