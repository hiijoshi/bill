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
import { getCompanyIdFromSearch, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
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

interface Supplier {
  id: string
  name: string
  address: string
  phone1: string
}

interface UserUnit {
  id: string
  name: string
  symbol: string
  kgEquivalent: number
}

export default function SpecialPurchaseEntryPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [userUnits, setUserUnits] = useState<UserUnit[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierContact, setSupplierContact] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [defaultProductId, setDefaultProductIdState] = useState('')
  const [selectedUserUnit, setSelectedUserUnit] = useState('')
  const [noOfBags, setNoOfBags] = useState('')
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('')
  const [netAmount, setNetAmount] = useState('')
  const [otherAmount, setOtherAmount] = useState('')
  const [manualGrossAmount, setManualGrossAmount] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [balance, setBalance] = useState('')
  const [paidAmountError, setPaidAmountError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }
  const currencyText = (value: number) => `₹${roundCurrency(Number(value || 0)).toFixed(2)}`

  const getCurrentFinalGrossTotal = useCallback(() => {
    const taxableAmount = parseFloat(netAmount) || 0
    const additionalAmount = parseFloat(otherAmount) || 0
    const selectedProductRecord = products.find((product) => product.id === selectedProduct)
    const calculatedGross = roundCurrency(
      calculateTaxBreakdown(taxableAmount, selectedProductRecord?.gstRate || 0).lineTotal + additionalAmount
    )
    return manualGrossAmount !== '' ? roundCurrency(parseFloat(manualGrossAmount) || 0) : calculatedGross
  }, [manualGrossAmount, netAmount, otherAmount, products, selectedProduct])

  const handlePaidAmountChange = (value: string) => {
    const normalized = toNonNegative(value)
    if (normalized === '') {
      setPaidAmount('')
      setPaidAmountError('')
      return
    }

    const nextPaid = Number(normalized)
    const maxGross = getCurrentFinalGrossTotal()
    const hasGross = maxGross > 0

    if (hasGross && nextPaid > maxGross) {
      setPaidAmount(String(maxGross))
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      return
    }

    setPaidAmount(normalized)
    setPaidAmountError('')
  }

  const fetchData = useCallback(async () => {
    try {
      const companyId = await resolveCompanyId(window.location.search)
      if (!companyId) {
        alert('Company not selected')
        setLoading(false)
        router.push('/company/select')
        return
      }
      stripCompanyParamsFromUrl()

      const [productsRes, suppliersRes, unitsRes] = await Promise.all([
        fetch(`/api/products?companyId=${companyId}`),
        fetch(`/api/suppliers?companyId=${companyId}`),
        fetch(`/api/units?companyId=${companyId}`)
      ])

      const productsData = await productsRes.json().catch(() => [])
      const suppliersData = await suppliersRes.json().catch(() => [])
      const unitsData = await unitsRes.json().catch(() => [])
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
      } else {
        setProducts([])
      }
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : [])
      if (Array.isArray(unitsData)) {
        setUserUnits(unitsData)
        const defaultUnit = unitsData.find((unit: UserUnit) => unit.symbol === 'qt') || unitsData[0]
        setSelectedUserUnit((current) => current || defaultUnit?.id || '')
      } else {
        setUserUnits([])
      }

      setLoading(false)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching data:', error)
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const bags = parseFloat(noOfBags) || 0
    const selected = userUnits.find((unit) => unit.id === selectedUserUnit)
    if (!selected || bags <= 0) return
    const totalKg = toKg(bags, Number(selected.kgEquivalent || 1))
    const totalQt = round4(kgToQuintal(totalKg))
    setWeight(totalQt.toString())
  }, [noOfBags, selectedUserUnit, userUnits])

  // Calculate net amount when weight or rate changes
  useEffect(() => {
    if (weight && rate) {
      const w = parseFloat(weight) || 0
      const r = parseFloat(rate) || 0
      setNetAmount(Math.max(0, w * r).toString())
    } else {
      setNetAmount('')
    }
  }, [weight, rate])

  // Calculate balance when gross or paid changes
  useEffect(() => {
    const gross = getCurrentFinalGrossTotal()
    const paid = parseFloat(paidAmount) || 0

    if (gross > 0 && paidAmount && paid > gross) {
      setPaidAmount(String(gross))
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      setBalance('0')
      return
    } else {
      setPaidAmountError('')
    }

    if (gross > 0 && paidAmount) {
      setBalance(Math.max(0, gross - paid).toString())
      return
    }
    setBalance('')
  }, [getCurrentFinalGrossTotal, paidAmount])

  // Handle supplier selection
  const handleSupplierChange = (supplierId: string) => {
    setSelectedSupplier(supplierId)
    const supplier = suppliers.find(s => s.id === supplierId)
    if (supplier) {
      setSupplierName(supplier.name)
      setSupplierAddress(supplier.address || '')
      setSupplierContact(supplier.phone1 || '')
    } else {
      setSupplierName('')
      setSupplierAddress('')
      setSupplierContact('')
    }
  }

  // Handle new supplier addition
  const handleAddNewSupplier = async () => {
    if (!supplierName) {
      alert('Please enter supplier name')
      return
    }
    if (supplierContact && supplierContact.length !== 10) {
      alert('Supplier contact must be exactly 10 digits')
      return
    }
    try {
      const companyId = await resolveCompanyId(window.location.search)
      if (!companyId) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }
      stripCompanyParamsFromUrl()

      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId,
          name: supplierName,
          address: supplierAddress,
          phone1: supplierContact,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        const newSupplier = result?.supplier ?? result
        if (!newSupplier?.id) {
          alert(result?.error || 'Supplier created but invalid response received')
          return
        }
        setSuppliers((prev) => [...prev, newSupplier])
        setSelectedSupplier(newSupplier.id)
        setSupplierName(newSupplier.name || '')
        setSupplierAddress(newSupplier.address || '')
        setSupplierContact(newSupplier.phone1 || '')
        alert('Supplier added successfully!')
      } else {
        const error = await response.json()
        alert('Error adding supplier: ' + (error.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error adding supplier: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const submitSpecialPurchase = async (printAfterSave = false) => {
    if (submitting) return
    // Basic validation
    if (!supplierInvoiceNo || !supplierName || !selectedProduct || !weight || !rate) {
      alert('Please fill all required fields')
      return
    }
    if (supplierContact && supplierContact.length !== 10) {
      alert('Supplier contact must be exactly 10 digits')
      return
    }
    // Payment validation
    const gross = getCurrentFinalGrossTotal()
    const paid = parseFloat(paidAmount) || 0
    if (gross < 0 || paid < 0) {
      alert('Amounts cannot be negative')
      return
    }

    // Check if paid amount exceeds gross amount
    if (paid > gross) {
      setPaidAmountError('Paid amount cannot be greater than final invoice total')
      return
    }

    // Determine payment status
    let paymentStatus = 'unpaid'
    if (paid > 0) {
      if (paid === gross) {
        paymentStatus = 'paid'
      } else {
        paymentStatus = 'partial'
      }
    }

    try {
      const companyId = await resolveCompanyId(window.location.search)
      if (!companyId) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }
      stripCompanyParamsFromUrl()

      const requestData = {
        companyId,
        supplierInvoiceNo,
        billDate,
        supplierName,
        supplierAddress,
        supplierContact,
        productId: selectedProduct,
        noOfBags: Math.max(0, parseFloat(noOfBags) || 0),
        weight: Math.max(0, parseFloat(weight) || 0),
        rate: Math.max(0, parseFloat(rate) || 0),
        netAmount: Math.max(0, parseFloat(netAmount) || 0),
        otherAmount: Math.max(0, parseFloat(otherAmount) || 0),
        grossAmount: Math.max(0, gross),
        paidAmount: Math.max(0, parseFloat(paidAmount) || 0),
        balance: Math.max(0, parseFloat(balance) || 0),
        paymentStatus,
      }

      setSubmitting(true)

      const response = await fetch('/api/special-purchase-bills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      const responseData = await response.json()

      if (response.ok) {
        if (printAfterSave && responseData?.specialPurchaseBill?.id) {
          const printPath = companyId
            ? `/purchase/special/${responseData.specialPurchaseBill.id}/print?companyId=${encodeURIComponent(companyId)}`
            : `/purchase/special/${responseData.specialPurchaseBill.id}/print`
          router.push(printPath)
          return
        }
        alert('Special purchase bill created successfully!')
        router.push('/purchase/list')
      } else {
        alert('Error creating special purchase bill: ' + (responseData.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error creating special purchase bill: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitSpecialPurchase(false)
  }

  if (loading) {
    return (
      <DashboardLayout companyId="">
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }

  const companyId = getCompanyIdFromSearch(window.location.search)
  const defaultProductName = products.find((product) => product.id === defaultProductId)?.name || ''
  const selectedProductRecord = products.find((product) => product.id === selectedProduct) || null
  const taxPreview = calculateTaxBreakdown(parseFloat(netAmount) || 0, selectedProductRecord?.gstRate || 0)
  const calculatedGrossAmount = roundCurrency(taxPreview.lineTotal + (parseFloat(otherAmount) || 0))
  const finalGrossAmount = getCurrentFinalGrossTotal()

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Special Purchase Entry</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Supplier Invoice No */}
                  <div>
                    <Label htmlFor="supplierInvoiceNo">Supplier Invoice No.</Label>
                    <Input
                      id="supplierInvoiceNo"
                      value={supplierInvoiceNo}
                      onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                      placeholder="Enter supplier invoice number"
                      required
                    />
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

                  {/* Supplier Selection */}
                  <div>
                    <Label htmlFor="supplier">Supplier</Label>
                    <div className="flex gap-2">
                      <Select value={selectedSupplier} onValueChange={handleSupplierChange}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select Supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers
                            .filter((supplier, index, self) => !!supplier?.id && index === self.findIndex((s) => s.id === supplier.id))
                            .map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setSelectedSupplier('')
                          setSupplierName('')
                          setSupplierAddress('')
                          setSupplierContact('')
                        }}
                      >
                        New
                      </Button>
                    </div>
                  </div>

                  {/* Supplier Name */}
                  <div>
                    <Label htmlFor="supplierName">Supplier Name</Label>
                    <Input
                      id="supplierName"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Enter supplier name"
                      required
                      disabled={selectedSupplier !== ''}
                    />
                  </div>

                  {/* Supplier Address */}
                  <div>
                    <Label htmlFor="supplierAddress">Supplier Address</Label>
                    <Input
                      id="supplierAddress"
                      value={supplierAddress}
                      onChange={(e) => setSupplierAddress(e.target.value)}
                      placeholder="Enter supplier address"
                      disabled={selectedSupplier !== ''}
                    />
                  </div>

                  {/* Supplier Contact */}
                  <div>
                    <Label htmlFor="supplierContact">Supplier Contact No.</Label>
                    <Input
                      id="supplierContact"
                      value={supplierContact}
                      maxLength={10}
                      pattern="[0-9]{10}"
                      onChange={(e) => setSupplierContact(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="Enter supplier contact"
                      disabled={selectedSupplier !== ''}
                    />
                  </div>

                  {/* Add New Supplier Button */}
                  {!selectedSupplier && supplierName && (
                    <div className="flex items-end">
                      <Button type="button" variant="outline" onClick={handleAddNewSupplier}>
                        Add Supplier
                      </Button>
                    </div>
                  )}

                  {/* Product */}
                  <div>
                    <Label htmlFor="product">Product</Label>
                    <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select Product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((product) => (
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

                  {/* Net Amount */}
                  <div>
                    <Label htmlFor="netAmount">Net Amount</Label>
                    <Input
                      id="netAmount"
                      value={netAmount}
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

                  {/* Other Amount */}
                  <div>
                    <Label htmlFor="otherAmount">Other Amount</Label>
                    <Input
                      id="otherAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={otherAmount}
                      onChange={(e) => setOtherAmount(toNonNegative(e.target.value))}
                      placeholder="Enter other amount"
                    />
                  </div>

                  {/* Gross Amount */}
                  <div>
                    <Label htmlFor="grossAmount">Calculated Gross Amount</Label>
                    <Input
                      id="grossAmount"
                      value={calculatedGrossAmount.toFixed(2)}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  <div>
                    <Label htmlFor="manualGrossAmount">Final Invoice Total</Label>
                    <Input
                      id="manualGrossAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualGrossAmount}
                      onChange={(e) => setManualGrossAmount(toNonNegative(e.target.value))}
                      placeholder={calculatedGrossAmount.toFixed(2)}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Leave blank to use the calculated gross total. Enter a value here only when the final invoice amount needs a manual override.
                    </p>
                  </div>

                  {/* Paid Amount */}
                  <div>
                    <Label htmlFor="paidAmount">Paid Amount</Label>
                    <Input
                      id="paidAmount"
                      type="number"
                      min="0"
                      max={finalGrossAmount || undefined}
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
                    <p className="text-xs text-slate-500">Calculated Gross</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{currencyText(calculatedGrossAmount)}</p>
                  </div>
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">Final Invoice Total</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-700">{currencyText(finalGrossAmount)}</p>
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setManualGrossAmount('')} disabled={manualGrossAmount === ''}>
                    Reset Total
                  </Button>
                  <Button type="button" variant="outline" disabled={submitting} onClick={() => void submitSpecialPurchase(true)}>
                    Save & Print
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Saving...' : 'Save Special Purchase Bill'}
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
