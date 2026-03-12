'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Search } from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Party {
  id: string
  name: string
  address: string
  phone1: string
  phone2: string
  type: string
}

interface SalesItem {
  id: string
  salesItemId: string
  salesItemName: string
  productName: string
  productId: string
  weight: number
  bags: number
  rate: number
  amount: number
  discount: number
}

interface SalesItemMasterOption {
  id: string
  productId: string
  salesItemName: string
  product?: {
    name?: string
  }
}

interface ExistingSalesBill {
  id: string
  billNo: string
  billDate: string
  partyId: string
  party?: {
    id: string
    name: string
    address: string
    phone1: string
  }
  salesItems?: Array<{
    id: string
    productId: string
    product?: {
      name?: string
    }
    bags?: number | null
    weight?: number
    rate?: number
    amount?: number
  }>
  transportBills?: Array<{
    transportName?: string | null
    lorryNo?: string | null
    freightPerQt?: number | null
    freightAmount?: number | null
    advance?: number | null
    toPay?: number | null
    otherAmount?: number | null
    insuranceAmount?: number | null
  }>
}

export default function SalesEntryPage() {
  const router = useRouter()
  const itemIdSequence = useRef(0)
  const [companyId, setCompanyId] = useState('')
  const [editBillId, setEditBillId] = useState('')
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Transport search state
  const [transportSearchTerm, setTransportSearchTerm] = useState('')
  const [transports, setTransports] = useState<any[]>([])
  const [filteredTransports, setFilteredTransports] = useState<any[]>([])
  const [showTransportDropdown, setShowTransportDropdown] = useState(false)

  // Sales Items state
  const [salesItems, setSalesItems] = useState<SalesItemMasterOption[]>([])
  const [currentFormItems, setCurrentFormItems] = useState<SalesItem[]>([])
  const [partySearchTerm, setPartySearchTerm] = useState('')
  const [salesItemSearchTerm, setSalesItemSearchTerm] = useState('')

  // Invoice Tab 1 - Basic Info
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedParty, setSelectedParty] = useState('')
  const [partyName, setPartyName] = useState('') // For display only
  const [partyAddress, setPartyAddress] = useState('')
  const [partyContact, setPartyContact] = useState('')

  // Invoice Tab 2 - Transport Info
  const [transportName, setTransportName] = useState('')
  const [lorryNo, setLorryNo] = useState('')
  const [freightPerQt, setFreightPerQt] = useState('')
  const [freightAmount, setFreightAmount] = useState('')
  const [advance, setAdvance] = useState('')
  const [toPay, setToPay] = useState('')
  const [advanceError, setAdvanceError] = useState('')

  // Invoice Tab 3 - Items
  const [currentItem, setCurrentItem] = useState({
    salesItemId: '',
    noOfBags: '',
    weightPerBag: '',
    rate: ''
  })

  // Invoice Tab 4 - Totals
  const [totalProductItemQty, setTotalProductItemQty] = useState(0)
  const [totalNoOfBags, setTotalNoOfBags] = useState(0)
  const [totalWeight, setTotalWeight] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [advanceExpense, setAdvanceExpense] = useState('')
  const [insurance, setInsurance] = useState('')

  const onlyDigits = (value: string, max = 10) => value.replace(/\D/g, '').slice(0, max)
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const additionalTotal = (parseFloat(advanceExpense) || 0) + (parseFloat(insurance) || 0)
  const grandTotal = totalAmount + additionalTotal

  const parseApiJson = async <T,>(response: Response, fallback: T, context: string): Promise<T> => {
    const raw = await response.text()
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      console.error(`${context}: expected JSON but got non-JSON response`, {
        status: response.status,
        preview: raw.slice(0, 120)
      })
      return fallback
    }
  }

  const isEditMode = editBillId !== ''

  const filteredParties = useMemo(() => {
    const query = partySearchTerm.trim().toLowerCase()
    if (!query) return parties
    return parties.filter((party) => {
      if (party.id === selectedParty) return true
      return String(party.name || '').toLowerCase().includes(query)
    })
  }, [parties, partySearchTerm, selectedParty])

  const filteredSalesItems = useMemo(() => {
    const query = salesItemSearchTerm.trim().toLowerCase()
    if (!query) return salesItems
    return salesItems.filter((salesItem) => {
      if (salesItem.id === currentItem.salesItemId) return true
      const label = `${salesItem.salesItemName || ''} ${salesItem.product?.name || ''}`.toLowerCase()
      return label.includes(query)
    })
  }, [salesItems, salesItemSearchTerm, currentItem.salesItemId])

  useEffect(() => {
    void fetchData()
  }, [])

  useEffect(() => {
    // Calculate to pay when freight amount or advance changes
    const freight = parseFloat(freightAmount) || 0
    let adv = parseFloat(advance) || 0
    if (freightAmount !== '' && advance !== '' && adv > freight) {
      setAdvance(String(freight))
      setAdvanceError('Advance amount cannot be greater than freight amount')
      adv = freight
    } else {
      setAdvanceError('')
    }
    setToPay(Math.max(0, freight - adv).toString())
  }, [freightAmount, advance])

  const handleAdvanceChange = (value: string) => {
    const normalized = toNonNegative(value)
    if (normalized === '') {
      setAdvance('')
      setAdvanceError('')
      return
    }

    const nextAdvance = Number(normalized)
    const maxFreight = Number(freightAmount || 0)
    const hasFreight = freightAmount !== ''

    if (hasFreight && nextAdvance > maxFreight) {
      setAdvance(String(maxFreight))
      setAdvanceError('Advance amount cannot be greater than freight amount')
      return
    }

    setAdvance(normalized)
    setAdvanceError('')
  }

  // Filter transports based on search term
  useEffect(() => {
    if (transportSearchTerm) {
      const filtered = transports.filter(transport =>
        transport.transporterName && transport.transporterName.toLowerCase().includes(transportSearchTerm.toLowerCase())
      )
      setFilteredTransports(filtered)
    } else {
      setFilteredTransports(transports)
    }
  }, [transportSearchTerm, transports])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.search-dropdown-container')) {
        setShowTransportDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle party selection with auto-fetch
  const handlePartySelect = (partyId: string) => {
    setSelectedParty(partyId)
    const party = parties.find(p => p.id === partyId)
    if (party) {
      setPartyName(party.name) // For display only
      setPartyAddress(party.address || '')
      setPartyContact(party.phone1 || '')
      setPartySearchTerm(party.name || '')
    } else {
      setPartyName('')
      setPartyAddress('')
      setPartyContact('')
    }
  }

  // Handle new party addition
  const handleAddNewParty = async () => {
    if (!partyName) {
      alert('Please enter party name')
      return
    }
    if (partyContact && onlyDigits(partyContact).length !== 10) {
      alert('Party contact must be exactly 10 digits')
      return
    }

    try {
      if (!companyId) {
        alert('Company ID not found. Please refresh the page.')
        return
      }

      const response = await fetch(`/api/parties?companyId=${companyId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'buyer', // Default to buyer type for sales
          name: partyName,
          address: partyAddress,
          phone1: onlyDigits(partyContact),
        }),
      })

      if (response.ok) {
        const result = await parseApiJson<{ party?: Party; error?: string }>(response, {}, 'Add party API')
        const newParty = result?.party
        if (!newParty?.id) {
          alert(result?.error || 'Party created but invalid response received')
          return
        }
        setParties((prev) => [...prev, newParty])
        setSelectedParty(newParty.id)
        setPartyName(newParty.name || '')
        setPartyAddress(newParty.address || '')
        setPartyContact(newParty.phone1 || '')
        setPartySearchTerm(newParty.name || '')
        alert('Party added successfully!')
      } else {
        const error = await parseApiJson<{ error?: string }>(response, {}, 'Add party API error')
        alert('Error adding party: ' + (error.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error adding party: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleTransportSearch = (term: string) => {
    setTransportSearchTerm(term)
    setShowTransportDropdown(true)
  }

  const handleTransportSelect = (transport: any) => {
    setTransportName(transport.transporterName || '')
    setTransportSearchTerm(transport.transporterName || '')
    setLorryNo(transport.vehicleNumber || '')
    setShowTransportDropdown(false)
  }

  const handleAddNewTransport = () => {
    router.push('/master/transport')
  }

  const populateFromExistingBill = (bill: ExistingSalesBill, allSalesItems: SalesItemMasterOption[]) => {
    setEditBillId(bill.id)
    setInvoiceNo(String(bill.billNo || ''))
    {
      const parsedDate = new Date(bill.billDate)
      const safeDate = Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      setInvoiceDate(safeDate)
    }

    const partyId = String(bill.partyId || bill.party?.id || '')
    setSelectedParty(partyId)
    setPartyName(String(bill.party?.name || ''))
    setPartyAddress(String(bill.party?.address || ''))
    setPartyContact(String(bill.party?.phone1 || ''))
    setPartySearchTerm(String(bill.party?.name || ''))

    const firstTransport = Array.isArray(bill.transportBills) ? bill.transportBills[0] : undefined
    const transportLabel = String(firstTransport?.transportName || '')
    setTransportName(transportLabel)
    setTransportSearchTerm(transportLabel)
    setLorryNo(String(firstTransport?.lorryNo || ''))
    setFreightPerQt(String(Math.max(0, Number(firstTransport?.freightPerQt || 0))))
    setFreightAmount(String(Math.max(0, Number(firstTransport?.freightAmount || 0))))
    setAdvance(String(Math.max(0, Number(firstTransport?.advance || 0))))
    setToPay(String(Math.max(0, Number(firstTransport?.toPay || 0))))
    setAdvanceExpense(String(Math.max(0, Number(firstTransport?.otherAmount || 0))))
    setInsurance(String(Math.max(0, Number(firstTransport?.insuranceAmount || 0))))

    const mappedItems: SalesItem[] = Array.isArray(bill.salesItems)
      ? bill.salesItems.map((item, index) => {
          const mappedMaster = allSalesItems.find((entry) => entry.productId === item.productId)
          return {
            id: String(item.id || `existing-${index + 1}`),
            salesItemId: String(mappedMaster?.id || ''),
            salesItemName: String(mappedMaster?.salesItemName || item.product?.name || ''),
            productName: String(item.product?.name || mappedMaster?.product?.name || ''),
            productId: String(item.productId || ''),
            weight: Math.max(0, Number(item.weight || 0)),
            bags: Math.max(0, Number(item.bags || 0)),
            rate: Math.max(0, Number(item.rate || 0)),
            amount: Math.max(0, Number(item.amount || 0)),
            discount: 0
          }
        })
      : []

    itemIdSequence.current = mappedItems.length
    setCurrentFormItems(mappedItems)
    updateTotals(mappedItems)
  }

  const fetchData = async () => {
    try {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)

      if (!resolvedCompanyId) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }
      setCompanyId(resolvedCompanyId)

      const billIdFromQuery = new URLSearchParams(window.location.search).get('billId')?.trim() || ''
      if (!billIdFromQuery) {
        stripCompanyParamsFromUrl()
      }

      const [partiesRes, transportsRes, salesItemsRes] = await Promise.all([
        fetch(`/api/parties?companyId=${resolvedCompanyId}`),
        fetch(`/api/transports?companyId=${resolvedCompanyId}`),
        fetch(`/api/sales-item-masters?companyId=${resolvedCompanyId}`)
      ])

      if ([partiesRes, transportsRes, salesItemsRes].some((res) => res.status === 401 || res.status === 403)) {
        alert('Session expired. Please login again.')
        router.push('/login')
        return
      }

      const [partiesData, transportsData, salesItemsData] = await Promise.all([
        parseApiJson<any[]>(partiesRes, [], 'Parties API'),
        parseApiJson<any[]>(transportsRes, [], 'Transports API'),
        parseApiJson<any[]>(salesItemsRes, [], 'Sales item masters API')
      ])

      const nextParties = Array.isArray(partiesData) ? partiesData : []
      const nextTransports = Array.isArray(transportsData) ? transportsData : []
      const nextSalesItems = Array.isArray(salesItemsData) ? salesItemsData : []

      setParties(nextParties)
      setTransports(nextTransports)
      setFilteredTransports(nextTransports)
      setSalesItems(nextSalesItems)

      if (billIdFromQuery) {
        const existingRes = await fetch(`/api/sales-bills?companyId=${resolvedCompanyId}&billId=${billIdFromQuery}`)
        if (!existingRes.ok) {
          alert('Sales bill not found for editing.')
          router.push('/sales/list')
          return
        }
        const existingBill = await parseApiJson<ExistingSalesBill | null>(existingRes, null, 'Sales bill by id API')
        if (!existingBill?.id) {
          alert('Sales bill not found for editing.')
          router.push('/sales/list')
          return
        }

        populateFromExistingBill(existingBill, nextSalesItems)
        setLoading(false)
        return
      }

      const billsRes = await fetch(`/api/sales-bills?companyId=${resolvedCompanyId}&last=true`)
      if (!billsRes.ok) {
        setInvoiceNo('1')
        setLoading(false)
        return
      }
      const billsData = await parseApiJson<{ lastBillNumber?: number }>(billsRes, { lastBillNumber: 0 }, 'Sales bills API')
      const lastBillNum = Number(billsData.lastBillNumber || 0)
      const nextInvoiceNumber = lastBillNum <= 0 ? 1 : lastBillNum + 1
      setInvoiceNo(nextInvoiceNumber.toString())

      setLoading(false)
    } catch (error) {
      console.error('Error fetching data:', error)
      setLoading(false)
    }
  }

  const calculateItemTotals = () => {
    const noOfBags = parseFloat(currentItem.noOfBags) || 0
    const weightPerBag = parseFloat(currentItem.weightPerBag) || 0
    const rate = parseFloat(currentItem.rate) || 0
    
    // Mandi calculations: Weight in kg, then convert to Qt (100kg = 1Qt)
    const totalWeightKg = noOfBags * weightPerBag
    const totalWeightQt = totalWeightKg / 100 // Convert kg to Qt
    const amount = totalWeightQt * rate // Amount = Qt × Rate
    
    return { totalWeight: totalWeightQt, amount }
  }

  const handleAddItem = () => {
    if (!currentItem.salesItemId) {
      alert('Sales item is required')
      return
    }
    if (!currentItem.noOfBags) {
      alert('No. of Bags is required')
      return
    }
    if (!currentItem.weightPerBag) {
      alert('Weight / Bag is required')
      return
    }
    if (!currentItem.rate) {
      alert('Rate / Qt is mandatory')
      return
    }

    if (salesItems.length === 0) {
      alert('No Sales Item Master found. Please add sales items in Master > Sales Item.')
      return
    }

    const salesItem = salesItems.find((s) => s.id === currentItem.salesItemId)
    const { totalWeight, amount } = calculateItemTotals()
    const bags = parseFloat(currentItem.noOfBags) || 0
    const rate = parseFloat(currentItem.rate) || 0
    if (bags <= 0 || totalWeight <= 0 || rate <= 0 || amount < 0) {
      alert('Bags, weight and rate must be greater than 0')
      return
    }

    const newItem: SalesItem = {
      id: `item-${++itemIdSequence.current}`,
      salesItemId: salesItem?.id || '',
      salesItemName: salesItem?.salesItemName || salesItem?.product?.name || '',
      productName: salesItem?.product?.name || '',
      productId: salesItem?.productId || '',
      weight: totalWeight || 0,
      bags,
      rate,
      amount: amount || 0,
      discount: 0 // Default discount to 0
    }

    if (!newItem.productId) {
      alert('Invalid product selection. Please select a valid sales item from the dropdown.')
      return
    }

    setCurrentFormItems([...currentFormItems, newItem])
    updateTotals([...currentFormItems, newItem])

    // Reset current item
    setCurrentItem({
      salesItemId: '',
      noOfBags: '',
      weightPerBag: '',
      rate: ''
    })
  }

  const updateTotals = (items: SalesItem[]) => {
    const totalQty = items.length
    const totalBags = items.reduce((sum, item) => sum + (item.bags || 0), 0)
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 0), 0)
    const totalAmt = items.reduce((sum, item) => sum + (item.amount || 0), 0)

    setTotalProductItemQty(totalQty)
    setTotalNoOfBags(totalBags)
    setTotalWeight(totalWeight)
    setTotalAmount(totalAmt)
  }

  const handleRemoveItem = (id: string) => {
    const updatedItems = currentFormItems.filter(item => item.id !== id)
    setCurrentFormItems(updatedItems)
    updateTotals(updatedItems)
  }

  const handleClearItems = () => {
    setCurrentFormItems([])
    updateTotals([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Comprehensive validation
    if (!selectedParty) {
      alert('Party selection is required')
      return
    }
    
    if (!invoiceDate) {
      alert('Invoice date is required')
      return
    }
    
    if (currentFormItems.length === 0) {
      alert('At least one sales item is required')
      return
    }
    
    // Validate each item
    for (const item of currentFormItems) {
      if (item.bags <= 0) {
        alert('Number of bags must be greater than 0')
        return
      }
      if (item.weight <= 0) {
        alert('Weight must be greater than 0')
        return
      }
      if (item.rate <= 0) {
        alert('Rate must be greater than 0')
        return
      }
    }

    const freight = parseFloat(freightAmount) || 0
    const adv = parseFloat(advance) || 0
    if (adv > freight) {
      setAdvanceError('Advance amount cannot be greater than freight amount')
      return
    }
    
    try {
      if (!companyId) {
        alert('Company ID is missing')
        return
      }

      const salesBillItems = currentFormItems.map(item => ({
        productId: item.productId,
        weight: item.weight,
        bags: item.bags,
        rate: item.rate,
        amount: item.amount
      }))

      const finalTotalAmount = Math.max(0, grandTotal)

      const requestData: Record<string, unknown> = {
        companyId,
        invoiceNo,
        invoiceDate,
        partyId: selectedParty,
        partyAddress,
        partyContact,
        salesItems: salesBillItems,
        totalAmount: finalTotalAmount,
        transportBill: {
          transportName,
          lorryNo,
          freightPerQt: Math.max(0, parseFloat(freightPerQt) || 0),
          freightAmount: Math.max(0, parseFloat(freightAmount) || 0),
          advance: Math.max(0, parseFloat(advance) || 0),
          toPay: Math.max(0, parseFloat(toPay) || 0),
          otherAmount: Math.max(0, parseFloat(advanceExpense) || 0),
          insuranceAmount: Math.max(0, parseFloat(insurance) || 0)
        }
      }

      if (isEditMode) {
        requestData.id = editBillId
      } else {
        requestData.status = 'unpaid'
      }

      setSubmitting(true)

      const response = await fetch('/api/sales-bills', {
        method: isEditMode ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      const responseText = await response.text()
      let parsedResponse: any = {}
      try {
        parsedResponse = responseText ? JSON.parse(responseText) : {}
      } catch {
        parsedResponse = {}
      }

      if (response.ok) {
        const resolvedId = parsedResponse?.salesBillId || parsedResponse?.salesBill?.id || editBillId
        alert(isEditMode ? 'Sales bill updated successfully!' : 'Sales bill created successfully!')
        if (resolvedId) {
          const printPath = companyId
            ? `/sales/${resolvedId}/print?type=invoice&companyId=${encodeURIComponent(companyId)}`
            : `/sales/${resolvedId}/print?type=invoice`
          router.push(printPath)
        } else {
          router.push('/sales/list')
        }
      } else {
        const errorMessage =
          parsedResponse?.error ||
          parsedResponse?.message ||
          response.statusText ||
          'Unknown error'
        alert(`Error saving sales bill: ${errorMessage}`)
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error saving sales bill')
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

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">{isEditMode ? 'Edit Sales Bill' : 'Sales Entry'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                {/* Section 1 - Basic Info */}
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 pb-2 border-b">1. Basic Info</h3>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-3">
                        <Label htmlFor="invoiceNo">Invoice No. (Auto-generated)</Label>
                        <Input 
                          id="invoiceNo" 
                          value={invoiceNo || 'Loading...'} 
                          readOnly 
                          className="bg-gray-100 font-semibold" 
                        />
                        {invoiceNo && (
                          <p className="text-xs text-gray-500 mt-1">
                            {parseInt(invoiceNo) === 1 
                              ? `First invoice for this company` 
                              : `Next invoice: ${invoiceNo}`
                            }
                          </p>
                        )}
                      </div>
                      <div className="lg:col-span-3">
                        <Label htmlFor="invoiceDate">Invoice Date</Label>
                        <Input
                          id="invoiceDate"
                          type="date"
                          value={invoiceDate}
                          onChange={(e) => setInvoiceDate(e.target.value)}
                          required
                        />
                      </div>
                      <div className="lg:col-span-6">
                        <Label htmlFor="party">Party</Label>
                        <div className="space-y-2">
                          <div className="relative">
                            <Input
                              value={partySearchTerm}
                              onChange={(e) => setPartySearchTerm(e.target.value)}
                              placeholder="Search party name..."
                              className="pr-10"
                            />
                            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          </div>
                          <Select value={selectedParty} onValueChange={handlePartySelect}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select Party" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredParties
                                .filter((party, index, self) => !!party?.id && index === self.findIndex((p) => p.id === party.id))
                                .map((party, index) => (
                                <SelectItem key={`${party.id}-${index}`} value={party.id}>
                                  {party.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="lg:col-span-3">
                        <Label htmlFor="partyName">Party Name</Label>
                        <Input
                          id="partyName"
                          value={partyName}
                          onChange={(e) => setPartyName(e.target.value)}
                          placeholder="Enter party name"
                          required
                          disabled={selectedParty !== ''}
                        />
                      </div>
                      <div className="lg:col-span-4">
                        <Label htmlFor="partyAddress">Party Address</Label>
                        <Input
                          id="partyAddress"
                          value={partyAddress}
                          onChange={(e) => setPartyAddress(e.target.value)}
                          placeholder="Enter party address"
                          disabled={selectedParty !== ''}
                        />
                      </div>
                      <div className="lg:col-span-3">
                        <Label htmlFor="partyContact">Party Contact No.</Label>
                        <Input
                          id="partyContact"
                          value={partyContact}
                          onChange={(e) => setPartyContact(onlyDigits(e.target.value))}
                          placeholder="Enter 10 digit contact"
                          inputMode="numeric"
                          maxLength={10}
                          disabled={selectedParty !== ''}
                        />
                      </div>

                      {/* Add New Party Button */}
                      {!selectedParty && partyName && (
                        <div className="lg:col-span-2 flex items-end">
                          <Button type="button" variant="outline" onClick={handleAddNewParty}>
                            Add Party
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 2 - Transport Info */}
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 pb-2 border-b">2. Transport Info</h3>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div>
                        <Label htmlFor="transportName">Transport Name</Label>
                        <div className="relative search-dropdown-container">
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                id="transportName"
                                value={transportSearchTerm}
                                onChange={(e) => handleTransportSearch(e.target.value)}
                                onFocus={() => setShowTransportDropdown(true)}
                                placeholder="Type to search transport..."
                                className="pr-10"
                              />
                              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleAddNewTransport}
                              className="flex items-center gap-1"
                            >
                              <Plus className="h-4 w-4" />
                              Add New
                            </Button>
                          </div>
                          
                          {showTransportDropdown && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {filteredTransports.length > 0 ? (
                                filteredTransports.map((transport) => (
                                  <div
                                    key={transport.id}
                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                                    onClick={() => handleTransportSelect(transport)}
                                  >
                                    <div className="font-medium">{transport.transporterName || 'No Name'}</div>
                                    {transport.vehicleNumber && (
                                      <div className="text-sm text-gray-500">Vehicle: {transport.vehicleNumber}</div>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-gray-500 text-sm">
                                  No transports found. Click Add New to create one.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="lorryNumber">Lorry Number</Label>
                        <Input
                          id="lorryNumber"
                          value={lorryNo}
                          onChange={(e) => setLorryNo(e.target.value)}
                          placeholder="Enter lorry number"
                        />
                      </div>
                      <div>
                        <Label htmlFor="freightPerQt">Freight Per Qt.</Label>
                        <Input
                          id="freightPerQt"
                          type="number"
                          min="0"
                          step="0.01"
                          value={freightPerQt}
                          onChange={(e) => setFreightPerQt(toNonNegative(e.target.value))}
                          placeholder="Enter freight per quantity"
                        />
                      </div>
                      <div>
                        <Label htmlFor="freightAmount">Freight Amount</Label>
                        <Input
                          id="freightAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={freightAmount}
                          onChange={(e) => setFreightAmount(toNonNegative(e.target.value))}
                          placeholder="Enter freight amount"
                        />
                      </div>
                      <div>
                        <Label htmlFor="advance">Advance</Label>
                        <Input
                          id="advance"
                          type="number"
                          min="0"
                          max={freightAmount || undefined}
                          step="0.01"
                          value={advance}
                          onChange={(e) => handleAdvanceChange(e.target.value)}
                          placeholder="Enter advance amount"
                          className={advanceError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                        />
                        {advanceError ? (
                          <p className="mt-1 text-right text-sm text-red-600">{advanceError}</p>
                        ) : null}
                      </div>
                      <div>
                        <Label htmlFor="toPay">To Pay</Label>
                        <Input
                          id="toPay"
                          value={toPay}
                          readOnly
                          className="bg-gray-100"
                          placeholder="Calculated automatically"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3 - Items */}
                <div className="mb-0">
                  <h3 className="text-lg font-semibold mb-4 pb-2 border-b">3. Items</h3>
                  <div className="space-y-6">
                    {/* Add Item Form */}
                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-4">Add Item</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
                        <div className="lg:col-span-2">
                          <Label htmlFor="itemProduct">Sales Items</Label>
                          <div className="relative mb-2">
                            <Input
                              value={salesItemSearchTerm}
                              onChange={(e) => setSalesItemSearchTerm(e.target.value)}
                              placeholder="Search sales item..."
                              className="pr-10"
                            />
                            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          </div>
                          <Select value={currentItem.salesItemId} onValueChange={(value) => {
                            setCurrentItem({ ...currentItem, salesItemId: value })
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Sales Item" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredSalesItems.length > 0 ? (
                                filteredSalesItems.map((salesItem) => (
                                  <SelectItem key={salesItem.id} value={salesItem.id}>
                                    {salesItem.salesItemName} ({salesItem.product?.name || 'No product'})
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-sm text-gray-500">
                                  No Sales Item Master data found.
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                          {salesItems.length === 0 ? (
                            <p className="mt-1 text-xs text-gray-500">
                              Add entries in Master &gt; Sales Item to continue.
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <Label htmlFor="noOfBags">No. of Bags</Label>
                          <Input
                            id="noOfBags"
                            type="number"
                            min="0"
                            value={currentItem.noOfBags}
                            onChange={(e) => setCurrentItem({...currentItem, noOfBags: toNonNegative(e.target.value)})}
                            placeholder="Enter bags"
                          />
                        </div>
                        <div>
                          <Label htmlFor="weightPerBag">Weight / Bag in Kg</Label>
                          <Input
                            id="weightPerBag"
                            type="number"
                            min="0"
                            step="0.01"
                            value={currentItem.weightPerBag}
                            onChange={(e) => setCurrentItem({...currentItem, weightPerBag: toNonNegative(e.target.value)})}
                            placeholder="Enter weight per bag"
                          />
                        </div>
                        <div>
                          <Label htmlFor="itemRate">
                            Rate / Qt <span className="text-red-600">*</span>
                          </Label>
                          <Input
                            id="itemRate"
                            type="number"
                            min="0"
                            step="0.01"
                            value={currentItem.rate}
                            onChange={(e) => setCurrentItem({...currentItem, rate: toNonNegative(e.target.value)})}
                            placeholder="Enter rate"
                          />
                        </div>
                        <div>
                          <Label>Total Weight (Qt.)</Label>
                          <Input
                            value={calculateItemTotals().totalWeight.toFixed(2)}
                            readOnly
                            className="bg-gray-100"
                          />
                        </div>
                        <div>
                          <Label>Amount</Label>
                          <Input
                            value={calculateItemTotals().amount.toFixed(2)}
                            readOnly
                            className="bg-gray-100"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button type="button" onClick={handleAddItem}>Add</Button>
                        <Button type="button" variant="outline" onClick={handleClearItems}>Clear</Button>
                      </div>
                    </div>

                    {/* Items Table */}
                    {currentFormItems.length > 0 && (
                      <div className="border rounded-lg p-4">
                        <h3 className="font-semibold mb-4">Added Items</h3>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left p-4">#</th>
                                <th className="text-left p-2">Sales Item</th>
                                <th className="text-right p-2">Bags</th>
                                <th className="text-right p-2">Weight (Qt.)</th>
                                <th className="text-right p-2">Rate / Qt</th>
                                <th className="text-right p-2">Amount</th>
                                <th className="text-center p-2">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentFormItems.map((item, index) => (
                                <tr key={item.id} className="border-b">
                                  <td className="p-2">{index + 1}</td>
                                  <td className="p-2">{item.salesItemName || item.productName || '-'}</td>
                                  <td className="p-2 text-right">{item.bags || 0}</td>
                                  <td className="p-2 text-right">{(item.weight || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right">{(item.rate || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right">{(item.amount || 0).toFixed(2)}</td>
                                  <td className="p-2 text-center">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleRemoveItem(item.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                   </div>

                {/* Section 4 - Additional Charges */}
                <div className="mt-2">
                  <h3 className="text-lg font-semibold mb-2 pb-2 border-b">4. Additional Charges</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="advanceExpense">Other Amount</Label>
                      <Input
                        id="advanceExpense"
                        type="number"
                        min="0"
                        step="0.01"
                        value={advanceExpense}
                        onChange={(e) => setAdvanceExpense(toNonNegative(e.target.value))}
                        placeholder="Enter other amount"
                      />
                    </div>
                    <div>
                      <Label htmlFor="insurance">Insurance</Label>
                      <Input
                        id="insurance"
                        type="number"
                        min="0"
                        step="0.01"
                        value={insurance}
                        onChange={(e) => setInsurance(toNonNegative(e.target.value))}
                        placeholder="Enter insurance amount"
                      />
                    </div>
                    <div>
                      <Label htmlFor="additionalTotal">Additional Total</Label>
                      <Input
                        id="additionalTotal"
                        value={additionalTotal.toFixed(2)}
                        readOnly
                        className="bg-gray-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 5 - Totals */}
                <div className="mt-3">
                  <h3 className="text-lg font-semibold mb-2 pb-2 border-b">5. Totals</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="text-center p-2 bg-blue-50 rounded-lg border border-blue-200">
                      <Label className="text-xs text-gray-600 block">Total Sales Item Qty</Label>
                      <p className="text-lg font-bold text-blue-600">{totalProductItemQty}</p>
                    </div>
                    <div className="text-center p-2 bg-green-50 rounded-lg border border-green-200">
                      <Label className="text-xs text-gray-600 block">Total No. of Bags</Label>
                      <p className="text-lg font-bold text-green-600">{totalNoOfBags}</p>
                    </div>
                    <div className="text-center p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                      <Label className="text-xs text-gray-600 block">Total Weight (Qt.)</Label>
                      <p className="text-lg font-bold text-yellow-600">{totalWeight.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 bg-purple-50 rounded-lg border border-purple-200">
                      <Label className="text-xs text-gray-600 block">Items Total</Label>
                      <p className="text-lg font-bold text-purple-600">₹{totalAmount.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                      <Label className="text-xs text-gray-600 block">Grand Total</Label>
                      <p className="text-lg font-bold text-emerald-700">₹{grandTotal.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Submit Buttons */}
                <div className="flex justify-between items-center">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Saving...' : isEditMode ? 'Update Sales Bill' : 'Save Sales Bill'}
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
