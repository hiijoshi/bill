'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { calculateTaxBreakdown, roundCurrency } from '@/lib/billing-calculations'
import { kgToQuintal, round4, toKg } from '@/lib/unit-conversion'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'
import {
  clearDefaultPurchaseProductId,
  getDefaultPurchaseProductId
} from '@/lib/default-product'

interface Product {
  id: string
  name: string
  gstRate?: number | null
}

interface UserUnit {
  id: string
  name: string
  symbol: string
  kgEquivalent: number
  isUniversal: boolean
}

export default function PurchaseEntryPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [userUnits, setUserUnits] = useState<UserUnit[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [farmerName, setFarmerName] = useState('')
  const [farmerAddress, setFarmerAddress] = useState('')
  const [farmerContact, setFarmerContact] = useState('')
  const [krashakAnubandhNumber, setKrashakAnubandhNumber] = useState('')
  const [markaNumber, setMarkaNumber] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [defaultProductId, setDefaultProductIdState] = useState('')
  const [selectedUserUnit, setSelectedUserUnit] = useState('')
  const [noOfBags, setNoOfBags] = useState('')
  const [hammali, setHammali] = useState('')
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('')
  const [payableAmount, setPayableAmount] = useState('')
  const [manualTotalAmount, setManualTotalAmount] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [balance, setBalance] = useState('')
  const [paidAmountError, setPaidAmountError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [billNumber, setBillNumber] = useState('')
  const [lastBillNumber, setLastBillNumber] = useState(0)
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }
  const currencyText = (value: number) => `₹${roundCurrency(Number(value || 0)).toFixed(2)}`

  const getCurrentFinalTotalValue = useCallback(() => {
    const taxableAmount = parseFloat(payableAmount) || 0
    const selectedProductRecord = products.find((product) => product.id === selectedProduct)
    const calculatedTotal = calculateTaxBreakdown(taxableAmount, selectedProductRecord?.gstRate || 0).lineTotal
    return manualTotalAmount !== '' ? roundCurrency(parseFloat(manualTotalAmount) || 0) : calculatedTotal
  }, [manualTotalAmount, payableAmount, products, selectedProduct])

  const handlePaidAmountChange = (value: string) => {
    const normalized = toNonNegative(value)
    if (normalized === '') {
      setPaidAmount('')
      setPaidAmountError('')
      return
    }

    const nextPaid = Number(normalized)
    const maxPayable = getCurrentFinalTotalValue()
    const hasPayable = maxPayable > 0

    if (hasPayable && nextPaid > maxPayable) {
      setPaidAmount(String(maxPayable))
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      return
    }

    setPaidAmount(normalized)
    setPaidAmountError('')
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const companyId = await resolveCompanyId(window.location.search)

      if (!companyId) {
        alert('Company not selected')
        setLoading(false)
        router.push('/company/select')
        return
      }
      setCompanyId(companyId)

      // Same-origin fetch automatically sends auth cookies.
      stripCompanyParamsFromUrl()
      const [productsRes, billsRes, unitsRes] = await Promise.all([
        fetch(`/api/products?companyId=${companyId}`),
        fetch(`/api/purchase-bills?companyId=${companyId}&last=true`),
        fetch(`/api/units?companyId=${companyId}`)
      ])

      // Handle auth/company context failures quickly without retry loops.
      if (!productsRes.ok) {
        if (productsRes.status === 401 || productsRes.status === 403) {
          router.push('/company/select')
          setLoading(false)
          return
        }

        let errJson: unknown = null
        try {
          errJson = await productsRes.json()
        } catch {
          // ignore parse error
        }
        console.error('Failed to fetch products', productsRes.status, errJson)
        setProducts([])
      } else {
        const productsData = await productsRes.json()

        // Ensure products is always an array
        if (Array.isArray(productsData)) {
          setProducts(productsData)
          const rememberedDefault = getDefaultPurchaseProductId(companyId)
          const hasRememberedDefault = productsData.some((item: Product) => item.id === rememberedDefault)
          if (hasRememberedDefault) {
            setDefaultProductIdState(rememberedDefault)
            setSelectedProduct((current) => current || rememberedDefault)
          } else {
            clearDefaultPurchaseProductId(companyId)
            setDefaultProductIdState('')
          }
        } else if (productsData && typeof productsData.error === 'string') {
          console.error('Products API returned error message:', productsData.error)
          setProducts([])
        } else {
          console.error('Products API returned non-array data:', productsData)
          setProducts([])
        }
      }

      // Generate next bill number
      const billsData = billsRes.ok ? await billsRes.json() : { lastBillNumber: 0 }
      const lastBillNum = Number(billsData.lastBillNumber || 0)
      setLastBillNumber(lastBillNum)
      setBillNumber((lastBillNum + 1).toString())

      const unitsData = unitsRes.ok ? await unitsRes.json() : []
      if (Array.isArray(unitsData)) {
        setUserUnits(unitsData)
        const defaultUnit = unitsData.find((unit: UserUnit) => unit.symbol === 'qt') || unitsData[0]
        setSelectedUserUnit((current) => current || defaultUnit?.id || '')
      } else {
        setUserUnits([])
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Calculate hammali when noOfBags changes
  useEffect(() => {
    if (noOfBags) {
      const bags = parseFloat(noOfBags) || 0
      setHammali((bags * 7).toString())
    } else {
      setHammali('')
    }
  }, [noOfBags])

  // Calculate payable amount when weight or rate changes
  useEffect(() => {
    if (weight && rate) {
      const w = parseFloat(weight) || 0
      const r = parseFloat(rate) || 0
      const h = parseFloat(hammali) || 0
      setPayableAmount(Math.max(0, (w * r) - h).toString())
    } else {
      setPayableAmount('')
    }
  }, [weight, rate, hammali])

  // Calculate balance when payable or paid changes
  useEffect(() => {
    const payable = getCurrentFinalTotalValue()
    const paid = parseFloat(paidAmount) || 0

    if (payable > 0 && paidAmount && paid > payable) {
      setPaidAmount(String(payable))
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      setBalance('0')
      return
    } else {
      setPaidAmountError('')
    }

    if (payable > 0 && paidAmount) {
      setBalance(Math.max(0, payable - paid).toString())
      return
    }
    setBalance('')
  }, [getCurrentFinalTotalValue, paidAmount])

  useEffect(() => {
    const bags = parseFloat(noOfBags) || 0
    const selected = userUnits.find((u) => u.id === selectedUserUnit)
    if (!selected || bags <= 0) return

    const totalKg = toKg(bags, Number(selected.kgEquivalent || 1))
    const totalQt = round4(kgToQuintal(totalKg))
    setWeight(totalQt.toString())
  }, [noOfBags, selectedUserUnit, userUnits])

  const submitPurchase = async (printAfterSave = false) => {
    if (submitting) return
    // Basic validation
    if (!farmerName || !selectedProduct || !weight || !rate || !billNumber) {
      alert('Please fill all required fields and wait for bill number to load')
      return
    }
    if (farmerContact && farmerContact.length !== 10) {
      alert('Farmer contact must be exactly 10 digits')
      return
    }

    // Payment validation
    const payable = getCurrentFinalTotalValue()
    const paid = parseFloat(paidAmount) || 0

    // Check if paid amount exceeds payable amount
    if (paid > payable) {
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      return
    }

    // Determine payment status
    let status = 'unpaid'
    if (paid > 0) {
      if (paid === payable) {
        status = 'paid'
      } else {
        status = 'partial'
      }
    }

    try {
      setSubmitting(true)
      const companyId = await resolveCompanyId(window.location.search)
      if (!companyId) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      const requestData = {
        companyId,
        billNumber,
        billDate,
        farmerName,
        farmerAddress,
        farmerContact,
        krashakAnubandhNumber,
        markaNumber,
        productId: selectedProduct,
        noOfBags: parseFloat(noOfBags) || 0,
        hammali: parseFloat(hammali) || 0,
        weight: Math.max(0, parseFloat(weight) || 0),
        rate: Math.max(0, parseFloat(rate) || 0),
        payableAmount: Math.max(0, parseFloat(payableAmount) || 0),
        totalAmount: Math.max(0, payable),
        paidAmount: Math.max(0, parseFloat(paidAmount) || 0),
        balance: Math.max(0, parseFloat(balance) || 0),
        status,
        userUnitName: userUnits.find((u) => u.id === selectedUserUnit)?.name || null,
        kgEquivalent: userUnits.find((u) => u.id === selectedUserUnit)?.kgEquivalent || null,
        totalWeightQt: parseFloat(weight) || 0
      }

      const response = await fetch('/api/purchase-bills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      const responseData = await response.json()

      if (response.ok) {
        if (printAfterSave && responseData?.id) {
          const printPath = companyId
            ? `/purchase/${responseData.id}/print?companyId=${encodeURIComponent(companyId)}`
            : `/purchase/${responseData.id}/print`
          router.push(printPath)
          return
        }
        alert('Purchase bill created successfully!')
        router.push('/purchase/list')
      } else {
        alert('Error creating purchase bill: ' + (responseData.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error creating purchase bill: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }
  const defaultProductName = products.find((product) => product.id === defaultProductId)?.name || ''
  const selectedProductRecord = products.find((product) => product.id === selectedProduct) || null
  const taxPreview = calculateTaxBreakdown(parseFloat(payableAmount) || 0, selectedProductRecord?.gstRate || 0)
  const finalTotalAmount = getCurrentFinalTotalValue()

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Purchase Entry</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitPurchase(false)
                }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Bill Number */}
                  <div>
                    <Label htmlFor="billNumber">Bill Number</Label>
                    <Input id="billNumber" value={billNumber} readOnly className="bg-gray-100" />
                    <p className="text-sm text-gray-500 mt-1">
                      Last bill: {lastBillNumber} | Next: {billNumber}
                    </p>
                  </div>

                  {/* Bill Date */}
                  <div>
                    <Label htmlFor="billDate">Bill Date</Label>
                    <Input
                      id="billDate"
                      type="date"
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      required
                    />
                  </div>

                  {/* Farmer Name */}
                  <div>
                    <Label htmlFor="farmerName">Farmer Name</Label>
                    <Input
                      id="farmerName"
                      value={farmerName}
                      onChange={(e) => setFarmerName(e.target.value)}
                      placeholder="Enter farmer name"
                      required
                    />
                  </div>

                  {/* Farmer Address */}
                  <div>
                    <Label htmlFor="farmerAddress">Farmer Address</Label>
                    <Input
                      id="farmerAddress"
                      value={farmerAddress}
                      onChange={(e) => setFarmerAddress(e.target.value)}
                      placeholder="Enter farmer address"
                    />
                  </div>

                  {/* Farmer Contact */}
                  <div>
  <Label htmlFor="farmerContact">Farmer Contact</Label>
  <Input
    id="farmerContact"
    type="tel"
    value={farmerContact}
    maxLength={10}
    pattern="[0-9]{10}"
    placeholder="Enter 10 digit farmer contact"
    onChange={(e) => {
      // Allow only numbers and limit to 10 digits
      const value = e.target.value.replace(/\D/g, "").slice(0, 10);
      setFarmerContact(value);
    }}
  />
</div>

                  {/* Krashak Anubandh Number */}
                  <div>
                    <Label htmlFor="krashakAnubandhNumber">Krashak Anubandh Number</Label>
                    <Input
                      id="krashakAnubandhNumber"
                      value={krashakAnubandhNumber}
                      onChange={(e) => setKrashakAnubandhNumber(e.target.value)}
                      placeholder="Enter Krashak Anubandh Number"
                    />
                  </div>

                  {/* Marka Number */}
                  <div>
                    <Label htmlFor="markaNumber">Marka No.</Label>
                    <Input
                      id="markaNumber"
                      value={markaNumber}
                      onChange={(e) => setMarkaNumber(e.target.value)}
                      placeholder="Enter Marka Number"
                    />
                  </div>

                  {/* Product */}
                  <div>
                    <Label htmlFor="product">Purchase Product</Label>
                    <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select Product" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.isArray(products) && products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {defaultProductName ? (
                      <p className="mt-1 text-xs text-slate-600">Default from Product Master: {defaultProductName}</p>
                    ) : null}
                    {selectedProductRecord ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Tax rule: {Number(selectedProductRecord.gstRate || 0) > 0 ? `${Number(selectedProductRecord.gstRate || 0).toFixed(2)}% GST` : 'Non-GST / tax-free'}
                      </p>
                    ) : null}
                  </div>

                  {/* User Unit */}
                  <div>
                    <Label htmlFor="userUnit">User Unit (for conversion)</Label>
                    <Select value={selectedUserUnit} onValueChange={setSelectedUserUnit}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Unit e.g. Bag 90KG" />
                      </SelectTrigger>
                      <SelectContent>
                        {userUnits.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name} ({unit.symbol}) = {Number(unit.kgEquivalent || 0).toFixed(4)} KG
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* No. of Bags */}
                  <div>
                    <Label htmlFor="noOfBags">No. of Bags</Label>
                    <Input
                      id="noOfBags"
                      type="number"
                      min="0"
                      value={noOfBags}
                      onChange={(e) => setNoOfBags(toNonNegative(e.target.value))}
                      placeholder="Enter number of bags"
                    />
                  </div>

                  {/* Hammali */}
                  <div>
                    <Label htmlFor="hammali">Hammali</Label>
                    <Input
                      id="hammali"
                      value={hammali}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  {/* Weight */}
                  <div>
                    <Label htmlFor="weight">Weight (Quintal, Universal Base)</Label>
                    <Input
                      id="weight"
                      type="number"
                      min="0"
                      step="0.01"
                      value={weight}
                      onChange={(e) => setWeight(toNonNegative(e.target.value))}
                      placeholder="Enter weight"
                      required
                    />
                  </div>

                  {/* Rate */}
                  <div>
                    <Label htmlFor="rate">Average Rate / Qt</Label>
                    <Input
                      id="rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={rate}
                      onChange={(e) => setRate(toNonNegative(e.target.value))}
                      placeholder="Enter rate"
                      required
                    />
                  </div>

                  {/* Payable Amount */}
                  <div>
                    <Label htmlFor="payableAmount">Taxable Amount</Label>
                    <Input
                      id="payableAmount"
                      value={payableAmount}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  <div>
                    <Label htmlFor="gstAmount">GST Amount</Label>
                    <Input
                      id="gstAmount"
                      value={taxPreview.gstAmount.toFixed(2)}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  <div>
                    <Label htmlFor="calculatedTotalAmount">Calculated Total</Label>
                    <Input
                      id="calculatedTotalAmount"
                      value={taxPreview.lineTotal.toFixed(2)}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  <div>
                    <Label htmlFor="manualTotalAmount">Final Invoice Total</Label>
                    <Input
                      id="manualTotalAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualTotalAmount}
                      onChange={(e) => setManualTotalAmount(toNonNegative(e.target.value))}
                      placeholder={taxPreview.lineTotal.toFixed(2)}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Leave blank to keep the GST-calculated total. Enter a value only when the final bill total needs a manual override.
                    </p>
                  </div>

                  {/* Paid Amount */}
                  <div>
                    <Label htmlFor="paidAmount">Paid Amount</Label>
                    <Input
                      id="paidAmount"
                      type="number"
                      min="0"
                      max={finalTotalAmount || undefined}
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => handlePaidAmountChange(e.target.value)}
                      placeholder="Enter paid amount"
                      className={paidAmountError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                    />
                    {paidAmountError ? (
                      <p className="mt-1 text-right text-sm text-red-600">{paidAmountError}</p>
                    ) : null}
                  </div>

                  {/* Balance */}
                  <div>
                    <Label htmlFor="balance">Balance</Label>
                    <Input
                      id="balance"
                      value={balance}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">GST Status</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {taxPreview.gstRate > 0 ? `${taxPreview.gstRate.toFixed(2)}% GST` : 'Non-GST'}
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">Calculated Total</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{currencyText(taxPreview.lineTotal)}</p>
                  </div>
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">Final Invoice Total</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-700">{currencyText(finalTotalAmount)}</p>
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setManualTotalAmount('')} disabled={manualTotalAmount === ''}>
                    Reset Total
                  </Button>
                  <Button type="button" variant="outline" disabled={submitting} onClick={() => void submitPurchase(true)}>
                    Save & Print
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Saving...' : 'Save Purchase Bill'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
