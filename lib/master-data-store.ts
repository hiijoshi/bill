import { promises as fs } from 'fs'
import path from 'path'

export interface BankRecord {
  id: string
  companyId: string
  name: string
  branch: string | null
  ifscCode: string
  accountNumber: string | null
  address: string | null
  phone: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface MarkaRecord {
  id: string
  companyId: string
  markaNumber: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface PaymentModeRecord {
  id: string
  companyId: string
  name: string
  code: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface MasterStore {
  banks: BankRecord[]
  markas: MarkaRecord[]
  paymentModes: PaymentModeRecord[]
}

const DEFAULT_STORE: MasterStore = {
  banks: [],
  markas: [],
  paymentModes: []
}

const STORE_DIR = path.join(process.cwd(), 'data')
const STORE_PATH = path.join(STORE_DIR, 'master-data.json')

function normalizeStore(input: unknown): MasterStore {
  if (!input || typeof input !== 'object') return DEFAULT_STORE
  const obj = input as Partial<MasterStore>
  return {
    banks: Array.isArray(obj.banks) ? obj.banks : [],
    markas: Array.isArray(obj.markas) ? obj.markas : [],
    paymentModes: Array.isArray(obj.paymentModes) ? obj.paymentModes : []
  }
}

async function ensureStoreFile(): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true })
  try {
    await fs.access(STORE_PATH)
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2), 'utf-8')
  }
}

async function readStore(): Promise<MasterStore> {
  await ensureStoreFile()
  const raw = await fs.readFile(STORE_PATH, 'utf-8')
  try {
    return normalizeStore(JSON.parse(raw))
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2), 'utf-8')
    return DEFAULT_STORE
  }
}

async function writeStore(store: MasterStore): Promise<void> {
  await ensureStoreFile()
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

export async function withMasterStore<T>(handler: (store: MasterStore) => T | Promise<T>): Promise<T> {
  const store = await readStore()
  const result = await handler(store)
  await writeStore(store)
  return result
}
