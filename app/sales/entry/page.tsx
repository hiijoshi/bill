'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, MessageCircle, Pencil, Plus, SplitSquareVertical, Trash2 } from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import SalesInvoiceSplitDialog from '@/components/sales/SalesInvoiceSplitDialog'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { calculateTaxBreakdown, roundCurrency } from '@/lib/billing-calculations'
import { loadClientCachedValue } from '@/lib/client-cached-value'
import { calculateMandiCharges, getCalculationBasisLabel } from '@/lib/mandi-charge-engine'
import {
  DEFAULT_SALES_ADDITIONAL_CHARGE_TYPES,
  normalizeSalesAdditionalCharges,
  summarizeSalesAdditionalCharges,
} from '@/lib/sales-additional-charges'
import { getDefaultTransactionDateInput } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'
import { openWhatsappChat } from '@/lib/whatsapp'

interface Party {
  id: string
  name: string
  address: string
  phone1: string
  phone2: string
  type: string
  creditLimit?: number | null
  creditDays?: number | null
  mandiTypeId?: string | null
  mandiTypeName?: string | null
}

interface AccountingHeadCharge {
  id: string
  name: string
  category: string
  mandiTypeId?: string | null
  isMandiCharge: boolean
  calculationBasis?: string | null
  defaultValue?: number
  accountGroup?: string | null
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
  gstRate: number
  gstAmount: number
  lineTotal: number
  discount: number
}

interface SalesItemMasterOption {
  id: string
  productId: string
  salesItemName: string
  gstRate?: number | null
  product?: {
    name?: string
  }
}

interface PartyRiskResponse {
  party?: {
    id?: string
    name?: string
    phone1?: string
    creditLimit?: number | null
    creditDays?: number | null
  }
  outstandingAmount?: number
  overdueAmount?: number
  pendingSaleAmount?: number
  projectedOutstanding?: number
  remainingLimit?: number | null
  hasOverdue?: boolean
  isOverLimit?: boolean
}

type ItemPricingMode = 'rate' | 'amount'

const createEmptyCurrentItem = () => ({
  salesItemId: '',
  noOfBags: '',
  weightPerBag: '',
  rate: '',
  amount: '',
  pricingMode: 'rate' as ItemPricingMode
})

interface SalesAdditionalChargeBucket {
  id: string
  chargeType: string
  amount: string
  remark: string
}

const createEmptyAdditionalChargeBucket = (): SalesAdditionalChargeBucket => ({
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  chargeType: '',
  amount: '',
  remark: ''
})

const PERMANENT_ADDITIONAL_CHARGE_TYPES = [
  'Mandi tax %',
  'Labour',
  'Loading labour',
  'Bardan',
  'Commission',
  'Miscellaneous'
] as const

const createPermanentAdditionalChargeBuckets = (): SalesAdditionalChargeBucket[] =>
  PERMANENT_ADDITIONAL_CHARGE_TYPES.map((chargeType) => ({
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    chargeType,
    amount: '',
    remark: '',
  }))

interface ExistingSalesBill {
  id: string
  billNo: string
  billDate: string
  subTotalAmount?: number
  gstAmount?: number
  totalAmount?: number
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
    gstRateSnapshot?: number
    gstAmount?: number
    lineTotal?: number
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
  additionalCharges?: Array<{
    id?: string
    chargeType?: string | null
    amount?: number | null
    remark?: string | null
  }>
  splitSummary?: {
    invoiceKind?: string
    workflowStatus?: string
    childCount?: number
    parentBillId?: string | null
    parentBillNo?: string | null
  }
}

interface TransportOption {
  id: string
  transporterName?: string
  vehicleNumber?: string
}

interface SalesBillSaveResponse {
  salesBillId?: string
  salesBill?: {
    id?: string
  }
  error?: string
  message?: string
}

const SALES_ENTRY_CACHE_AGE_MS = 20_000

type SalesEntryCachePayload = {
  parties: Party[]
  transports: TransportOption[]
  salesItems: SalesItemMasterOption[]
  accountingHeads: AccountingHeadCharge[]
  existingBill: ExistingSalesBill | null
  lastBillNumber: number
}

async function parseApiJson<T>(response: Response, fallback: T, context: string): Promise<T> {
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

function formatRemainingLimitText(value: number | null): string {
  if (typeof value !== 'number') return 'Unlimited'

  const normalized = roundCurrency(value)
  const amountText = `₹${Math.abs(normalized).toFixed(2)}`

  if (normalized < 0) {
    return `Over by ${amountText}`
  }

  return amountText
}

export default function SalesEntryPage() {
  const router = useRouter()
  const itemIdSequence = useRef(0)
  const [companyId, setCompanyId] = useState('')
  const [editBillId, setEditBillId] = useState('')
  const [splitDialogOpen, setSplitDialogOpen] = useState(false)
  const [loadedSplitSummary, setLoadedSplitSummary] = useState<ExistingSalesBill['splitSummary'] | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [accountingHeads, setAccountingHeads] = useState<AccountingHeadCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { financialYear } = useClientFinancialYear()

  const [transports, setTransports] = useState<TransportOption[]>([])
  const [selectedTransportId, setSelectedTransportId] = useState('')

  // Sales Items state
  const [salesItems, setSalesItems] = useState<SalesItemMasterOption[]>([])
  const [currentFormItems, setCurrentFormItems] = useState<SalesItem[]>([])
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // Invoice Tab 1 - Basic Info
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
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
  useEffect(() => {
    setInvoiceDate(getDefaultTransactionDateInput(financialYear))
  }, [financialYear?.id])

  // Invoice Tab 3 - Items
  const [currentItem, setCurrentItem] = useState(createEmptyCurrentItem)

  // Invoice Tab 4 - Totals
  const [totalProductItemQty, setTotalProductItemQty] = useState(0)
  const [totalNoOfBags, setTotalNoOfBags] = useState(0)
  const [totalWeight, setTotalWeight] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [additionalChargeBuckets, setAdditionalChargeBuckets] = useState<SalesAdditionalChargeBucket[]>(
    createPermanentAdditionalChargeBuckets()
  )
  const [manualGrandTotal, setManualGrandTotal] = useState('')
  const [manualGrandTotalTouched, setManualGrandTotalTouched] = useState(false)
  const [partyRisk, setPartyRisk] = useState<PartyRiskResponse | null>(null)
  const [riskDialogOpen, setRiskDialogOpen] = useState(false)
  const [pendingRequestData, setPendingRequestData] = useState<Record<string, unknown> | null>(null)
  const preserveLoadedManualGrandTotalRef = useRef(false)
  const previousComputedGrandTotalRef = useRef<number | null>(null)

  const onlyDigits = (value: string, max = 10) => value.replace(/\D/g, '').slice(0, max)
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const freightAdvanceTotal = parseFloat(advance) || 0
  const normalizedAdditionalCharges = useMemo(
    () =>
      normalizeSalesAdditionalCharges(
        additionalChargeBuckets.map((bucket) => ({
          chargeType: bucket.chargeType,
          amount: bucket.amount,
          remark: bucket.remark,
        }))
      ),
    [additionalChargeBuckets]
  )
  const extraChargesSummary = useMemo(
    () => summarizeSalesAdditionalCharges(normalizedAdditionalCharges),
    [normalizedAdditionalCharges]
  )
  const extraChargesTotal = extraChargesSummary.totalAmount
  const additionalTotal = freightAdvanceTotal + extraChargesTotal
  const totalGstAmount = useMemo(
    () => roundCurrency(currentFormItems.reduce((sum, item) => sum + (item.gstAmount || 0), 0)),
    [currentFormItems]
  )
  const computedGrandTotal = useMemo(
    () => roundCurrency(totalAmount + totalGstAmount + additionalTotal),
    [additionalTotal, totalAmount, totalGstAmount]
  )

  const selectedPartyRecord = useMemo(
    () => parties.find((party) => party.id === selectedParty) || null,
    [parties, selectedParty]
  )

  const selectedTransportRecord = useMemo(
    () => transports.find((transport) => transport.id === selectedTransportId) || null,
    [selectedTransportId, transports]
  )

  const selectedCurrentSalesItem = useMemo(
    () => salesItems.find((item) => item.id === currentItem.salesItemId) || null,
    [currentItem.salesItemId, salesItems]
  )

  const partyOptions = useMemo<SearchableSelectOption[]>(
    () =>
      parties.map((party) => ({
        value: party.id,
        label: party.name,
        description: [party.address, party.phone1].filter(Boolean).join(' | ') || party.type || 'Party',
        keywords: [party.name, party.address, party.phone1, party.phone2, party.type, party.mandiTypeName].filter(Boolean) as string[],
      })),
    [parties]
  )

  const transportOptions = useMemo<SearchableSelectOption[]>(
    () =>
      transports.map((transport) => ({
        value: transport.id,
        label: String(transport.transporterName || 'Transport'),
        description: transport.vehicleNumber ? `Vehicle: ${transport.vehicleNumber}` : 'Transport master',
        keywords: [transport.transporterName, transport.vehicleNumber].filter(Boolean) as string[],
      })),
    [transports]
  )

  const salesItemOptions = useMemo<SearchableSelectOption[]>(
    () =>
      salesItems.map((salesItem) => ({
        value: salesItem.id,
        label: salesItem.salesItemName || salesItem.product?.name || 'Sales Item',
        description: salesItem.product?.name ? `Product: ${salesItem.product.name}` : 'Sales item master',
        keywords: [salesItem.salesItemName, salesItem.product?.name].filter(Boolean) as string[],
      })),
    [salesItems]
  )

  const additionalChargeTypeOptions = useMemo<SearchableSelectOption[]>(() => {
    const dynamicNames = accountingHeads
      .map((head) => String(head.name || '').trim())
      .filter(Boolean)

    const labels = Array.from(
      new Set(
        [...DEFAULT_SALES_ADDITIONAL_CHARGE_TYPES, ...dynamicNames].map((label) => label.trim()).filter(Boolean)
      )
    )

    return labels.map((label) => {
      const matchedHead = accountingHeads.find(
        (head) => String(head.name || '').trim().toLowerCase() === label.toLowerCase()
      )

      return {
        value: label,
        label,
        description: matchedHead
          ? [matchedHead.category, matchedHead.accountGroup || ''].filter(Boolean).join(' | ') || 'Accounting Head'
          : 'Additional charge type',
        keywords: [label, matchedHead?.category, matchedHead?.accountGroup].filter(Boolean) as string[],
      }
    })
  }, [accountingHeads])

  const mandiChargePreview = useMemo(() => {
    return calculateMandiCharges({
      definitions: accountingHeads.map((head, index) => ({
        accountingHeadId: head.id,
        name: head.name,
        category: head.category,
        mandiTypeId: head.mandiTypeId || null,
        isMandiCharge: head.isMandiCharge,
        calculationBasis: head.calculationBasis,
        defaultValue: head.defaultValue,
        accountGroup: head.accountGroup,
        sortOrder: index
      })),
      mandiTypeId: selectedPartyRecord?.mandiTypeId || null,
      subTotal: totalAmount,
      totalWeight,
      totalBags: totalNoOfBags
    })
  }, [accountingHeads, selectedPartyRecord?.mandiTypeId, totalAmount, totalNoOfBags, totalWeight])

  const computedGrandTotalWithMandi = useMemo(
    () => roundCurrency(computedGrandTotal + mandiChargePreview.totalChargeAmount),
    [computedGrandTotal, mandiChargePreview.totalChargeAmount]
  )

  const grandTotal = manualGrandTotal !== ''
    ? roundCurrency(parseFloat(manualGrandTotal) || 0)
    : computedGrandTotalWithMandi

  const isEditMode = editBillId !== ''

  const fetchPartyRisk = useCallback(
    async (partyId: string, pendingSaleAmount: number) => {
      if (!companyId || !partyId) return null

      try {
        const params = new URLSearchParams({
          companyId,
          partyId,
          pendingSaleAmount: String(roundCurrency(pendingSaleAmount)),
          referenceDate: invoiceDate,
        })
        if (editBillId) {
          params.set('excludeBillId', editBillId)
        }
        const response = await fetch(
          `/api/sales-bills/risk?${params.toString()}`
        )
        if (!response.ok) return null
        return (await response.json()) as PartyRiskResponse
      } catch (error) {
        console.error('Failed to load party risk:', error)
        return null
      }
    },
    [companyId, editBillId, invoiceDate]
  )

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

  useEffect(() => {
    const previousComputedGrandTotal = previousComputedGrandTotalRef.current
    previousComputedGrandTotalRef.current = computedGrandTotalWithMandi

    if (previousComputedGrandTotal === null) return
    if (Math.abs(previousComputedGrandTotal - computedGrandTotalWithMandi) < 0.01) return
    if (preserveLoadedManualGrandTotalRef.current) {
      preserveLoadedManualGrandTotalRef.current = false
      return
    }
    if (!manualGrandTotalTouched && manualGrandTotal !== '') {
      setManualGrandTotal('')
    }
  }, [computedGrandTotalWithMandi, manualGrandTotal, manualGrandTotalTouched])

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

  useEffect(() => {
    if (!selectedParty || !companyId) {
      setPartyRisk(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const risk = await fetchPartyRisk(selectedParty, grandTotal)
        setPartyRisk(risk)
      })()
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [companyId, fetchPartyRisk, grandTotal, selectedParty])

  // Handle party selection with auto-fetch
  const handlePartySelect = (partyId: string) => {
    setSelectedParty(partyId)
    const party = parties.find(p => p.id === partyId)
    if (party) {
      setPartyName(party.name) // For display only
      setPartyAddress(party.address || '')
      setPartyContact(party.phone1 || '')
    } else {
      setPartyName('')
      setPartyAddress('')
      setPartyContact('')
    }
  }

  const handleClearPartySelection = () => {
    setSelectedParty('')
    setPartyRisk(null)
  }

  const handleSalesItemSelect = (salesItemId: string) => {
    setCurrentItem((prev) => ({ ...prev, salesItemId }))
  }

  const handleTransportSelect = (transportId: string) => {
    setSelectedTransportId(transportId)
    const transport = transports.find((entry) => entry.id === transportId)
    if (transport) {
      setTransportName(transport.transporterName || '')
      setLorryNo(transport.vehicleNumber || '')
      return
    }

    setTransportName('')
  }

  const handleAddAdditionalChargeRow = () => {
    setAdditionalChargeBuckets((current) => [...current, createEmptyAdditionalChargeBucket()])
  }

  const handleAdditionalChargeRowChange = (
    bucketId: string,
    field: keyof Omit<SalesAdditionalChargeBucket, 'id'>,
    value: string
  ) => {
    setAdditionalChargeBuckets((current) =>
      current.map((bucket) =>
        bucket.id === bucketId
          ? {
              ...bucket,
              [field]: field === 'amount' ? toNonNegative(value) : value,
            }
          : bucket
      )
    )
  }

  const handleRemoveAdditionalChargeRow = (bucketId: string) => {
    setAdditionalChargeBuckets((current) => {
      const next = current.filter((bucket) => bucket.id !== bucketId)
      return next.length > 0 ? next : [createEmptyAdditionalChargeBucket()]
    })
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

  const handleAddNewTransport = () => {
    const targetPath = companyId
      ? `/master/transport?companyId=${encodeURIComponent(companyId)}`
      : '/master/transport'

    window.open(targetPath, '_blank', 'noopener,noreferrer')
  }

  const handleSendWhatsappReminder = useCallback(async () => {
    if (!selectedParty) {
      alert('Select a party first')
      return
    }

    const selectedPartyRecord = parties.find((party) => party.id === selectedParty)
    const risk = await fetchPartyRisk(selectedParty, 0)
    const phone = String(risk?.party?.phone1 || selectedPartyRecord?.phone1 || '').replace(/\D/g, '')
    if (!phone) {
      alert('Party mobile number is missing')
      return
    }

    const partyLabel = risk?.party?.name || selectedPartyRecord?.name || 'Customer'
    const outstandingAmount = roundCurrency(Number(risk?.outstandingAmount || 0))
    const message =
      `Dear ${partyLabel}, your outstanding amount is Rs. ${outstandingAmount.toFixed(2)}.` +
      ' Please arrange the pending payment at the earliest. Thank you.'
    if (!openWhatsappChat(phone, message)) {
      alert('Party mobile number is missing')
      return
    }
  }, [fetchPartyRisk, parties, selectedParty])

  const updateTotals = useCallback((items: SalesItem[]) => {
    const totalQty = items.length
    const totalBags = items.reduce((sum, item) => sum + (item.bags || 0), 0)
    const totalWeightValue = items.reduce((sum, item) => sum + (item.weight || 0), 0)
    const totalAmt = items.reduce((sum, item) => sum + (item.amount || 0), 0)

    setTotalProductItemQty(totalQty)
    setTotalNoOfBags(totalBags)
    setTotalWeight(totalWeightValue)
    setTotalAmount(totalAmt)
  }, [])

  const resetCurrentItemForm = useCallback(() => {
    setCurrentItem(createEmptyCurrentItem())
    setEditingItemId(null)
  }, [])

  const populateFromExistingBill = useCallback((
    bill: ExistingSalesBill,
    allSalesItems: SalesItemMasterOption[],
    allTransports: TransportOption[]
  ) => {
    setEditBillId(bill.id)
    setLoadedSplitSummary(bill.splitSummary || null)
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

    const firstTransport = Array.isArray(bill.transportBills) ? bill.transportBills[0] : undefined
    const transportLabel = String(firstTransport?.transportName || '')
    const matchedTransport = allTransports.find((transport) => String(transport.transporterName || '') === transportLabel)
    setSelectedTransportId(matchedTransport?.id || '')
    setTransportName(transportLabel)
    setLorryNo(String(firstTransport?.lorryNo || ''))
    setFreightPerQt(String(Math.max(0, Number(firstTransport?.freightPerQt || 0))))
    setFreightAmount(String(Math.max(0, Number(firstTransport?.freightAmount || 0))))
    setAdvance(String(Math.max(0, Number(firstTransport?.advance || 0))))
    setToPay(String(Math.max(0, Number(firstTransport?.toPay || 0))))

    const nextAdditionalCharges =
      Array.isArray(bill.additionalCharges) && bill.additionalCharges.length > 0
        ? bill.additionalCharges.map((charge) => ({
            id: String(charge.id || createEmptyAdditionalChargeBucket().id),
            chargeType: String(charge.chargeType || ''),
            amount: String(Math.max(0, Number(charge.amount || 0))),
            remark: String(charge.remark || '')
          }))
        : [
            ...(Math.max(0, Number(firstTransport?.otherAmount || 0)) > 0
              ? [{
                  id: createEmptyAdditionalChargeBucket().id,
                  chargeType: 'Other Amount',
                  amount: String(Math.max(0, Number(firstTransport?.otherAmount || 0))),
                  remark: ''
                }]
              : []),
            ...(Math.max(0, Number(firstTransport?.insuranceAmount || 0)) > 0
              ? [{
                  id: createEmptyAdditionalChargeBucket().id,
                  chargeType: 'Insurance',
                  amount: String(Math.max(0, Number(firstTransport?.insuranceAmount || 0))),
                  remark: ''
                }]
              : [])
          ]
    setAdditionalChargeBuckets(nextAdditionalCharges.length > 0 ? nextAdditionalCharges : createPermanentAdditionalChargeBuckets())

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
            gstRate: Math.max(0, Number(item.gstRateSnapshot || mappedMaster?.gstRate || 0)),
            gstAmount: Math.max(0, Number(item.gstAmount || 0)),
            lineTotal: Math.max(0, Number(item.lineTotal || item.amount || 0)),
            discount: 0
          }
        })
      : []

    itemIdSequence.current = mappedItems.length
    setCurrentFormItems(mappedItems)
    updateTotals(mappedItems)
    const loadedComputedGrandTotal = roundCurrency(
      mappedItems.reduce((sum, item) => sum + (item.amount || 0) + (item.gstAmount || 0), 0) +
      Math.max(0, Number(firstTransport?.advance || 0)) +
      (Array.isArray(bill.additionalCharges) && bill.additionalCharges.length > 0
        ? bill.additionalCharges.reduce((sum, charge) => sum + Math.max(0, Number(charge.amount || 0)), 0)
        : Math.max(0, Number(firstTransport?.otherAmount || 0)) + Math.max(0, Number(firstTransport?.insuranceAmount || 0)))
    )
    const storedGrandTotal = roundCurrency(Math.max(0, Number(bill.totalAmount || 0)))
    const hasStoredManualOverride = Math.abs(storedGrandTotal - loadedComputedGrandTotal) >= 0.01
    preserveLoadedManualGrandTotalRef.current = hasStoredManualOverride
    setManualGrandTotalTouched(false)
    setManualGrandTotal(hasStoredManualOverride ? String(storedGrandTotal) : '')
  }, [updateTotals])

  const fetchData = useCallback(async (forceFresh = false) => {
    try {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)

      if (!resolvedCompanyId) {
        alert('Company not selected')
        router.push('/main/profile')
        return
      }
      setCompanyId(resolvedCompanyId)

      const billIdFromQuery = new URLSearchParams(window.location.search).get('billId')?.trim() || ''
      if (!billIdFromQuery) {
        stripCompanyParamsFromUrl()
      }

      const payload = await loadClientCachedValue<SalesEntryCachePayload>(
        `sales-entry:${resolvedCompanyId}:${billIdFromQuery || 'new'}`,
        async () => {
          const [partiesRes, transportsRes, salesItemsRes, accountingHeadsRes, detailRes] = await Promise.all([
            fetch(`/api/parties?companyId=${resolvedCompanyId}`),
            fetch(`/api/transports?companyId=${resolvedCompanyId}`),
            fetch(`/api/sales-item-masters?companyId=${resolvedCompanyId}`),
            fetch(`/api/accounting-heads?companyId=${resolvedCompanyId}`),
            billIdFromQuery
              ? fetch(`/api/sales-bills?companyId=${resolvedCompanyId}&billId=${billIdFromQuery}`)
              : fetch(`/api/sales-bills?companyId=${resolvedCompanyId}&last=true`)
          ])

          if ([partiesRes, transportsRes, salesItemsRes, accountingHeadsRes].some((res) => res.status === 401 || res.status === 403)) {
            const authError = new Error('Session expired') as Error & { status?: number }
            authError.status = 401
            throw authError
          }

          const [partiesData, transportsData, salesItemsData, accountingHeadsData] = await Promise.all([
            parseApiJson<Party[]>(partiesRes, [], 'Parties API'),
            parseApiJson<TransportOption[]>(transportsRes, [], 'Transports API'),
            parseApiJson<SalesItemMasterOption[]>(salesItemsRes, [], 'Sales item masters API'),
            parseApiJson<AccountingHeadCharge[]>(accountingHeadsRes, [], 'Accounting heads API')
          ])

          const nextParties = Array.isArray(partiesData) ? partiesData : []
          const nextTransports = Array.isArray(transportsData) ? transportsData : []
          const nextSalesItems = Array.isArray(salesItemsData) ? salesItemsData : []
          const nextAccountingHeads = Array.isArray(accountingHeadsData) ? accountingHeadsData : []

          if (billIdFromQuery) {
            const existingBill = detailRes.ok
              ? await parseApiJson<ExistingSalesBill | null>(detailRes, null, 'Sales bill by id API')
              : null

            return {
              parties: nextParties,
              transports: nextTransports,
              salesItems: nextSalesItems,
              accountingHeads: nextAccountingHeads,
              existingBill,
              lastBillNumber: 0
            }
          }

          const billsData = detailRes.ok
            ? await parseApiJson<{ lastBillNumber?: number }>(detailRes, { lastBillNumber: 0 }, 'Sales bills API')
            : { lastBillNumber: 0 }

          return {
            parties: nextParties,
            transports: nextTransports,
            salesItems: nextSalesItems,
            accountingHeads: nextAccountingHeads,
            existingBill: null,
            lastBillNumber: Number(billsData.lastBillNumber || 0)
          }
        },
        { maxAgeMs: forceFresh ? 0 : SALES_ENTRY_CACHE_AGE_MS }
      )

      const nextParties = payload.parties
      const nextTransports = payload.transports
      const nextSalesItems = payload.salesItems
      const nextAccountingHeads = payload.accountingHeads

      setParties(nextParties)
      setTransports(nextTransports)
      setSalesItems(nextSalesItems)
      setAccountingHeads(nextAccountingHeads)

      if (billIdFromQuery) {
        const existingBill = payload.existingBill
        if (!existingBill?.id) {
          alert('Sales bill not found for editing.')
          router.push('/sales/list')
          return
        }

        populateFromExistingBill(existingBill, nextSalesItems, nextTransports)
        setLoading(false)
        return
      }

      const lastBillNum = Number(payload.lastBillNumber || 0)
      const nextInvoiceNumber = lastBillNum <= 0 ? 1 : lastBillNum + 1
      setInvoiceNo(nextInvoiceNumber.toString())

      setLoadedSplitSummary(null)
      setLoading(false)
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 401) {
        alert('Session expired. Please login again.')
        router.push('/login')
        return
      }
      console.error('Error fetching data:', error)
      setLoading(false)
    }
  }, [populateFromExistingBill, router])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const onCompanyChanged = () => {
      void fetchData()
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    return () => {
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [fetchData])

  const calculateItemTotals = () => {
    const noOfBags = parseFloat(currentItem.noOfBags) || 0
    const weightPerBag = parseFloat(currentItem.weightPerBag) || 0
    const enteredRate = parseFloat(currentItem.rate) || 0
    const enteredAmount = parseFloat(currentItem.amount) || 0

    // Mandi calculations: Weight in kg, then convert to Qt (100kg = 1Qt)
    const totalWeightKg = noOfBags * weightPerBag
    const totalWeightQt = totalWeightKg / 100

    if (currentItem.pricingMode === 'amount') {
      const effectiveRate = totalWeightQt > 0 ? enteredAmount / totalWeightQt : 0
      return {
        totalWeight: totalWeightQt,
        rate: effectiveRate,
        amount: enteredAmount
      }
    }

    return {
      totalWeight: totalWeightQt,
      rate: enteredRate,
      amount: totalWeightQt * enteredRate
    }
  }

  const handleSaveItem = () => {
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
    

    if (salesItems.length === 0) {
      alert('No Sales Item Master found. Please add sales items in Master > Sales Item.')
      return
    }

    const salesItem = salesItems.find((s) => s.id === currentItem.salesItemId)
    const { totalWeight, amount, rate } = calculateItemTotals()
    const bags = parseFloat(currentItem.noOfBags) || 0

    if (totalWeight <= 0) {
      alert('Total weight must be greater than 0')
      return
    }

    

    
    

    const gstRate = Math.max(0, Number(salesItem?.gstRate || 0))
    const tax = calculateTaxBreakdown(amount || 0, gstRate)

    const nextItem: SalesItem = {
      id: editingItemId || `item-${++itemIdSequence.current}`,
      salesItemId: salesItem?.id || '',
      salesItemName: salesItem?.salesItemName || salesItem?.product?.name || '',
      productName: salesItem?.product?.name || '',
      productId: salesItem?.productId || '',
      weight: totalWeight || 0,
      bags,
      rate,
      amount: amount || 0,
      gstRate: tax.gstRate,
      gstAmount: tax.gstAmount,
      lineTotal: tax.lineTotal,
      discount: 0 // Default discount to 0
    }

    if (!nextItem.productId) {
      alert('Invalid product selection. Please select a valid sales item from the dropdown.')
      return
    }

    const updatedItems = editingItemId
      ? currentFormItems.map((item) => (item.id === editingItemId ? nextItem : item))
      : [...currentFormItems, nextItem]

    setCurrentFormItems(updatedItems)
    updateTotals(updatedItems)
    resetCurrentItemForm()
  }

  const handleRemoveItem = (id: string) => {
    const updatedItems = currentFormItems.filter(item => item.id !== id)
    setCurrentFormItems(updatedItems)
    updateTotals(updatedItems)
    if (editingItemId === id) {
      resetCurrentItemForm()
    }
  }

  const handleClearItems = () => {
    setCurrentFormItems([])
    updateTotals([])
    resetCurrentItemForm()
  }

  const handleEditItem = (item: SalesItem) => {
    const matchedSalesItem = salesItems.find((entry) => entry.id === item.salesItemId || entry.productId === item.productId)
    const computedWeightPerBag = item.bags > 0 ? (item.weight * 100) / item.bags : 0
    const nextPricingMode: ItemPricingMode = item.rate > 0 ? 'rate' : 'amount'

    setEditingItemId(item.id)
    setCurrentItem({
      salesItemId: matchedSalesItem?.id || item.salesItemId || '',
      noOfBags: item.bags ? String(item.bags) : '',
      weightPerBag: computedWeightPerBag > 0 ? computedWeightPerBag.toFixed(2) : '',
      rate: nextPricingMode === 'rate' ? String(item.rate || '') : '',
      amount: nextPricingMode === 'amount' ? String(item.amount || '') : '',
      pricingMode: nextPricingMode
    })
  }

  const saveSalesBill = useCallback(async (requestData: Record<string, unknown>) => {
    try {
      setSubmitting(true)

      const response = await fetch('/api/sales-bills', {
        method: isEditMode ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      })

      const responseText = await response.text()
      let parsedResponse: SalesBillSaveResponse = {}
      try {
        parsedResponse = responseText ? (JSON.parse(responseText) as SalesBillSaveResponse & { creditRisk?: PartyRiskResponse }) : {}
      } catch {
        parsedResponse = {}
      }

      if (response.ok) {
        const resolvedId = parsedResponse?.salesBillId || parsedResponse?.salesBill?.id || editBillId
        if (companyId) {
          invalidateAppDataCaches(companyId, ['sales-bills'])
          notifyAppDataChanged({ companyId, scopes: ['sales-bills'] })
        }
        alert(isEditMode ? 'Sales bill updated successfully!' : 'Sales bill created successfully!')
        if (resolvedId) {
          const printPath = companyId
            ? `/sales/${resolvedId}/print?type=invoice&companyId=${encodeURIComponent(companyId)}`
            : `/sales/${resolvedId}/print?type=invoice`
          router.push(printPath)
        } else {
          router.push('/sales/list')
        }
        return
      }

      if (response.status === 409 && 'creditRisk' in parsedResponse && parsedResponse.creditRisk) {
        setPartyRisk(parsedResponse.creditRisk)
        setPendingRequestData(requestData)
        setRiskDialogOpen(true)
        return
      }

      const errorMessage =
        parsedResponse?.error ||
        parsedResponse?.message ||
        response.statusText ||
        'Unknown error'
      alert(`Error saving sales bill: ${errorMessage}`)
    } catch (error) {
      console.error('Error:', error)
      alert('Error saving sales bill')
    } finally {
      setSubmitting(false)
    }
  }, [companyId, editBillId, isEditMode, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

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

    const sanitizedItems = currentFormItems
      .map((item) => ({
        ...item,
        bags: Math.max(0, Number(item.bags || 0)),
        weight: Math.max(0, Number(item.weight || 0)),
        rate: Math.max(0, Number(item.rate || 0)),
        amount: Math.max(0, Number(item.amount || 0))
      }))
      .filter((item) => item.productId && item.weight > 0)

    if (sanitizedItems.length === 0) {
      alert('At least one sales item with weight greater than 0 is required')
      return
    }

    const freight = parseFloat(freightAmount) || 0
    const adv = parseFloat(advance) || 0
    if (adv > freight) {
      setAdvanceError('Advance amount cannot be greater than freight amount')
      return
    }

    if (!companyId) {
      alert('Company ID is missing')
      return
    }

    const salesBillItems = sanitizedItems.map((item) => ({
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
        otherAmount: extraChargesSummary.otherAmount,
        insuranceAmount: extraChargesSummary.insuranceAmount,
        additionalCharges: normalizedAdditionalCharges,
      }
    }

    if (isEditMode) {
      requestData.id = editBillId
    } else {
      requestData.status = 'unpaid'
    }

    const risk = await fetchPartyRisk(selectedParty, finalTotalAmount)
    if (risk && (risk.hasOverdue || risk.isOverLimit)) {
      setPartyRisk(risk)
      setPendingRequestData(requestData)
      setRiskDialogOpen(true)
      return
    }

    await saveSalesBill(requestData)
  }

  if (loading) {
    return (
      <AppLoaderShell
        kind="sales"
        companyId={companyId}
        fullscreen
        title="Preparing sales entry"
        message="Loading parties, sales items, transport choices, and invoice totals."
      />
    )
  }

  const itemTotals = calculateItemTotals()
  const displayedRate =
    currentItem.pricingMode === 'amount'
      ? itemTotals.rate > 0
        ? itemTotals.rate.toFixed(2)
        : ''
      : currentItem.rate
  const displayedAmount =
    currentItem.pricingMode === 'rate'
      ? currentItem.rate || currentItem.noOfBags || currentItem.weightPerBag
        ? itemTotals.amount.toFixed(2)
        : ''
      : currentItem.amount
  const previewTax = calculateTaxBreakdown(itemTotals.amount || 0, selectedCurrentSalesItem?.gstRate || 0)
  const itemAmountHint =
    currentItem.pricingMode === 'amount' && itemTotals.totalWeight > 0
      ? `Average rate auto-calculated: ₹${itemTotals.rate.toFixed(2)} / Qt`
      : currentItem.pricingMode === 'rate' && itemTotals.totalWeight > 0
        ? `Amount auto-calculated from ${itemTotals.totalWeight.toFixed(2)} Qt`
        : 'Enter either Rate / Qt or Amount. The other value will auto-calculate.'
  const outstandingAmount = roundCurrency(Number(partyRisk?.outstandingAmount || 0))
  const overdueAmount = roundCurrency(Number(partyRisk?.overdueAmount || 0))
  const creditLimit = partyRisk?.party?.creditLimit ?? selectedPartyRecord?.creditLimit ?? null
  const remainingLimit =
    typeof partyRisk?.remainingLimit === 'number'
      ? roundCurrency(partyRisk.remainingLimit)
      : typeof creditLimit === 'number'
        ? roundCurrency(creditLimit - outstandingAmount)
        : null
  const hasRisk = Boolean(partyRisk?.hasOverdue || partyRisk?.isOverLimit)
  const isSplitManagedBill = Boolean(
    loadedSplitSummary && String(loadedSplitSummary.invoiceKind || 'regular') !== 'regular'
  )

  const handleRiskContinue = async () => {
    if (!pendingRequestData) {
      setRiskDialogOpen(false)
      return
    }
    setRiskDialogOpen(false)
    const requestData = {
      ...pendingRequestData,
      allowRiskOverride: true,
    }
    setPendingRequestData(null)
    await saveSalesBill(requestData)
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-2xl font-bold">{isEditMode ? 'Edit Sales Bill' : 'Sales Entry'}</CardTitle>
                {isEditMode ? (
                  <Button type="button" variant="outline" onClick={() => setSplitDialogOpen(true)}>
                    <SplitSquareVertical className="mr-2 h-4 w-4" />
                    Split Invoice
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                {isSplitManagedBill ? (
                  <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p className="font-semibold">This invoice is already managed through the split workflow.</p>
                    <p className="mt-1">
                      Direct sales-entry updates are disabled for split parents and split child invoices. Use `Split Invoice`
                      to edit parts, add new suffixes, or merge back safely.
                    </p>
                  </div>
                ) : null}
                {/* Section 1 - Basic Info */}
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 pb-2 border-b">1. Basic Info</h3>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-3">
                        <Label htmlFor="invoiceNo">Invoice No. (Auto-generated)</Label>
                        <Input 
                          id="invoiceNo" 
                          value={invoiceNo}
                          placeholder="Generating invoice number"
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
                          <div className="flex flex-col gap-2 xl:flex-row">
                            <div className="flex-1">
                              <SearchableSelect
                                id="party"
                                value={selectedParty}
                                onValueChange={handlePartySelect}
                                options={partyOptions}
                                placeholder="Search and select party"
                                searchPlaceholder="Search party name, address, or phone..."
                                emptyText="No parties found."
                              />
                            </div>
                            {selectedParty ? (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleClearPartySelection}
                              >
                                Manual Entry
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void handleSendWhatsappReminder()}
                              disabled={!selectedParty}
                              className="gap-2 xl:w-auto"
                            >
                              <MessageCircle className="h-4 w-4" />
                              WhatsApp Reminder
                            </Button>
                          </div>
                          <p className="text-xs text-slate-500">
                            Existing parties search se select karein. Naya party banana ho to manual fields fill karke `Add Party` use karein.
                          </p>
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
                    {selectedParty ? (
                      <div
                        className={`rounded-xl border px-4 py-3 ${
                          hasRisk
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-emerald-200 bg-emerald-50'
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              {hasRisk ? (
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              ) : null}
                              <p className="text-sm font-semibold text-slate-900">
                                {hasRisk ? 'Buyer risk alert' : 'Buyer credit status'}
                              </p>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {hasRisk
                                ? 'This party has overdue or limit pressure. Review before confirming the sale.'
                                : 'Outstanding and credit position look within the configured limit right now.'}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm lg:min-w-[420px] lg:grid-cols-4">
                            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
                              <p className="text-xs text-slate-500">Outstanding</p>
                              <p className="font-semibold text-slate-900">₹{outstandingAmount.toFixed(2)}</p>
                            </div>
                            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
                              <p className="text-xs text-slate-500">Overdue</p>
                              <p className={`font-semibold ${overdueAmount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                                ₹{overdueAmount.toFixed(2)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
                              <p className="text-xs text-slate-500">Credit Limit</p>
                              <p className="font-semibold text-slate-900">
                                {typeof creditLimit === 'number' ? `₹${roundCurrency(creditLimit).toFixed(2)}` : 'Not set'}
                              </p>
                            </div>
                            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2">
                              <p className="text-xs text-slate-500">Remaining</p>
                              <p className={`font-semibold ${typeof remainingLimit === 'number' && remainingLimit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {formatRemainingLimitText(remainingLimit)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <span>
                          Mandi Type:
                          <span className="ml-2 font-semibold text-slate-900">
                            {selectedPartyRecord?.mandiTypeName || 'No mandi type linked'}
                          </span>
                        </span>
                        <span className="text-slate-500">
                          Matching mandi charges: {mandiChargePreview.lines.length}
                        </span>
                      </div>
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
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <SearchableSelect
                                id="transportName"
                                value={selectedTransportId}
                                onValueChange={handleTransportSelect}
                                options={transportOptions}
                                placeholder="Search and select transport"
                                searchPlaceholder="Search transport name or vehicle..."
                                emptyText="No transport found."
                              />
                            </div>
                            {selectedTransportId ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedTransportId('')
                                  setTransportName('')
                                }}
                              >
                                Clear
                              </Button>
                            ) : null}
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
                          <p className="text-xs text-slate-500">
                            Transport master se select karne par name auto-fill hota hai. Lorry number aap yahan adjust kar sakte hain.
                          </p>
                          {selectedTransportRecord?.vehicleNumber ? (
                            <p className="text-xs text-slate-500">
                              Master vehicle: {selectedTransportRecord.vehicleNumber}
                            </p>
                          ) : null}
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
                      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="font-semibold">{editingItemId ? 'Edit Item' : 'Add Item'}</h3>
                        {editingItemId ? (
                          <p className="text-sm text-slate-500">Update the selected row and save it back into the bill.</p>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
                        <div className="lg:col-span-2">
                          <Label htmlFor="itemProduct">Sales Items</Label>
                          <SearchableSelect
                            id="itemProduct"
                            value={currentItem.salesItemId}
                            onValueChange={handleSalesItemSelect}
                            options={salesItemOptions}
                            placeholder="Search and select sales item"
                            searchPlaceholder="Search sales item or product..."
                            emptyText="No sales items found."
                          />
                          {salesItems.length === 0 ? (
                            <p className="mt-1 text-xs text-gray-500">
                              Add entries in Master &gt; Sales Item to continue.
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-500">
                              Search by sales item name or product name.
                            </p>
                          )}
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
                            Rate / Qt
                          </Label>
                          <Input
                            id="itemRate"
                            type="number"
                            min="0"
                            step="0.01"
                            value={displayedRate}
                            onChange={(e) => setCurrentItem({
                              ...currentItem,
                              rate: toNonNegative(e.target.value),
                              amount: '',
                              pricingMode: 'rate'
                            })}
                            placeholder="Enter rate or use amount"
                          />
                        </div>
                        <div>
                          <Label>Total Weight (Qt.)</Label>
                          <Input
                            value={itemTotals.totalWeight.toFixed(2)}
                            readOnly
                            className="bg-gray-100"
                          />
                        </div>
                        <div>
                          <Label>Amount</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={displayedAmount}
                            onChange={(e) => setCurrentItem({
                              ...currentItem,
                              rate: '',
                              amount: toNonNegative(e.target.value),
                              pricingMode: 'amount'
                            })}
                            placeholder="Enter amount or use rate"
                          />
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">{itemAmountHint}</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="rounded-lg border bg-slate-50 px-3 py-2">
                          <p className="text-xs text-slate-500">Product GST</p>
                          <p className="font-medium text-slate-900">
                            {previewTax.gstRate > 0 ? `${previewTax.gstRate.toFixed(2)}% GST` : 'Non-GST / tax-free'}
                          </p>
                        </div>
                        <div className="rounded-lg border bg-slate-50 px-3 py-2">
                          <p className="text-xs text-slate-500">GST on current line</p>
                          <p className="font-medium text-slate-900">₹{previewTax.gstAmount.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg border bg-slate-50 px-3 py-2">
                          <p className="text-xs text-slate-500">Line total preview</p>
                          <p className="font-medium text-slate-900">₹{previewTax.lineTotal.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button type="button" onClick={handleSaveItem}>
                          {editingItemId ? 'Update Item' : 'Add'}
                        </Button>
                        <Button type="button" variant="outline" onClick={resetCurrentItemForm}>
                          {editingItemId ? 'Cancel Edit' : 'Clear Form'}
                        </Button>
                        {currentFormItems.length > 0 ? (
                          <Button type="button" variant="outline" onClick={handleClearItems}>
                            Clear All Items
                          </Button>
                        ) : null}
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
                                <th className="text-right p-2">GST</th>
                                <th className="text-right p-2">Line Total</th>
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
                                  <td className="p-2 text-right">
                                    <div className="flex flex-col items-end">
                                      <span>{(item.gstAmount || 0).toFixed(2)}</span>
                                      <span className="text-xs text-slate-500">{(item.gstRate || 0).toFixed(2)}%</span>
                                    </div>
                                  </td>
                                  <td className="p-2 text-right font-medium">{(item.lineTotal || 0).toFixed(2)}</td>
                                  <td className="p-2 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleEditItem(item)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRemoveItem(item.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
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
                  <div className="grid grid-cols-1 gap-4">
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <Button type="button" variant="outline" onClick={handleAddAdditionalChargeRow}>
                          Add Charge
                        </Button>
                      </div>

                      <div className="mt-4 space-y-3">
                        {additionalChargeBuckets.map((bucket, index) => (
                          <div
                            key={bucket.id}
                            className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1.3fr_0.8fr_1.3fr_auto]"
                          >
                            <div>
                              <Label htmlFor={`additional-charge-type-${bucket.id}`}>Type</Label>
                              <SearchableSelect
                                id={`additional-charge-type-${bucket.id}`}
                                value={bucket.chargeType}
                                onValueChange={(value) => handleAdditionalChargeRowChange(bucket.id, 'chargeType', value)}
                                options={additionalChargeTypeOptions}
                                placeholder="Search charge type"
                                searchPlaceholder="Search charge type..."
                                emptyText="No charge type found."
                              />
                            </div>
                            <div>
                              <Label htmlFor={`additional-charge-amount-${bucket.id}`}>Amount</Label>
                              <Input
                                id={`additional-charge-amount-${bucket.id}`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={bucket.amount}
                                onChange={(e) => handleAdditionalChargeRowChange(bucket.id, 'amount', e.target.value)}
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`additional-charge-remark-${bucket.id}`}>Remark</Label>
                              <Input
                                id={`additional-charge-remark-${bucket.id}`}
                                value={bucket.remark}
                                onChange={(e) => handleAdditionalChargeRowChange(bucket.id, 'remark', e.target.value)}
                                placeholder="Enter remark"
                              />
                            </div>
                            <div className="flex items-end justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleRemoveAdditionalChargeRow(bucket.id)}
                                disabled={additionalChargeBuckets.length === 1 && index === 0 && !bucket.chargeType && !bucket.amount && !bucket.remark}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {normalizedAdditionalCharges.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-900">Charge Preview</p>
                          <div className="mt-2 space-y-2 text-sm text-slate-600">
                            {normalizedAdditionalCharges.map((charge, index) => (
                              <div key={`${charge.chargeType}-${index}`} className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{charge.chargeType}</p>
                                  {charge.remark ? (
                                    <p className="truncate text-xs text-slate-500">{charge.remark}</p>
                                  ) : null}
                                </div>
                                <span className="font-semibold text-slate-900">₹{charge.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    
                  </div>
                </div>

                {/* Section 5 - Totals */}
                <div className="mt-3">
                  <h3 className="text-lg font-semibold mb-2 pb-2 border-b">5. Totals</h3>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
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
                    <div className="text-center p-2 bg-orange-50 rounded-lg border border-orange-200">
                      <Label className="text-xs text-gray-600 block">GST Total</Label>
                      <p className="text-lg font-bold text-orange-600">₹{totalGstAmount.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                      <Label className="text-xs text-gray-600 block">Grand Total</Label>
                      <p className="text-lg font-bold text-emerald-700">₹{grandTotal.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border bg-slate-50 p-4">
                      <p className="text-sm font-medium text-slate-900">Grand total calculation</p>
                      <div className="mt-3 space-y-2 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span>Item subtotal</span>
                          <span>₹{totalAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>GST total</span>
                          <span>₹{totalGstAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Freight Advance</span>
                          <span>₹{freightAdvanceTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Additional charges</span>
                          <span>₹{extraChargesTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Mandi charges</span>
                          <span>₹{mandiChargePreview.totalChargeAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                          <span>Calculated total</span>
                          <span>₹{computedGrandTotalWithMandi.toFixed(2)}</span>
                        </div>
                      </div>
                      {mandiChargePreview.lines.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-900">Bottom of Bill - Mandi Charges</p>
                          <div className="mt-2 space-y-2 text-sm text-slate-600">
                            {mandiChargePreview.lines.map((line) => (
                              <div key={line.accountingHeadId} className="flex items-center justify-between">
                                <span>
                                  {line.name} ({getCalculationBasisLabel(line.calculationBasis)} @ {line.basisValue.toFixed(2)})
                                </span>
                                <span className="font-medium text-slate-900">₹{line.chargeAmount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-xl border p-4">
                      <Label htmlFor="manualGrandTotal">Final Invoice Total</Label>
                      <Input
                        id="manualGrandTotal"
                        type="number"
                        min="0"
                        step="0.01"
                        value={manualGrandTotal}
                        onChange={(e) => {
                          const nextValue = toNonNegative(e.target.value)
                          setManualGrandTotal(nextValue)
                          setManualGrandTotalTouched(nextValue !== '')
                        }}
                        placeholder={computedGrandTotalWithMandi.toFixed(2)}
                        className="mt-2"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Leave blank to use the calculated total automatically. Enter a value here only when the final invoice total needs a manual override.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        onClick={() => {
                          setManualGrandTotal('')
                          setManualGrandTotalTouched(false)
                        }}
                        disabled={manualGrandTotal === ''}
                      >
                        Reset to Calculated Total
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Submit Buttons */}
                <div className="flex justify-between items-center">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || isSplitManagedBill}>
                    {submitting ? 'Saving...' : isEditMode ? 'Update Sales Bill' : 'Save Sales Bill'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buyer limit warning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This sale pushes the selected party into a risky position. Review the outstanding figures before you continue.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Outstanding</p>
                <p className="font-semibold text-slate-900">₹{outstandingAmount.toFixed(2)}</p>
              </div>
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Overdue</p>
                <p className="font-semibold text-amber-700">₹{overdueAmount.toFixed(2)}</p>
              </div>
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Credit Limit</p>
                <p className="font-semibold text-slate-900">
                  {typeof creditLimit === 'number' ? `₹${roundCurrency(creditLimit).toFixed(2)}` : 'Not set'}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Remaining Limit</p>
                <p className={`font-semibold ${typeof remainingLimit === 'number' && remainingLimit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {formatRemainingLimitText(remainingLimit)}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Pending Sale</p>
                <p className="font-semibold text-slate-900">₹{roundCurrency(Number(partyRisk?.pendingSaleAmount || grandTotal)).toFixed(2)}</p>
              </div>
              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Projected Outstanding</p>
                <p className="font-semibold text-slate-900">₹{roundCurrency(Number(partyRisk?.projectedOutstanding || 0)).toFixed(2)}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRiskDialogOpen(false)}>
              Review Sale
            </Button>
            <Button type="button" onClick={() => void handleRiskContinue()}>
              Save Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isEditMode && companyId && editBillId ? (
        <SalesInvoiceSplitDialog
          open={splitDialogOpen}
          onOpenChange={setSplitDialogOpen}
          companyId={companyId}
          billId={editBillId}
          expectedParentUpdatedAt={null}
          onSaved={() => {
            invalidateAppDataCaches(companyId, ['sales-bills'])
            notifyAppDataChanged({ companyId, scopes: ['sales-bills'] })
            void fetchData(true)
          }}
        />
      ) : null}
    </DashboardLayout>
    )
  }
