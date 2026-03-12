'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Product {
  id: string
  name: string
}

interface Farmer {
  id: string
  name: string
  address: string
  phone1: string
  krashakAnubandhNumber: string
}

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  farmer: Farmer
  purchaseItems: Array<{
    id: string
    productId: string
    product: {
      id: string
      name: string
    }
    qty: number
    rate: number
    hammali: number
    bags: number
    amount: number
  }>
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
}

export default function PurchaseEditPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PurchaseEditPageContent />
    </Suspense>
  )
}

function PurchaseEditPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId')
  const [companyId, setCompanyId] = useState('')

  const [products, setProducts] = useState<Product[]>([])
  const [purchaseBill, setPurchaseBill] = useState<PurchaseBill | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [billDate, setBillDate] = useState('')
  const [farmerName, setFarmerName] = useState('')
  const [farmerAddress, setFarmerAddress] = useState('')
  const [farmerContact, setFarmerContact] = useState('')
  const [krashakAnubandhNumber, setKrashakAnubandhNumber] = useState('')
  const [markaNumber, setMarkaNumber] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [noOfBags, setNoOfBags] = useState('')
  const [hammali, setHammali] = useState('')
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('')
  const [payableAmount, setPayableAmount] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [balance, setBalance] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [paidAmountError, setPaidAmountError] = useState('')
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const handlePaidAmountChange = (value: string) => {
    const normalized = toNonNegative(value)
    if (normalized === '') {
      setPaidAmount('')
      setPaidAmountError('')
      return
    }

    const nextPaid = Number(normalized)
    const maxPayable = Number(payableAmount || 0)
    const hasPayable = payableAmount !== ''

    if (hasPayable && nextPaid > maxPayable) {
      setPaidAmount(String(maxPayable))
      setPaidAmountError('Paid amount cannot be greater than payable amount')
      return
    }

    setPaidAmount(normalized)
    setPaidAmountError('')
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
      await fetchData(resolvedCompanyId, () => cancelled)
    })()

    return () => {
      cancelled = true
    }
  }, [billId, router])

  const fetchData = async (targetCompanyId: string, isCancelled: () => boolean = () => false) => {
    try {
      // Fetch products
      const productsRes = await fetch(`/api/products?companyId=${targetCompanyId}`)
      const productsData = await parseApiJson<Product[]>(productsRes, [])
      if (isCancelled()) return
      setProducts(productsData)

      // Fetch purchase bill
      const billRes = await fetch(`/api/purchase-bills?companyId=${targetCompanyId}&billId=${billId}`)
      if (!billRes.ok) {
        throw new Error('Purchase bill not found')
      }
      const billData = await parseApiJson<PurchaseBill | null>(billRes, null)
      if (isCancelled()) return
      if (!billData?.id) {
        throw new Error('Purchase bill not found')
      }
      setPurchaseBill(billData)

      // Populate form with existing data
      setBillNumber(billData.billNo)
      {
        const parsedBillDate = new Date(billData.billDate)
        const safeBillDate = Number.isFinite(parsedBillDate.getTime())
          ? parsedBillDate.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
        setBillDate(safeBillDate)
      }
      setFarmerName(billData.farmer?.name || '')
      setFarmerAddress(billData.farmer?.address || '')
      setFarmerContact(billData.farmer?.phone1 || '')
      setKrashakAnubandhNumber(billData.farmer?.krashakAnubandhNumber || '')
      
      if (billData.purchaseItems && billData.purchaseItems.length > 0) {
        const item = billData.purchaseItems[0]
        setSelectedProduct(item.productId)
        setNoOfBags(item.bags.toString())
        setHammali(item.hammali.toString())
        setWeight(item.qty.toString())
        setRate(item.rate.toString())
        setPayableAmount(item.amount.toString())
      }
      
      setPaidAmount(billData.paidAmount.toString())
      setBalance(billData.balanceAmount.toString())

      setLoading(false)
    } catch (error) {
      if (isCancelled()) return
      console.error('Error fetching data:', error)
      setLoading(false)
      alert('Error loading purchase bill')
      router.back()
    }
  }

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
    const payable = parseFloat(payableAmount) || 0
    const paid = parseFloat(paidAmount) || 0

    if (payableAmount !== '' && paidAmount && paid > payable) {
      setPaidAmount(String(payable))
      setPaidAmountError('Paid amount cannot be greater than payable amount')
      setBalance('0')
      return
    }

    setPaidAmountError('')
    if (payableAmount && paidAmount) {
      setBalance(Math.max(0, payable - paid).toString())
      return
    }
    setBalance('')
  }, [payableAmount, paidAmount])

  const handleFarmerChange = (farmerId: string) => {
    const farmer = purchaseBill?.farmer
    if (farmer && farmer.id === farmerId) {
      setFarmerName(farmer.name)
      setFarmerAddress(farmer.address)
      setFarmerContact(farmer.phone1)
      setKrashakAnubandhNumber(farmer.krashakAnubandhNumber)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Basic validation
    if (!farmerName || !selectedProduct || !weight || !rate || !billNumber) {
      alert('Please fill all required fields')
      return
    }

    if (paidAmountError) {
      alert('Please correct paid amount before submitting')
      return
    }

    // Payment validation
    const payable = parseFloat(payableAmount) || 0
    const paid = parseFloat(paidAmount) || 0
    if (payable < 0 || paid < 0) {
      alert('Amounts cannot be negative')
      return
    }

    // Check if paid amount exceeds payable amount
    if (paid > payable) {
      alert('Paid amount cannot be more than payable amount!')
      return
    }

    // Determine payment status
    let paymentStatus = 'unpaid'
    if (paid > 0) {
      if (paid === payable) {
        paymentStatus = 'paid'
      } else {
        paymentStatus = 'partial'
      }
    }

    try {
      const requestData = {
        id: billId,
        companyId,
        billNumber,
        billDate,
        farmerId: purchaseBill?.farmer?.id || '',
        farmerName,
        farmerAddress,
        farmerContact,
        krashakAnubandhNumber,
        markaNumber,
        productId: selectedProduct,
        noOfBags: Math.max(0, parseInt(noOfBags) || 0),
        hammali: Math.max(0, parseFloat(hammali) || 0),
        weight: Math.max(0, parseFloat(weight) || 0),
        rate: Math.max(0, parseFloat(rate) || 0),
        payableAmount: Math.max(0, parseFloat(payableAmount) || 0),
        paidAmount: Math.max(0, parseFloat(paidAmount) || 0),
        balanceAmount: Math.max(0, parseFloat(balance) || 0),
        status: paymentStatus
      }

      const response = await fetch('/api/purchase-bills', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API Error Response:', errorData)
        throw new Error(errorData.error || 'Failed to update purchase bill')
      }

      alert('Purchase bill updated successfully!')
      router.push('/purchase/list')
    } catch (error) {
      console.error('Error updating bill:', error)
      alert('Error updating purchase bill')
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
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Edit Purchase Bill</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Bill Number */}
                  <div>
                    <Label htmlFor="billNumber">Bill Number</Label>
                    <Input 
                      id="billNumber" 
                      value={billNumber} 
                      onChange={(e) => setBillNumber(e.target.value)} 
                      placeholder="Enter bill number"
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
                      value={farmerContact}
                      onChange={(e) => setFarmerContact(e.target.value)}
                      placeholder="Enter farmer contact"
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
                      <SelectTrigger>
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
                    <Label htmlFor="weight">Weight</Label>
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
                    <Label htmlFor="rate">Rate</Label>
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
                    <Label htmlFor="payableAmount">Payable Amount</Label>
                    <Input
                      id="payableAmount"
                      value={payableAmount}
                      readOnly
                      className="bg-gray-100"
                      placeholder="Calculated automatically"
                    />
                  </div>

                  {/* Paid Amount */}
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

                {/* Submit Button */}
                <div className="flex justify-end space-x-4">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    Update Purchase Bill
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
