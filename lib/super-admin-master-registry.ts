export type MasterFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select'

export type MasterOption = {
  label: string
  value: string
}

export type MasterFieldDefinition = {
  key: string
  rowKey?: string
  label: string
  type: MasterFieldType
  required?: boolean
  placeholder?: string
  defaultValue?: string | boolean
  options?: MasterOption[]
  optionSource?: {
    key: string
    endpoint: string
    labelKey: string
    valueKey: string
  }
}

export type MasterColumnDefinition = {
  key: string
  label: string
}

export type MasterResourceDefinition = {
  key: string
  label: string
  endpoint: string
  createCompanyIdInBody?: boolean
  fixedValues?: Record<string, string | number | boolean | null>
  rowFilter?: {
    key: string
    value: string
  }
  helperText?: string
  fields: MasterFieldDefinition[]
  columns: MasterColumnDefinition[]
}

const productFields: MasterFieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'unit',
    label: 'Unit',
    type: 'select',
    required: true,
    optionSource: {
      key: 'units',
      endpoint: '/api/units',
      labelKey: 'symbol',
      valueKey: 'symbol'
    }
  },
  { key: 'hsnCode', label: 'HSN Code', type: 'text' },
  { key: 'gstRate', label: 'GST Rate', type: 'number', defaultValue: '0' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'number' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
]

const productColumns: MasterColumnDefinition[] = [
  { key: 'name', label: 'Name' },
  { key: 'unit', label: 'Unit' },
  { key: 'gstRate', label: 'GST' },
  { key: 'sellingPrice', label: 'Selling Price' },
  { key: 'isActive', label: 'Active' }
]

export const SUPER_ADMIN_MASTER_RESOURCES: MasterResourceDefinition[] = [
  {
    key: 'parties',
    label: 'Parties',
    endpoint: '/api/parties',
    helperText: 'Buyer limit is stored on the party record as Credit Limit and Credit Days.',
    fields: [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        required: true,
        defaultValue: 'buyer',
        options: [
          { label: 'Buyer', value: 'buyer' },
          { label: 'Farmer', value: 'farmer' }
        ]
      },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'phone1', label: 'Phone 1', type: 'text' },
      { key: 'phone2', label: 'Phone 2', type: 'text' },
      { key: 'creditLimit', label: 'Credit Limit', type: 'number' },
      { key: 'creditDays', label: 'Credit Days', type: 'number' },
      { key: 'bankName', label: 'Bank Name', type: 'text' },
      { key: 'accountNo', label: 'Account No', type: 'text' },
      { key: 'ifscCode', label: 'IFSC Code', type: 'text' }
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'name', label: 'Name' },
      { key: 'phone1', label: 'Phone 1' },
      { key: 'address', label: 'Address' },
      { key: 'creditLimit', label: 'Credit Limit' }
    ]
  },
  {
    key: 'buyer-limits',
    label: 'Buyer Limits',
    endpoint: '/api/parties',
    rowFilter: {
      key: 'type',
      value: 'buyer'
    },
    fixedValues: {
      type: 'buyer'
    },
    helperText: 'Use this screen to create or update buyer credit limit and credit days for overdue alerts in sales.',
    fields: [
      { key: 'name', label: 'Buyer Name', type: 'text', required: true },
      { key: 'phone1', label: 'Mobile Number', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'creditLimit', label: 'Credit Limit', type: 'number' },
      { key: 'creditDays', label: 'Credit Days', type: 'number' },
      { key: 'bankName', label: 'Bank Name', type: 'text' },
      { key: 'accountNo', label: 'Account No', type: 'text' },
      { key: 'ifscCode', label: 'IFSC Code', type: 'text' }
    ],
    columns: [
      { key: 'name', label: 'Buyer Name' },
      { key: 'phone1', label: 'Mobile' },
      { key: 'creditLimit', label: 'Credit Limit' },
      { key: 'creditDays', label: 'Credit Days' },
      { key: 'address', label: 'Address' }
    ]
  },
  {
    key: 'products',
    label: 'Products',
    endpoint: '/api/products',
    fields: productFields,
    columns: productColumns
  },
  {
    key: 'purchase-items',
    label: 'Purchase Items',
    endpoint: '/api/products',
    fields: productFields,
    columns: productColumns
  },
  {
    key: 'sales-item-masters',
    label: 'Sales Items',
    endpoint: '/api/sales-item-masters',
    createCompanyIdInBody: true,
    fields: [
      {
        key: 'productId',
        rowKey: 'product.id',
        label: 'Product',
        type: 'select',
        required: true,
        optionSource: {
          key: 'products',
          endpoint: '/api/products',
          labelKey: 'name',
          valueKey: 'id'
        }
      },
      { key: 'salesItemName', label: 'Sales Item Name', type: 'text', required: true },
      { key: 'hsnCode', label: 'HSN Code', type: 'text' },
      { key: 'gstRate', label: 'GST Rate', type: 'number' },
      { key: 'sellingPrice', label: 'Selling Price', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    columns: [
      { key: 'salesItemName', label: 'Sales Item' },
      { key: 'product.name', label: 'Product' },
      { key: 'gstRate', label: 'GST' },
      { key: 'sellingPrice', label: 'Price' },
      { key: 'isActive', label: 'Active' }
    ]
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    endpoint: '/api/suppliers',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'phone1', label: 'Phone 1', type: 'text' }
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'phone1', label: 'Phone' },
      { key: 'address', label: 'Address' }
    ]
  },
  {
    key: 'banks',
    label: 'Banks',
    endpoint: '/api/banks',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'branch', label: 'Branch', type: 'text' },
      { key: 'ifscCode', label: 'IFSC', type: 'text', required: true },
      { key: 'accountNumber', label: 'Account Number', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'branch', label: 'Branch' },
      { key: 'ifscCode', label: 'IFSC' },
      { key: 'accountNumber', label: 'Account' },
      { key: 'isActive', label: 'Active' }
    ]
  },
  {
    key: 'payment-modes',
    label: 'Payment Modes',
    endpoint: '/api/payment-modes',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
      { key: 'isActive', label: 'Active' }
    ]
  },
  {
    key: 'markas',
    label: 'Markas',
    endpoint: '/api/markas',
    fields: [
      { key: 'markaNumber', label: 'Marka Number', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    columns: [
      { key: 'markaNumber', label: 'Marka Number' },
      { key: 'description', label: 'Description' },
      { key: 'isActive', label: 'Active' }
    ]
  },
  {
    key: 'transports',
    label: 'Transports',
    endpoint: '/api/transports',
    fields: [
      { key: 'transporterName', label: 'Transporter Name', type: 'text', required: true },
      { key: 'vehicleNumber', label: 'Vehicle Number', type: 'text' },
      { key: 'driverName', label: 'Driver Name', type: 'text' },
      { key: 'driverPhone', label: 'Driver Phone', type: 'text' },
      { key: 'vehicleType', label: 'Vehicle Type', type: 'text' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'freightRate', label: 'Freight Rate', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    columns: [
      { key: 'transporterName', label: 'Transporter' },
      { key: 'vehicleNumber', label: 'Vehicle' },
      { key: 'driverName', label: 'Driver' },
      { key: 'freightRate', label: 'Freight Rate' },
      { key: 'isActive', label: 'Active' }
    ]
  },
  {
    key: 'units',
    label: 'Units',
    endpoint: '/api/units',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text', required: true },
      { key: 'kgEquivalent', label: 'KG Equivalent', type: 'number', required: true },
      { key: 'description', label: 'Description', type: 'textarea' }
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'symbol', label: 'Symbol' },
      { key: 'kgEquivalent', label: 'KG Eq.' },
      { key: 'isUniversal', label: 'Universal' }
    ]
  }
]

export function getMasterResourceByKey(key: string): MasterResourceDefinition {
  return SUPER_ADMIN_MASTER_RESOURCES.find((resource) => resource.key === key) || SUPER_ADMIN_MASTER_RESOURCES[0]
}

export function getNestedValue(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, row)
}
