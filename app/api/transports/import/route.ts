import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone, parseNonNegativeNumber } from '@/lib/field-validation'
import { getCsvValue, parseCsvBoolean, parseCsvObjects } from '@/lib/master-csv'
import { resolveCompanyIdFromRequest } from '@/lib/request-company'

const getTransportKey = (transporterName: string, vehicleNumber: string) => {
  const vehicleKey = vehicleNumber.trim().toUpperCase()
  if (vehicleKey) return `vehicle:${vehicleKey}`
  return `name:${transporterName.trim().toLowerCase()}`
}

export async function POST(request: NextRequest) {
  try {
    const companyId = resolveCompanyIdFromRequest(request)
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }

    const rows = parseCsvObjects(await file.text())
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Uploaded CSV is empty' }, { status: 400 })
    }

    const existingTransports = await prisma.transport.findMany({
      where: { companyId },
      select: {
        id: true,
        transporterName: true,
        vehicleNumber: true
      }
    })
    const existingMap = new Map(
      existingTransports.map((transport) => [
        getTransportKey(transport.transporterName || '', transport.vehicleNumber || ''),
        transport.id
      ])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2
      const transporterName = getCsvValue(row, ['Transporter', 'TransporterName', 'Transport Name'])
      const vehicleNumber = getCsvValue(row, ['VehicleNumber', 'Vehicle Number']).toUpperCase()

      if (!transporterName) {
        skipped += 1
        continue
      }

      const driverPhoneRaw = getCsvValue(row, ['DriverPhone', 'Driver Phone'])
      const driverPhone = driverPhoneRaw ? normalizeTenDigitPhone(driverPhoneRaw) : null
      if (driverPhoneRaw && !driverPhone) {
        errorDetails.push(`Row ${rowNumber}: Driver phone must be exactly 10 digits for transporter "${transporterName}"`)
        continue
      }

      const capacityRaw = getCsvValue(row, ['Capacity'])
      const freightRateRaw = getCsvValue(row, ['FreightRate', 'Freight Rate'])
      const capacity = parseNonNegativeNumber(capacityRaw)
      const freightRate = parseNonNegativeNumber(freightRateRaw)

      if (capacityRaw && capacity === null) {
        errorDetails.push(`Row ${rowNumber}: Capacity must be a non-negative number for transporter "${transporterName}"`)
        continue
      }

      if (freightRateRaw && freightRate === null) {
        errorDetails.push(`Row ${rowNumber}: Freight rate must be a non-negative number for transporter "${transporterName}"`)
        continue
      }

      const data = {
        companyId,
        transporterName,
        vehicleNumber: cleanString(vehicleNumber),
        driverName: cleanString(getCsvValue(row, ['DriverName', 'Driver Name'])),
        driverPhone,
        vehicleType: cleanString(getCsvValue(row, ['VehicleType', 'Vehicle Type'])),
        description: cleanString(getCsvValue(row, ['Description'])),
        capacity,
        freightRate,
        isActive: parseCsvBoolean(getCsvValue(row, ['Active', 'Status']), true)
      }

      const key = getTransportKey(transporterName, vehicleNumber)
      const existingId = existingMap.get(key)
      if (existingId) {
        await prisma.transport.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.transport.create({ data })
        existingMap.set(key, created.id)
        imported += 1
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      updated,
      skipped,
      errors: errorDetails.length,
      errorDetails
    })
  } catch (error) {
    console.error('Error importing transports:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

