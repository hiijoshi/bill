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

interface SalesBill {
  id: string
  billNo: string
  billDate: string
  party: {
    id: string
    name: string
    address: string
    phone1: string
  }
  salesItems: Array<{
    id: string
    productId: string
    product: {
      id: string
      name: string
    }
    bags?: number
    qty?: number
    weight?: number
    rate?: number
    amount?: number
  }>
  transportBills?: Array<{
    id: string
    transportName?: string | null
    lorryNo?: string | null
    freightPerQt?: number | null
    freightAmount?: number | null
    advance?: number | null
    toPay?: number | null
    otherAmount?: number | null
    insuranceAmount?: number | null
  }>
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  createdAt: string
  updatedAt: string
}

interface RawSalesItem {
  id?: unknown
  productId?: unknown
  product?: {
    id?: unknown
    name?: unknown
  }
  bags?: unknown
  qty?: unknown
  weight?: unknown
  rate?: unknown
  amount?: unknown
}

interface RawTransportBill {
  id?: unknown
  transportName?: unknown
  lorryNo?: unknown
  freightPerQt?: unknown
  freightAmount?: unknown
  advance?: unknown
  toPay?: unknown
  otherAmount?: unknown
  insuranceAmount?: unknown
}

interface RawSalesBill {
  id?: unknown
  billNo?: unknown
  billDate?: unknown
  party?: {
    id?: unknown
    name?: unknown
    address?: unknown
    phone1?: unknown
  }
  salesItems?: RawSalesItem[]
  transportBills?: RawTransportBill[]
  totalAmount?: unknown
  receivedAmount?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

const clampNonNegative = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function normalizeSalesBill(raw: RawSalesBill): SalesBill {
  const totalAmount = clampNonNegative(raw?.totalAmount)
  const receivedAmount = clampNonNegative(raw?.receivedAmount)
  const balanceAmount = Math.max(0, totalAmount - receivedAmount)
  const status = balanceAmount === 0 ? 'paid' : receivedAmount > 0 ? 'partial' : 'unpaid'

  return {
    id: String(raw?.id || ''),
    billNo: String(raw?.billNo || ''),
    billDate: String(raw?.billDate || ''),
    party: {
      id: String(raw?.party?.id || ''),
      name: String(raw?.party?.name || ''),
      address: String(raw?.party?.address || ''),
      phone1: String(raw?.party?.phone1 || '')
    },
    salesItems: Array.isArray(raw?.salesItems)
      ? raw.salesItems.map((item) => ({
          id: String(item?.id || ''),
          productId: String(item?.productId || ''),
          product: {
            id: String(item?.product?.id || ''),
            name: String(item?.product?.name || '')
          },
          qty: clampNonNegative(item?.qty ?? item?.weight ?? 0),
          weight: clampNonNegative(item?.weight ?? item?.qty ?? 0),
          bags: clampNonNegative(item?.bags ?? 0),
          rate: clampNonNegative(item?.rate ?? 0),
          amount: clampNonNegative(item?.amount ?? 0)
        }))
      : [],
    transportBills: Array.isArray(raw?.transportBills)
      ? raw.transportBills.map((item) => ({
          id: String(item?.id || ''),
          transportName: item?.transportName == null ? null : String(item.transportName),
          lorryNo: item?.lorryNo == null ? null : String(item.lorryNo),
          freightPerQt: clampNonNegative(item?.freightPerQt),
          freightAmount: clampNonNegative(item?.freightAmount),
          advance: clampNonNegative(item?.advance),
          toPay: clampNonNegative(item?.toPay),
          otherAmount: clampNonNegative(item?.otherAmount),
          insuranceAmount: clampNonNegative(item?.insuranceAmount)
        }))
      : [],
    totalAmount,
    receivedAmount,
    balanceAmount,
    status,
    createdAt: String(raw?.createdAt || ''),
    updatedAt: String(raw?.updatedAt || '')
  }
}

export default function SalesViewPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SalesViewPageContent />
    </Suspense>
  )
}

function SalesViewPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId')
  const [companyId, setCompanyId] = useState('')

  const [salesBill, setSalesBill] = useState<SalesBill | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchSalesBill = async (targetCompanyId: string) => {
      try {
        const response = await fetch(`/api/sales-bills?companyId=${targetCompanyId}&billId=${billId}`)
        if (cancelled) return
        if (!response.ok) {
          throw new Error('Sales bill not found')
        }
        const billData = (await response.json()) as RawSalesBill
        if (cancelled) return
        setSalesBill(normalizeSalesBill(billData))
        setLoading(false)
      } catch (error) {
        if (cancelled || isAbortError(error)) return
        console.error('Error fetching sales bill:', error)
        setLoading(false)
        alert('Error loading sales bill')
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
      await fetchSalesBill(resolvedCompanyId)
    })()
    return () => {
      cancelled = true
    }
  }, [billId, router])

  const handleEdit = () => {
    if (!billId) return
    const editPath = companyId
      ? `/sales/entry?billId=${billId}&companyId=${encodeURIComponent(companyId)}`
      : `/sales/entry?billId=${billId}`
    router.push(editPath)
  }

  const handleDelete = () => {
    if (!salesBill) return

    // Check if bill is within 15 days from today
    const billDate = new Date(salesBill.billDate)
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
      const response = await fetch(`/api/sales-bills?billId=${billId}&companyId=${companyId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert('Sales bill deleted successfully!')
        router.push('/sales/list')
      } else {
        const errorData = await response.json()
        alert('Error deleting sales bill: ' + (errorData.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error deleting sales bill:', error)
      alert('Error deleting sales bill: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handlePrint = () => {
    if (!billId) return
    const printPath = companyId
      ? `/sales/${billId}/print?type=invoice&companyId=${encodeURIComponent(companyId)}`
      : `/sales/${billId}/print?type=invoice`
    router.push(printPath)
  }

  const handleExportPDF = () => {
    if (!billId) return
    const printPath = companyId
      ? `/sales/${billId}/print?type=invoice&autoprint=1&companyId=${encodeURIComponent(companyId)}`
      : `/sales/${billId}/print?type=invoice&autoprint=1`
    window.open(printPath, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId || ''}>
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }

  if (!salesBill) {
    return (
      <DashboardLayout companyId={companyId || ''}>
        <div className="flex justify-center items-center h-screen">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Sales Bill Not Found</h2>
            <Button onClick={() => router.back()}>Go Back</Button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const totalWeight = salesBill.salesItems.reduce(
    (sum, item) => sum + clampNonNegative(item.weight ?? item.qty ?? 0),
    0
  )

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
              <h1 className="text-3xl font-bold">Sales Bill Details</h1>
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
                  <p className="text-sm text-gray-600">Invoice Number</p>
                  <p className="font-semibold">{salesBill.billNo}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Invoice Date</p>
                  <p className="font-semibold">{new Date(salesBill.billDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <Badge variant={
                    salesBill.status === 'paid' ? 'default' :
                    salesBill.status === 'partial' ? 'secondary' : 'destructive'
                  }>
                    {salesBill.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Created On</p>
                  <p className="font-semibold">{new Date(salesBill.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Party Information */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Party Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Party Name</p>
                  <p className="font-semibold">{salesBill.party.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-semibold">{salesBill.party.address || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Contact</p>
                  <p className="font-semibold">{salesBill.party.phone1 || 'N/A'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sales Items */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Sales Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Bags</th>
                      <th className="text-right p-2">Weight</th>
                      <th className="text-right p-2">Rate</th>
                      <th className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesBill.salesItems.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-2">{item.product.name}</td>
                        <td className="text-right p-2">{clampNonNegative(item.bags).toFixed(2)}</td>
                        <td className="text-right p-2">{clampNonNegative(item.weight ?? item.qty ?? 0).toFixed(2)}</td>
                        <td className="text-right p-2">₹{clampNonNegative(item.rate).toFixed(2)}</td>
                        <td className="text-right p-2">₹{clampNonNegative(item.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end">
                <div className="rounded-md border bg-gray-50 px-4 py-2 text-sm">
                  <span className="text-gray-600 mr-2">Total Weight:</span>
                  <span className="font-semibold">{totalWeight.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Transport & Additional Charges</CardTitle>
            </CardHeader>
            <CardContent>
              {salesBill.transportBills && salesBill.transportBills.length > 0 ? (
                (() => {
                  const transport = salesBill.transportBills?.[0]
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Transport Name</p>
                        <p className="font-semibold">{transport?.transportName || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Lorry Number</p>
                        <p className="font-semibold">{transport?.lorryNo || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Freight Amount</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.freightAmount).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Freight / Qt</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.freightPerQt).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Other Amount</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.otherAmount).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Insurance Amount</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.insuranceAmount).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Advance</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.advance).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">To Pay</p>
                        <p className="font-semibold">₹{clampNonNegative(transport?.toPay).toFixed(2)}</p>
                      </div>
                    </div>
                  )
                })()
              ) : (
                <p className="text-sm text-gray-500">No transport details available for this bill.</p>
              )}
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
                  <p className="text-2xl font-bold text-blue-600">₹{salesBill.totalAmount.toFixed(2)}</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded">
                  <p className="text-sm text-gray-600">Received Amount</p>
                  <p className="text-2xl font-bold text-green-600">₹{salesBill.receivedAmount.toFixed(2)}</p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded">
                  <p className="text-sm text-gray-600">Balance Amount</p>
                  <p className="text-2xl font-bold text-red-600">₹{salesBill.balanceAmount.toFixed(2)}</p>
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
