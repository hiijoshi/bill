'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Calculator, Save, Plus, Minus } from 'lucide-react'
import { calculateNetWeight, calculateTaxes } from '@/lib/tenancy'

interface PurchasePageProps {
  params: { companyId: string }
}

export default function RegularPurchase({ params }: PurchasePageProps) {
  const [formData, setFormData] = useState({
    sellerName: '',
    sellerPhone: '',
    productName: '',
    unitType: 'bags',
    totalBags: '',
    bagSize: '50', // KG
    manualDeduction: '0',
    ratePerQuintal: '',
    mandiTax: '2',
    nirashritShulk: '1',
    labourRate: '50'
  })

  const [calculations, setCalculations] = useState({
    netWeight: 0,
    baseAmount: 0,
    mandiTax: 0,
    nirashritShulk: 0,
    labour: 0,
    totalAmount: 0
  })

  const [products, setProducts] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    loadProducts()
  }, [])

  useEffect(() => {
    calculateAmounts()
  }, [formData])

  const loadProducts = async () => {
    try {
      const response = await fetch(`/api/products?companyId=${params.companyId}`)
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error('Error loading products:', error)
    }
  }

  const calculateAmounts = () => {
    const totalBags = parseFloat(formData.totalBags) || 0
    const bagSize = parseFloat(formData.bagSize) || 0
    const manualDeduction = parseFloat(formData.manualDeduction) || 0
    const rate = parseFloat(formData.ratePerQuintal) || 0

    // Calculate net weight in quintals
    const netWeight = calculateNetWeight(totalBags, bagSize, manualDeduction)
    
    // Calculate base amount
    const baseAmount = netWeight * rate

    // Calculate taxes
    const taxes = calculateTaxes(baseAmount, {
      mandiTax: parseFloat(formData.mandiTax) || 0,
      nirashritShulk: parseFloat(formData.nirashritShulk) || 0,
      labourRate: parseFloat(formData.labourRate) || 0
    })

    setCalculations({
      netWeight,
      baseAmount,
      mandiTax: taxes.mandiTax,
      nirashritShulk: taxes.nirashritShulk,
      labour: taxes.labour,
      totalAmount: baseAmount + taxes.total
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const purchaseData = {
        ...formData,
        ...calculations,
        companyId: params.companyId,
        purchaseType: 'regular',
        billDate: new Date().toISOString()
      }

      const response = await fetch('/api/purchase-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseData)
      })

      if (response.ok) {
        alert('Purchase entry saved successfully!')
        // Reset form
        setFormData({
          sellerName: '',
          sellerPhone: '',
          productName: '',
          unitType: 'bags',
          totalBags: '',
          bagSize: '50',
          manualDeduction: '0',
          ratePerQuintal: '',
          mandiTax: '2',
          nirashritShulk: '1',
          labourRate: '50'
        })
      } else {
        alert('Error saving purchase entry')
      }
    } catch (error) {
      console.error('Error submitting purchase:', error)
      alert('Error saving purchase entry')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Regular Purchase Entry</h1>
        <Badge variant="outline">Single Entry</Badge>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Seller Information */}
        <Card>
          <CardHeader>
            <CardTitle>Seller Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sellerName">Seller Name</Label>
              <Input
                id="sellerName"
                value={formData.sellerName}
                onChange={(e) => setFormData({ ...formData, sellerName: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="sellerPhone">Phone Number</Label>
              <Input
                id="sellerPhone"
                value={formData.sellerPhone}
                onChange={(e) => setFormData({ ...formData, sellerPhone: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Product and Weight Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Product & Weight Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="productName">Product</Label>
                <Select value={formData.productName} onValueChange={(value) => setFormData({ ...formData, productName: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product: any) => (
                      <SelectItem key={product.id} value={product.name}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="unitType">Unit Type</Label>
                <Select value={formData.unitType} onValueChange={(value) => setFormData({ ...formData, unitType: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bags">Bags</SelectItem>
                    <SelectItem value="quintals">Quintals</SelectItem>
                    <SelectItem value="tonnes">Tonnes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ratePerQuintal">Rate per Quintal (₹)</Label>
                <Input
                  id="ratePerQuintal"
                  type="number"
                  value={formData.ratePerQuintal}
                  onChange={(e) => setFormData({ ...formData, ratePerQuintal: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="totalBags">Total Bags</Label>
                <Input
                  id="totalBags"
                  type="number"
                  value={formData.totalBags}
                  onChange={(e) => setFormData({ ...formData, totalBags: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="bagSize">Bag Size (KG)</Label>
                <Input
                  id="bagSize"
                  type="number"
                  value={formData.bagSize}
                  onChange={(e) => setFormData({ ...formData, bagSize: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="manualDeduction">Manual Deduction (KG)</Label>
                <Input
                  id="manualDeduction"
                  type="number"
                  value={formData.manualDeduction}
                  onChange={(e) => setFormData({ ...formData, manualDeduction: e.target.value })}
                />
              </div>
              <div>
                <Label>Net Weight (Quintals)</Label>
                <div className="p-2 bg-gray-100 rounded font-medium">
                  {calculations.netWeight.toFixed(2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tax Calculation */}
        <Card>
          <CardHeader>
            <CardTitle>Tax & Charges</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="mandiTax">Mandi Tax (%)</Label>
                <Input
                  id="mandiTax"
                  type="number"
                  step="0.1"
                  value={formData.mandiTax}
                  onChange={(e) => setFormData({ ...formData, mandiTax: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="nirashritShulk">Nirashrit Shulk (%)</Label>
                <Input
                  id="nirashritShulk"
                  type="number"
                  step="0.1"
                  value={formData.nirashritShulk}
                  onChange={(e) => setFormData({ ...formData, nirashritShulk: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="labourRate">Labour Rate (₹/Quintal)</Label>
                <Input
                  id="labourRate"
                  type="number"
                  value={formData.labourRate}
                  onChange={(e) => setFormData({ ...formData, labourRate: e.target.value })}
                />
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
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Base Amount ({calculations.netWeight.toFixed(2)} Quintals × ₹{formData.ratePerQuintal})</span>
                <span>₹{calculations.baseAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Mandi Tax ({formData.mandiTax}%)</span>
                <span>₹{calculations.mandiTax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Nirashrit Shulk ({formData.nirashritShulk}%)</span>
                <span>₹{calculations.nirashritShulk.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Labour Charges</span>
                <span>₹{calculations.labour.toLocaleString()}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-lg">
                <span>Total Amount</span>
                <span className="text-green-600">₹{calculations.totalAmount.toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting} className="px-8">
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Saving...' : 'Save Purchase Entry'}
          </Button>
        </div>
      </form>
    </div>
  )
}
