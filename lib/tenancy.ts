// Multi-tenant Mandi ERP Architecture
export interface TenantContext {
  companyId: string
  traderId: string
  userId: string
  role: 'super_admin' | 'trader_admin' | 'staff'
}

export interface MandiRates {
  mandiTax: number // Cess rate
  nirashritShulk: number // Nirashrit Shulk rate
  labourRate: number // Hamali rate per quintal
}

export interface WeightCalculation {
  totalBags: number
  bagSize: number // KG per bag
  manualDeduction: number // KG
  netWeight: number // in Quintals
}

export function calculateNetWeight(totalBags: number, bagSize: number, manualDeduction: number): number {
  const totalWeight = (totalBags * bagSize) - manualDeduction
  return totalWeight / 100 // Convert to Quintals
}

export function calculateTaxes(amount: number, rates: MandiRates): {
  mandiTax: number
  nirashritShulk: number
  labour: number
  total: number
} {
  const mandiTax = amount * (rates.mandiTax / 100)
  const nirashritShulk = amount * (rates.nirashritShulk / 100)
  const labour = amount * (rates.labourRate / 100)
  
  return {
    mandiTax,
    nirashritShulk,
    labour,
    total: mandiTax + nirashritShulk + labour
  }
}

export function validateTenantAccess(userCompanyId: string, requestedCompanyId: string): boolean {
  return userCompanyId === requestedCompanyId
}
