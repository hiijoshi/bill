import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCandidateName,
  resolveQuickCreateTargetType,
  uniqueNameFromExisting
} from '@/lib/bank-statements/services/quick-create-utils'

test('normalizeCandidateName prefers explicit preferredName', () => {
  const name = normalizeCandidateName({
    preferredName: '  Acme Traders  ',
    description: 'UPI PAYMENT TXN 1234',
    referenceNumber: 'REF01'
  })

  assert.equal(name, 'Acme Traders')
})

test('normalizeCandidateName falls back to cleaned description', () => {
  const name = normalizeCandidateName({
    description: 'UPI / IMPS PAYMENT TO AMAZON WEB SERVICES',
    referenceNumber: null
  })

  assert.equal(name, 'PAYMENT TO AMAZON WEB SERVICES')
})

test('resolveQuickCreateTargetType respects explicit target', () => {
  const type = resolveQuickCreateTargetType({
    requestedType: 'supplier',
    direction: 'credit',
    description: 'salary transfer'
  })

  assert.equal(type, 'supplier')
})

test('resolveQuickCreateTargetType defaults by narration and direction', () => {
  assert.equal(
    resolveQuickCreateTargetType({
      requestedType: 'auto',
      direction: 'debit',
      description: 'Monthly salary payout'
    }),
    'accounting_head'
  )

  assert.equal(
    resolveQuickCreateTargetType({
      requestedType: 'auto',
      direction: 'credit',
      description: 'NEFT inward receipt from customer'
    }),
    'party'
  )
})

test('uniqueNameFromExisting appends suffix when duplicate exists', () => {
  const name = uniqueNameFromExisting('TATA Power', ['Amazon', 'tata power', 'TATA Power (2)'])
  assert.equal(name, 'TATA Power (3)')
})
