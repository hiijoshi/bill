'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { calculateTaxBreakdown, roundCurrency } from '@/lib/billing-calculations'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Supplier {
  id: string
  name: string
  address: string
  gstNumber: string
}

interface Product {
  id: string
  name: string
  gstRate?: number | null
}

interface SpecialPurchaseItem {
  id: string
  productId: string
  noOfBags: number
  weight: number
  rate: number
  netAmount: number
  otherAmount: number
  grossAmount: number
}

interface SpecialPurchaseBill {
  id: string
  supplierInvoiceNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  supplier: Supplier
  specialPurchaseItems: SpecialPurchaseItem[]
  type: 'special'
}

export default function SpecialPurchaseEditPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SpecialPurchaseEditPageContent />
    </Suspense>
  )
}

function SpecialPurchaseEditPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId')
  const [companyId, setCompanyId] = useState('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [billDate, setBillDate] = useState('')
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierGst, setSupplierGst] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [balanceAmount, setBalanceAmount] = useState('')

  // Single item state (API expects single item)
  const [itemData, setItemData] = useState({
    noOfBags: '',
    weight: '',
    rate: '',
    otherAmount: ''
  })
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const parseApiJson = async <T,>(response: Response, fallback: T): Promise<T> => {
    const raw = await response.text()
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  useEffect(() => {
    let cancelled = false

    const fetchData = async (targetCompanyId: string) => {
      try {
        const suppliersRes = await fetch(`/api/suppliers?companyId=${targetCompanyId}`)
        const suppliersData = await parseApiJson<Supplier[]>(suppliersRes, [])
        if (cancelled) return
        setSuppliers(suppliersData)

        const productsRes = await fetch(`/api/products?companyId=${targetCompanyId}`)
        const productsData = await parseApiJson<Product[]>(productsRes, [])
        if (cancelled) return
        setProducts(productsData)

        const billRes = await fetch(`/api/special-purchase-bills?companyId=${targetCompanyId}&billId=${billId}`)
        if (!billRes.ok) {
          throw new Error('Special purchase bill not found')
        }
        const billData = await parseApiJson<SpecialPurchaseBill | null>(billRes, null)
        if (cancelled) return
        if (!billData?.id) {
          throw new Error('Special purchase bill not found')
        }

        setSupplierInvoiceNo(billData.supplierInvoiceNo)
        setBillDate(new Date(billData.billDate).toISOString().split('T')[0])
        setSelectedSupplier(billData.supplier?.id || '')
        setSupplierName(billData.supplier?.name || '')
        setSupplierAddress(billData.supplier?.address || '')
        setSupplierGst(billData.supplier?.gstNumber || '')

        setTotalAmount(billData.totalAmount.toString())
        setPaidAmount(billData.paidAmount.toString())
        setBalanceAmount(billData.balanceAmount.toString())

        if (billData.specialPurchaseItems && billData.specialPurchaseItems.length > 0) {
          const item = billData.specialPurchaseItems[0]
          setSelectedProduct(item.productId || '')
          setItemData({
            noOfBags: item.noOfBags.toString(),
            weight: item.weight.toString(),
            rate: item.rate.toString(),
            otherAmount: item.otherAmount.toString()
          })
        }

        setLoading(false)
      } catch (error) {
        if (cancelled) return
        console.error('Error fetching data:', error)
        setLoading(false)
        alert('Error loading special purchase bill')
        router.back()
      }
    }

    ;(async () => {
      if (!billId) {
        setLoading(false)
        alert('Missing bill ID')
        router.back()
        return
      }

      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return
      if (!resolvedCompanyId) {
        setLoading(false)
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
      await fetchData(resolvedCompanyId)
    })()
    return () => {
      cancelled = true
    }
  }, [billId, router])

  const handleSupplierChange = (supplierId: string) => {
    setSelectedSupplier(supplierId)
    const supplier = suppliers.find(s => s.id === supplierId)
    if (supplier) {
      setSupplierName(supplier.name)
      setSupplierAddress(supplier.address)
      setSupplierGst(supplier.gstNumber)
    }
  }

  const calculateItemAmounts = () => {
    const weight = parseFloat(itemData.weight) || 0
    const rate = parseFloat(itemData.rate) || 0
    const otherAmount = parseFloat(itemData.otherAmount) || 0
    
    const netAmount = weight * rate
    const selectedProductRecord = products.find((product) => product.id === selectedProduct)
    const tax = calculateTaxBreakdown(netAmount, selectedProductRecord?.gstRate || 0)
    const grossAmount = roundCurrency(tax.lineTotal + otherAmount)
    
    return { netAmount, grossAmount }
  }

  const getFinalInvoiceTotal = () => {
    const manualTotal = parseFloat(totalAmount)
    if (Number.isFinite(manualTotal)) {
      return roundCurrency(Math.max(0, manualTotal))
    }
    return roundCurrency(calculateItemAmounts().grossAmount)
  }

  const getFinalBalanceAmount = (finalTotal: number, paidValue: string) => {
    const paid = Math.max(0, parseFloat(paidValue) || 0)
    return roundCurrency(Math.max(0, finalTotal - paid))
  }

  const derivePaymentStatus = (finalTotal: number, paid: number) => {
    if (paid <= 0) return 'unpaid'
    if (paid >= finalTotal) return 'paid'
    return 'partial'
  }

  const handleUpdateItem = () => {
    if (!itemData.noOfBags || !itemData.weight || !itemData.rate) {
      alert('Please fill all item fields')
      return
    }

    const { grossAmount } = calculateItemAmounts()
    setTotalAmount(grossAmount.toString())
    
    const paid = parseFloat(paidAmount) || 0
    if (paid > grossAmount) {
      alert('Paid amount cannot be more than gross amount')
      return
    }
    setBalanceAmount(roundCurrency(Math.max(0, grossAmount - paid)).toString())
  }

  const handlePaidAmountChange = (value: string) => {
    const normalized = toNonNegative(value)
    setPaidAmount(normalized)
    const total = getFinalInvoiceTotal()
    const paid = parseFloat(normalized) || 0
    if (paid > total) {
      alert('Paid amount cannot be more than final invoice total')
      setBalanceAmount(total.toString())
      return
    }
    setBalanceAmount(getFinalBalanceAmount(total, normalized).toString())
  }

  const handleTotalAmountChange = (value: string) => {
    const normalized = toNonNegative(value)
    setTotalAmount(normalized)

    const finalTotal = normalized === '' ? roundCurrency(calculateItemAmounts().grossAmount) : roundCurrency(parseFloat(normalized) || 0)
    const paid = Math.max(0, parseFloat(paidAmount) || 0)

    if (paid > finalTotal) {
      alert('Paid amount cannot be more than final invoice total')
      setBalanceAmount('0')
      return
    }

    setBalanceAmount(getFinalBalanceAmount(finalTotal, paidAmount).toString())
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!supplierInvoiceNo || !selectedSupplier || !selectedProduct || !itemData.weight || !itemData.rate) {
      alert('Please fill all required fields')
      return
    }

    try {
      const { netAmount } = calculateItemAmounts()
      const finalTotal = getFinalInvoiceTotal()
      const paid = parseFloat(paidAmount) || 0
      if (paid > finalTotal) {
        alert('Paid amount cannot be more than final invoice total')
        return
      }
      const finalBalance = roundCurrency(Math.max(0, finalTotal - paid))
      
      const requestData = {
        id: billId,
        companyId,
        supplierInvoiceNo,
        billDate,
        supplierName: supplierName,
        supplierAddress: supplierAddress,
        supplierContact: '', // Add this field if needed
        productId: selectedProduct,
        noOfBags: Math.max(0, parseInt(itemData.noOfBags) || 0),
        weight: Math.max(0, parseFloat(itemData.weight) || 0),
        rate: Math.max(0, parseFloat(itemData.rate) || 0),
        netAmount,
        otherAmount: Math.max(0, parseFloat(itemData.otherAmount) || 0),
        grossAmount: finalTotal,
        paidAmount: Math.max(0, paid),
        balanceAmount: finalBalance,
        status: derivePaymentStatus(finalTotal, paid)
      }

      const response = await fetch('/api/special-purchase-bills', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API Error Response:', errorData)
        throw new Error(errorData.error || 'Failed to update special purchase bill')
      }

      alert('Special purchase bill updated successfully!')
      router.push('/purchase/list')
    } catch (error) {
      console.error('Error updating bill:', error)
      alert('Error updating special purchase bill')
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId || ''}>
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading...</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId || ''}>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Edit Special Purchase Bill</h1>
          <Button variant="outline" onClick={() => router.back()}>
            Back to List
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="supplierInvoiceNo">Supplier Invoice No</Label>
                  <Input
                    id="supplierInvoiceNo"
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    placeholder="Enter supplier invoice number"
                    required
                  />
                </div>
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
                <div>
                  <Label htmlFor="supplier">Supplier</Label>
                  <Select value={selectedSupplier} onValueChange={handleSupplierChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="product">Product</Label>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {products.find((product) => product.id === selectedProduct) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Tax rule: {Number(products.find((product) => product.id === selectedProduct)?.gstRate || 0) > 0 ? `${Number(products.find((product) => product.id === selectedProduct)?.gstRate || 0).toFixed(2)}% GST` : 'Non-GST / tax-free'}
                      </p>
                    ) : null}
                </div>
              </div>
              
              {selectedSupplier && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label>Address</Label>
                    <Input value={supplierAddress} readOnly className="bg-gray-50" />
                  </div>
                  <div>
                    <Label>GST Number</Label>
                    <Input value={supplierGst} readOnly className="bg-gray-50" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <Label htmlFor="noOfBags">No. of Bags</Label>
                    <Input
                      id="noOfBags"
                      type="number"
                      min="0"
                      value={itemData.noOfBags}
                      onChange={(e) => setItemData({...itemData, noOfBags: toNonNegative(e.target.value)})}
                      placeholder="Enter bags"
                    />
                  </div>
                  <div>
                    <Label htmlFor="weight">Weight (Qt)</Label>
                    <Input
                      id="weight"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemData.weight}
                      onChange={(e) => setItemData({...itemData, weight: toNonNegative(e.target.value)})}
                      placeholder="Enter weight"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rate">Average Rate / Qt</Label>
                    <Input
                      id="rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemData.rate}
                      onChange={(e) => setItemData({...itemData, rate: toNonNegative(e.target.value)})}
                      placeholder="Enter rate"
                    />
                  </div>
                  <div>
                    <Label htmlFor="otherAmount">Other Amount</Label>
                    <Input
                      id="otherAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemData.otherAmount}
                      onChange={(e) => setItemData({...itemData, otherAmount: toNonNegative(e.target.value)})}
                      placeholder="Enter other amount"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" onClick={handleUpdateItem}>Calculate Amount</Button>
                  </div>
                </div>

                {/* Current Item Summary */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-2">Item Summary</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Net Amount:</span>
                      <span className="font-medium ml-2">₹{calculateItemAmounts().netAmount.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">GST Amount:</span>
                      <span className="font-medium ml-2">
                        ₹{calculateTaxBreakdown(
                          calculateItemAmounts().netAmount,
                          products.find((product) => product.id === selectedProduct)?.gstRate || 0
                        ).gstAmount.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Other Amount:</span>
                      <span className="font-medium ml-2">₹{parseFloat(itemData.otherAmount || '0').toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Gross Amount:</span>
                      <span className="font-medium ml-2">₹{calculateItemAmounts().grossAmount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Amount Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Amount Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="totalAmount">Final Invoice Total</Label>
                  <Input
                    id="totalAmount"
                    value={totalAmount}
                    onChange={(e) => handleTotalAmountChange(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="paidAmount">Paid Amount</Label>
                    <Input
                      id="paidAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => handlePaidAmountChange(e.target.value)}
                    placeholder="Enter paid amount"
                  />
                </div>
                <div>
                  <Label htmlFor="balanceAmount">Balance Amount</Label>
                  <Input
                    id="balanceAmount"
                    value={balanceAmount}
                    readOnly
                    className="bg-gray-50"
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">Calculated Gross Amount</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">₹{roundCurrency(calculateItemAmounts().grossAmount).toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">Final Invoice Total</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">₹{getFinalInvoiceTotal().toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">Current Balance</p>
                  <p className="mt-1 text-lg font-semibold text-amber-700">₹{(parseFloat(balanceAmount) || 0).toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit">
              Update Special Purchase Bill
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
