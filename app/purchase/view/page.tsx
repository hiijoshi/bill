'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { ArrowLeft, Edit, Trash2, Printer, FileText } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  farmerNameSnapshot?: string | null
  farmerAddressSnapshot?: string | null
  farmerContactSnapshot?: string | null
  krashakAnubandhSnapshot?: string | null
  companyNameSnapshot?: string | null
  mandiAccountNumberSnapshot?: string | null
  company?: {
    id: string
    name: string
    mandiAccountNumber?: string | null
  }
  farmer: {
    id: string
    name: string
    address: string
    phone1: string
    krashakAnubandhNumber: string
  }
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
  createdAt: string
  updatedAt: string
}

export default function PurchaseViewPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PurchaseViewPageContent />
    </Suspense>
  )
}

function PurchaseViewPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId')
  const [companyId, setCompanyId] = useState('')

  const [purchaseBill, setPurchaseBill] = useState<PurchaseBill | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchPurchaseBill = async (targetCompanyId: string) => {
      try {
        const response = await fetch(`/api/purchase-bills?companyId=${targetCompanyId}&billId=${billId}`)
        if (cancelled) return
        if (!response.ok) {
          throw new Error('Purchase bill not found')
        }
        const billData: PurchaseBill = await response.json()
        if (cancelled) return
        setPurchaseBill(billData)
        setLoading(false)
      } catch (error) {
        if (cancelled || isAbortError(error)) return
        console.error('Error fetching purchase bill:', error)
        setLoading(false)
        alert('Error loading purchase bill')
        router.back()
      }
    }

    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return
      if (!billId || !resolvedCompanyId) {
        setLoading(false)
        alert('Missing bill ID or company selection')
        router.back()
        return
      }
      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
      await fetchPurchaseBill(resolvedCompanyId)
    })()
    return () => {
      cancelled = true
    }
  }, [billId, router])

  const handleEdit = () => {
    if (!billId) return
    const editPath = companyId
      ? `/purchase/edit?billId=${billId}&companyId=${encodeURIComponent(companyId)}`
      : `/purchase/edit?billId=${billId}`
    router.push(editPath)
  }

  const handleDelete = () => {
    if (!purchaseBill) return

    // Check if bill is within 15 days from today
    const billDate = new Date(purchaseBill.billDate)
    const currentDate = new Date()
    const daysDifference = Math.floor((currentDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysDifference > 15) {
      alert(`Cannot delete bill. Bill is older than 15 days. Bill age: ${daysDifference} days. Only bills within 15 days can be deleted.`)
      return
    }

    if (confirm('Are you sure you want to delete this bill? This action cannot be undone.')) {
      deleteBill()
    }
  }

  const deleteBill = async () => {
    try {
      const response = await fetch(`/api/purchase-bills?billId=${billId}&companyId=${companyId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert('Purchase bill deleted successfully!')
        router.push('/purchase/list')
      } else {
        const errorData = await response.json()
        alert('Error deleting purchase bill: ' + (errorData.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error deleting purchase bill:', error)
      alert('Error deleting purchase bill: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handlePrint = () => {
    const printPath = companyId
      ? `/purchase/${billId}/print?companyId=${encodeURIComponent(companyId)}`
      : `/purchase/${billId}/print`
    router.push(printPath)
  }

  const handleExportPDF = () => {
    if (!billId) return
    const printPath = companyId
      ? `/purchase/${billId}/print?companyId=${encodeURIComponent(companyId)}`
      : `/purchase/${billId}/print`
    window.open(printPath, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId || ''}>
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }

  if (!purchaseBill) {
    return (
      <DashboardLayout companyId={companyId || ''}>
        <div className="flex justify-center items-center h-screen">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Purchase Bill Not Found</h2>
            <Button onClick={() => router.back()}>Go Back</Button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const totalWeight = purchaseBill.purchaseItems.reduce((sum, item) => {
    const parsed = Number(item.qty)
    if (!Number.isFinite(parsed)) return sum
    return sum + Math.max(0, parsed)
  }, 0)

  return (
    <DashboardLayout companyId={companyId || ''}>
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-3xl font-bold">Purchase Bill Details</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleEdit}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" onClick={handleExportPDF}>
                <FileText className="w-4 h-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>

          {/* Bill Information */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Bill Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Bill Number</p>
                  <p className="font-semibold">{purchaseBill.billNo}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Mandi Account Number</p>
                  <p className="font-semibold">{purchaseBill.company?.mandiAccountNumber || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Bill Date</p>
                  <p className="font-semibold">{new Date(purchaseBill.billDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <Badge variant={
                    purchaseBill.status === 'paid' ? 'default' :
                    purchaseBill.status === 'partial' ? 'secondary' : 'destructive'
                  }>
                    {purchaseBill.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Created On</p>
                  <p className="font-semibold">{new Date(purchaseBill.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Farmer Information */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Farmer Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Farmer Name</p>
                  <p className="font-semibold">{purchaseBill.farmerNameSnapshot || purchaseBill.farmer?.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-semibold">{purchaseBill.farmerAddressSnapshot || purchaseBill.farmer?.address || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Contact</p>
                  <p className="font-semibold">{purchaseBill.farmerContactSnapshot || purchaseBill.farmer?.phone1 || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Krashak Anubandh Number</p>
                  <p className="font-semibold">{purchaseBill.krashakAnubandhSnapshot || purchaseBill.farmer?.krashakAnubandhNumber || 'N/A'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Purchase Items */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Purchase Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Weight</th>
                      <th className="text-right p-2">Rate</th>
                      <th className="text-right p-2">Bags</th>
                      <th className="text-right p-2">Hammali</th>
                      <th className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseBill.purchaseItems.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-2">{item.product?.name || 'Unknown Product'}</td>
                        <td className="text-right p-2">{item.qty}</td>
                        <td className="text-right p-2">₹{item.rate.toFixed(2)}</td>
                        <td className="text-right p-2">{item.bags || 0}</td>
                        <td className="text-right p-2">₹{item.hammali.toFixed(2)}</td>
                        <td className="text-right p-2">₹{item.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Financial Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded">
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-blue-600">₹{purchaseBill.totalAmount.toFixed(2)}</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded">
                  <p className="text-sm text-gray-600">Paid Amount</p>
                  <p className="text-2xl font-bold text-green-600">₹{purchaseBill.paidAmount.toFixed(2)}</p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded">
                  <p className="text-sm text-gray-600">Balance Amount</p>
                  <p className="text-2xl font-bold text-red-600">₹{purchaseBill.balanceAmount.toFixed(2)}</p>
                </div>
                <div className="text-center p-4 bg-amber-50 rounded">
                  <p className="text-sm text-gray-600">Total Weight</p>
                  <p className="text-2xl font-bold text-amber-700">{totalWeight.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
