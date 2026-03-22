import { z } from 'zod'

// Common schemas
const idSchema = z.string().min(1, 'ID is required')

// Authentication schemas
export const loginSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
  password: z.string().min(1, 'Password is required'),
  traderId: z.string().trim().optional()
}).strict()

export const createUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  traderId: z.string().min(1, 'Trader ID is required'),
  name: z.string().optional(),
  role: z.enum(['admin', 'user']).default('user')
})

// Company schemas
export const createCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  address: z.string().optional(),
  phone: z.string().optional(),
  mandiAccountNumber: z.string().optional(),
  traderId: z.string().optional()
})

export const updateCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required').optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  mandiAccountNumber: z.string().optional()
})

// Party schemas
export const createPartySchema = z.object({
  companyId: idSchema,
  type: z.enum(['farmer', 'buyer']),
  name: z.string().min(1, 'Party name is required'),
  address: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  ifscCode: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional()
})

// Farmer schemas
export const createFarmerSchema = z.object({
  companyId: idSchema,
  name: z.string().min(1, 'Farmer name is required'),
  address: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  ifscCode: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  krashakAnubandhNumber: z.string().optional()
})

// Supplier schemas
export const createSupplierSchema = z.object({
  companyId: idSchema,
  name: z.string().min(1, 'Supplier name is required'),
  address: z.string().optional(),
  phone1: z.string().optional(),
  phone2: z.string().optional(),
  ifscCode: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  gstNumber: z.string().optional()
})

// Product schemas
export const createProductSchema = z.object({
  companyId: idSchema,
  name: z.string().min(1, 'Product name is required'),
  unitId: idSchema,
  hsnCode: z.string().optional(),
  gstRate: z.number().min(0).max(100).optional(),
  sellingPrice: z.number().min(0).optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true)
})

// Unit schemas
export const createUnitSchema = z.object({
  companyId: idSchema,
  name: z.string().min(1, 'Unit name is required'),
  symbol: z.string().min(1, 'Unit symbol is required'),
  description: z.string().optional()
})

// Purchase Bill schemas
export const createPurchaseBillSchema = z.object({
  companyId: idSchema,
  billNo: z.string().min(1, 'Bill number is required'),
  billDate: z.string().transform((str) => new Date(str)),
  farmerId: idSchema,
  items: z.array(z.object({
    productId: idSchema,
    qty: z.number().min(0),
    rate: z.number().min(0),
    hammali: z.number().min(0).optional(),
    bags: z.number().int().min(0).optional(),
    markaNo: z.string().optional(),
    amount: z.number().min(0)
  })).min(1, 'At least one item is required')
})

// Sales Bill schemas
export const createSalesBillSchema = z.object({
  companyId: idSchema,
  billNo: z.string().min(1, 'Bill number is required'),
  billDate: z.string().transform((str) => new Date(str)),
  partyId: idSchema,
  items: z.array(z.object({
    productId: idSchema,
    weight: z.number().min(0),
    bags: z.number().int().min(0).optional(),
    rate: z.number().min(0),
    amount: z.number().min(0)
  })).min(1, 'At least one item is required')
})

// Payment schemas
export const createPaymentSchema = z.object({
  companyId: idSchema,
  partyId: idSchema.optional(),
  farmerId: idSchema.optional(),
  billType: z.enum(['purchase', 'sales']),
  billId: idSchema,
  billDate: z.string().transform((str) => new Date(str)),
  payDate: z.string().transform((str) => new Date(str)),
  amount: z.number().min(0),
  mode: z.enum(['cash', 'online', 'bank']),
  txnRef: z.string().optional(),
  note: z.string().optional()
}).refine((data) => data.partyId || data.farmerId, {
  message: "Either partyId or farmerId must be provided",
  path: ["partyId"]
})

// Stock Ledger schemas
export const createStockLedgerSchema = z.object({
  companyId: idSchema,
  entryDate: z.string().transform((str) => new Date(str)),
  productId: idSchema,
  type: z.enum(['purchase', 'sales', 'adjustment']),
  qtyIn: z.number().min(0).default(0),
  qtyOut: z.number().min(0).default(0),
  refTable: z.string(),
  refId: idSchema
}).refine((data) => data.qtyIn > 0 || data.qtyOut > 0, {
  message: "Either qtyIn or qtyOut must be greater than 0",
  path: ["qtyIn"]
})

// Transport schemas
export const createTransportSchema = z.object({
  companyId: idSchema,
  transporterName: z.string().min(1, 'Transporter name is required'),
  vehicleNumber: z.string().optional(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  capacity: z.number().min(0).optional(),
  freightRate: z.number().min(0).optional()
})

// Query parameter schemas
export const paginationSchema = z.object({
  page: z.string().transform(Number).default(1),
  limit: z.string().transform(Number).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

export const dateRangeSchema = z.object({
  startDate: z.string().transform((str) => new Date(str)).optional(),
  endDate: z.string().transform((str) => new Date(str)).optional()
})

// Validation helper function
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean
  data?: T
  errors?: string[]
} {
  try {
    const validatedData = schema.parse(data)
    return { success: true, data: validatedData }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`)
      return { success: false, errors }
    }
    return { success: false, errors: ['Validation failed'] }
  }
}
