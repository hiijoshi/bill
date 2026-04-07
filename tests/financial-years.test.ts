import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildFinancialYearLabel,
  getFinancialYearWindowForDate,
  getFinancialYearWindowFromStartYear,
  isDateWithinFinancialYear
} from '../lib/financial-years'
import {
  formatFinancialYearDateInput,
  getFinancialYearDateRangeInput
} from '../lib/client-financial-years'

test('buildFinancialYearLabel formats Indian financial year labels', () => {
  assert.equal(buildFinancialYearLabel(2025), 'FY 2025-26')
  assert.equal(buildFinancialYearLabel(2026), 'FY 2026-27')
})

test('getFinancialYearWindowFromStartYear returns 1 April to 31 March boundaries', () => {
  const window = getFinancialYearWindowFromStartYear(2025)

  assert.equal(window.startYear, 2025)
  assert.equal(window.endYear, 2026)
  assert.equal(window.label, 'FY 2025-26')
  assert.equal(window.startDate.getFullYear(), 2025)
  assert.equal(window.startDate.getMonth(), 3)
  assert.equal(window.startDate.getDate(), 1)
  assert.equal(window.startDate.getHours(), 0)
  assert.equal(window.startDate.getMinutes(), 0)
  assert.equal(window.endDate.getFullYear(), 2026)
  assert.equal(window.endDate.getMonth(), 2)
  assert.equal(window.endDate.getDate(), 31)
  assert.equal(window.endDate.getHours(), 23)
  assert.equal(window.endDate.getMinutes(), 59)
})

test('getFinancialYearWindowForDate maps dates before and after 1 April correctly', () => {
  const marchWindow = getFinancialYearWindowForDate(new Date(2026, 2, 31, 12, 0, 0, 0))
  const aprilWindow = getFinancialYearWindowForDate(new Date(2026, 3, 1, 0, 0, 0, 0))

  assert.equal(marchWindow.label, 'FY 2025-26')
  assert.equal(marchWindow.startYear, 2025)
  assert.equal(aprilWindow.label, 'FY 2026-27')
  assert.equal(aprilWindow.startYear, 2026)
})

test('isDateWithinFinancialYear includes both start and end boundaries', () => {
  const window = getFinancialYearWindowFromStartYear(2025)

  assert.equal(
    isDateWithinFinancialYear(window.startDate, {
      startDate: window.startDate,
      endDate: window.endDate
    }),
    true
  )
  assert.equal(
    isDateWithinFinancialYear(window.endDate, {
      startDate: window.startDate,
      endDate: window.endDate
    }),
    true
  )
  assert.equal(
    isDateWithinFinancialYear(new Date(2025, 2, 31, 23, 59, 59, 999), {
      startDate: window.startDate,
      endDate: window.endDate
    }),
    false
  )
  assert.equal(
    isDateWithinFinancialYear(new Date(2026, 3, 1, 0, 0, 0, 0), {
      startDate: window.startDate,
      endDate: window.endDate
    }),
    false
  )
})

test('client helpers format date inputs and expose FY date ranges', () => {
  assert.equal(formatFinancialYearDateInput(new Date(2025, 3, 1, 10, 20, 30, 0)), '2025-04-01')
  assert.equal(formatFinancialYearDateInput('2026-03-31T09:30:00.000Z'), '2026-03-31')

  assert.deepEqual(
    getFinancialYearDateRangeInput({
      startDate: '2025-04-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z'
    }),
    {
      dateFrom: '2025-04-01',
      dateTo: '2026-03-31'
    }
  )
})
