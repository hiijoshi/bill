'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { ArrowLeft, Edit, FileText, Printer, Trash2 } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'

interface Supplier {
  id: string
  name: string
  address: string
  phone1?: string
  gstNumber?: string
}

interface SpecialPurchaseItem {
  id: string
  productId: string
  product?: {
    id: string
    name: string
  } | null
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
  createdAt: string
  supplier: Supplier
  specialPurchaseItems: SpecialPurchaseItem[]
}

const formatDate = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '-'
}

const toMoney = (value: number): string => `₹${Math.max(0, Number(value || 0)).toFixed(2)}`

export default function SpecialPurchaseViewPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SpecialPurchaseViewContent />
    </Suspense>
  )
}

function SpecialPurchaseViewContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId')
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [bill, setBill] = useState<SpecialPurchaseBill | null>(null)

  const fetchBill = useCallback(async (targetCompanyId: string, targetBillId: string, isCancelled: () => boolean) => {
    try {
      const response = await fetch(
        `/api/special-purchase-bills?companyId=${targetCompanyId}&billId=${targetBillId}`
      )
      if (isCancelled()) return
      if (!response.ok) {
        throw new Error('Special purchase bill not found')
      }
      const payload = (await response.json().catch(() => null)) as SpecialPurchaseBill | null
      if (isCancelled()) return
      if (!payload?.id) {
        throw new Error('Special purchase bill not found')
      }
      setBill(payload)
      setLoading(false)
    } catch (error) {
      if (isCancelled() || isAbortError(error)) return
      setLoading(false)
      alert('Error loading special purchase bill')
      router.back()
    }
  }, [router])

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
      await fetchBill(resolvedCompanyId, billId, () => cancelled)
    })()

    return () => {
      cancelled = true
    }
  }, [billId, fetchBill, router])

  const handleDelete = async () => {
    if (!bill || !companyId) return

    const billDate = new Date(bill.billDate)
    const daysDifference = Math.floor((Date.now() - billDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDifference > 15) {
      alert(`Cannot delete bill older than 15 days. Bill age: ${daysDifference} days.`)
      return
    }

    if (!confirm('Are you sure you want to delete this special purchase bill?')) return

    const response = await fetch(
      `/api/special-purchase-bills?billId=${bill.id}&companyId=${companyId}`,
      { method: 'DELETE' }
    )

    if (response.ok) {
      alert('Special purchase bill deleted successfully!')
      router.push('/purchase/list')
      return
    }

    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    alert(payload.error || 'Failed to delete special purchase bill')
  }

  const handlePrint = () => {
    if (!bill) return
    const printPath = companyId
      ? `/purchase/special/${bill.id}/print?companyId=${encodeURIComponent(companyId)}`
      : `/purchase/special/${bill.id}/print`
    router.push(printPath)
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex items-center justify-center h-64">Loading...</div>
      </DashboardLayout>
    )
  }

  if (!bill) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Special Purchase Bill Not Found</h2>
            <Button onClick={() => router.back()}>Go Back</Button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-3xl font-bold">Special Purchase Bill Details</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push(`/purchase/special-edit?billId=${bill.id}`)}>
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
              <Button
                variant="outline"
                onClick={() => {
                  const printPath = companyId
                    ? `/purchase/special/${bill.id}/print?companyId=${encodeURIComponent(companyId)}`
                    : `/purchase/special/${bill.id}/print`
                  window.open(printPath, '_blank', 'noopener,noreferrer')
                }}
              >
                <FileText className="w-4 h-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Bill Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Supplier Invoice No.</p>
                  <p className="font-semibold">{bill.supplierInvoiceNo || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Bill Date</p>
                  <p className="font-semibold">{formatDate(bill.billDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <Badge
                    variant={
                      bill.status === 'paid'
                        ? 'default'
                        : bill.status === 'partial'
                          ? 'secondary'
                          : 'destructive'
                    }
                  >
                    {bill.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Created On</p>
                  <p className="font-semibold">{formatDate(bill.createdAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supplier Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Supplier Name</p>
                  <p className="font-semibold">{bill.supplier?.name || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-semibold">{bill.supplier?.address || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Contact</p>
                  <p className="font-semibold">{bill.supplier?.phone1 || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">GST Number</p>
                  <p className="font-semibold">{bill.supplier?.gstNumber || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
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
                      <th className="text-right p-2">Net</th>
                      <th className="text-right p-2">Other</th>
                      <th className="text-right p-2">Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.specialPurchaseItems.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-2">{item.product?.name || 'Product'}</td>
                        <td className="p-2 text-right">{Math.max(0, Number(item.noOfBags || 0)).toFixed(2)}</td>
                        <td className="p-2 text-right">{Math.max(0, Number(item.weight || 0)).toFixed(2)}</td>
                        <td className="p-2 text-right">{toMoney(item.rate)}</td>
                        <td className="p-2 text-right">{toMoney(item.netAmount)}</td>
                        <td className="p-2 text-right">{toMoney(item.otherAmount)}</td>
                        <td className="p-2 text-right font-semibold">{toMoney(item.grossAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded border p-3">
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-xl font-semibold">{toMoney(bill.totalAmount)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-sm text-gray-600">Paid Amount</p>
                  <p className="text-xl font-semibold text-green-600">{toMoney(bill.paidAmount)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-sm text-gray-600">Balance Amount</p>
                  <p className="text-xl font-semibold text-red-600">{toMoney(bill.balanceAmount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
