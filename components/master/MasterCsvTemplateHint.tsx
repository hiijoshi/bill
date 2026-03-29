'use client'

type MasterCsvTemplateKey =
  | 'product'
  | 'supplier'
  | 'sales-item'
  | 'marka'
  | 'party'
  | 'transport'
  | 'unit'
  | 'payment-mode'
  | 'bank'

type TemplateDefinition = {
  fileName: string
  headers: string[]
  sampleRow: string[]
}

const TEMPLATE_DEFINITIONS: Record<MasterCsvTemplateKey, TemplateDefinition> = {
  product: {
    fileName: 'product-import-sample.csv',
    headers: ['Name', 'Unit', 'HSNCode', 'GSTRate', 'SellingPrice', 'Description', 'Active'],
    sampleRow: ['Garlic', 'kg', '0703', '5', '1200', 'Fresh stock item', 'true']
  },
  supplier: {
    fileName: 'supplier-import-sample.csv',
    headers: ['Name', 'Phone1', 'Phone2', 'Address', 'BankName', 'AccountNo', 'IFSCCode', 'GSTNumber'],
    sampleRow: ['Demo Supplier', '9876543210', '9123456780', 'Main Market, Jaipur', 'ICICI Bank', '556677889900', 'ICIC0000123', '08ABCDE1234F1Z9']
  },
  'sales-item': {
    fileName: 'sales-item-import-sample.csv',
    headers: ['ProductName', 'SalesItemName', 'HSNCode', 'GSTRate', 'SellingPrice', 'Description', 'Active'],
    sampleRow: ['Garlic', 'Garlic Premium', '0703', '5', '1350', 'Premium sale item', 'true']
  },
  marka: {
    fileName: 'marka-import-sample.csv',
    headers: ['MarkaNumber', 'Description', 'Active'],
    sampleRow: ['M-101', 'Default marka code', 'true']
  },
  party: {
    fileName: 'party-import-sample.csv',
    headers: ['Type', 'Name', 'Address', 'Phone1', 'Phone2', 'OpeningBalance', 'OpeningBalanceType', 'OpeningBalanceDate', 'CreditLimit', 'CreditDays', 'BankName', 'AccountNo', 'IFSCCode'],
    sampleRow: ['buyer', 'Demo Buyer', 'Main Market, Mumbai', '9876543212', '8982895331', '10000', 'receivable', '01/04/2026', '500000', '30', 'ICICI Bank', '556677889900', 'ICIC0000456']
  },
  transport: {
    fileName: 'transport-import-sample.csv',
    headers: ['Transporter', 'VehicleNumber', 'DriverName', 'DriverPhone', 'VehicleType', 'Capacity', 'FreightRate', 'Description', 'Active'],
    sampleRow: ['Demo Transport', 'MH12AB1234', 'Ramesh', '9876543210', 'Truck', '18', '4500', 'Primary transport vehicle', 'true']
  },
  unit: {
    fileName: 'unit-import-sample.csv',
    headers: ['Name', 'Symbol', 'KGEquivalent', 'Description'],
    sampleRow: ['Kilogram', 'kg', '1', 'Standard kilogram unit']
  },
  'payment-mode': {
    fileName: 'payment-mode-import-sample.csv',
    headers: ['Name', 'Code', 'Description', 'Active'],
    sampleRow: ['NEFT', 'NEFT', 'Bank transfer mode', 'true']
  },
  bank: {
    fileName: 'bank-import-sample.csv',
    headers: ['Name', 'IFSCCode', 'Branch', 'AccountNumber', 'Address', 'Phone', 'Active'],
    sampleRow: ['State Bank of India', 'SBIN0000123', 'Main Market', '123456789012', 'Mumbai Branch', '9876543210', 'true']
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function downloadCsvFile(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

interface MasterCsvTemplateHintProps {
  templateKey: MasterCsvTemplateKey
  className?: string
}

export default function MasterCsvTemplateHint({ templateKey, className = '' }: MasterCsvTemplateHintProps) {
  const definition = TEMPLATE_DEFINITIONS[templateKey]

  return (
    <p className={`text-xs text-slate-500 ${className}`.trim()}>
      Need import format?{' '}
      <button
        type="button"
        onClick={() => downloadCsvFile(definition.fileName, [definition.headers, definition.sampleRow])}
        className="font-medium text-slate-900 underline underline-offset-4 transition-colors hover:text-slate-700"
      >
        Download sample template here
      </button>
      .
    </p>
  )
}
