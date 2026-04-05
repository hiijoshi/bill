'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { authHeadersScoped } from '@/lib/csrf'
import { KNOWN_SUBSCRIPTION_FEATURES } from '@/lib/subscription-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type PlanFeature = {
  featureKey: string
  featureLabel: string
  description: string | null
  enabled: boolean
  sortOrder: number
}

type PlanRecord = {
  id: string
  name: string
  description: string | null
  billingCycle: string
  amount: number
  currency: string
  maxCompanies: number | null
  maxUsers: number | null
  defaultTrialDays: number | null
  isActive: boolean
  isTrialCapable: boolean
  sortOrder: number
  subscriptionCount: number
  features: PlanFeature[]
}

type PlanFormState = {
  name: string
  description: string
  amount: string
  currency: string
  billingCycle: string
  maxCompanies: string
  maxUsers: string
  defaultTrialDays: string
  sortOrder: string
  isActive: boolean
  isTrialCapable: boolean
  features: PlanFeature[]
}

function createEmptyForm(): PlanFormState {
  return {
    name: '',
    description: '',
    amount: '0',
    currency: 'INR',
    billingCycle: 'yearly',
    maxCompanies: '',
    maxUsers: '',
    defaultTrialDays: '',
    sortOrder: '0',
    isActive: true,
    isTrialCapable: false,
    features: KNOWN_SUBSCRIPTION_FEATURES.map((feature, index) => ({
      featureKey: feature.key,
      featureLabel: feature.label,
      description: feature.description,
      enabled: true,
      sortOrder: index
    }))
  }
}

function toPayload(form: PlanFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    amount: Number(form.amount || 0),
    currency: form.currency.trim() || 'INR',
    billingCycle: form.billingCycle,
    maxCompanies: form.maxCompanies.trim() === '' ? null : Number(form.maxCompanies),
    maxUsers: form.maxUsers.trim() === '' ? null : Number(form.maxUsers),
    defaultTrialDays: form.defaultTrialDays.trim() === '' ? null : Number(form.defaultTrialDays),
    sortOrder: form.sortOrder.trim() === '' ? 0 : Number(form.sortOrder),
    isActive: form.isActive,
    isTrialCapable: form.isTrialCapable,
    features: form.features.map((feature) => ({
      featureKey: feature.featureKey,
      featureLabel: feature.featureLabel,
      description: feature.description,
      enabled: feature.enabled,
      sortOrder: feature.sortOrder
    }))
  }
}

export default function SuperAdminSubscriptionPlansPage() {
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<PlanFormState>(createEmptyForm())

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/super-admin/subscription-plans?includeInactive=true', { cache: 'no-store' })
      const payload = (await response.json().catch(() => [])) as PlanRecord[] | { error?: string }
      if (!response.ok) {
        throw new Error(Array.isArray(payload) ? 'Failed to load plans' : payload.error || 'Failed to load plans')
      }
      setPlans(Array.isArray(payload) ? payload : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const activeFeatureCount = useMemo(
    () => form.features.filter((feature) => feature.enabled).length,
    [form.features]
  )

  const resetForm = () => {
    setEditId(null)
    setForm(createEmptyForm())
  }

  const startEdit = (plan: PlanRecord) => {
    setEditId(plan.id)
    setForm({
      name: plan.name,
      description: plan.description || '',
      amount: String(plan.amount),
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      maxCompanies: plan.maxCompanies === null ? '' : String(plan.maxCompanies),
      maxUsers: plan.maxUsers === null ? '' : String(plan.maxUsers),
      defaultTrialDays: plan.defaultTrialDays === null ? '' : String(plan.defaultTrialDays),
      sortOrder: String(plan.sortOrder),
      isActive: plan.isActive,
      isTrialCapable: plan.isTrialCapable,
      features: KNOWN_SUBSCRIPTION_FEATURES.map((feature, index) => {
        const existing = plan.features.find((row) => row.featureKey === feature.key)
        return {
          featureKey: feature.key,
          featureLabel: existing?.featureLabel || feature.label,
          description: existing?.description || feature.description,
          enabled: existing?.enabled ?? false,
          sortOrder: existing?.sortOrder ?? index
        }
      })
    })
  }

  const savePlan = async () => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(
        editId ? `/api/super-admin/subscription-plans/${editId}` : '/api/super-admin/subscription-plans',
        {
          method: editId ? 'PUT' : 'POST',
          headers: authHeadersScoped('super_admin'),
          body: JSON.stringify(toPayload(form))
        }
      )

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save plan')
      }

      resetForm()
      await loadPlans()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save plan')
    } finally {
      setSaving(false)
    }
  }

  const toggleFeature = (featureKey: string) => {
    setForm((current) => ({
      ...current,
      features: current.features.map((feature) =>
        feature.featureKey === featureKey ? { ...feature, enabled: !feature.enabled } : feature
      )
    }))
  }

  const toggleActive = async (plan: PlanRecord) => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/super-admin/subscription-plans/${plan.id}`, {
        method: 'PUT',
        headers: authHeadersScoped('super_admin'),
        body: JSON.stringify({ isActive: !plan.isActive })
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update plan')
      }

      await loadPlans()
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SuperAdminShell
      title="Subscription Plans"
      subtitle="Manage trader-level plan pricing, limits, feature flags, and trial defaults."
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{editId ? 'Edit Plan' : 'Create Plan'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input
                placeholder="Plan name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                placeholder="Amount"
                type="number"
                min="0"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              />
              <Input
                placeholder="Currency"
                value={form.currency}
                onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
              />
              <Input value={form.billingCycle} disabled />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <Input
                placeholder="Max companies"
                type="number"
                min="0"
                value={form.maxCompanies}
                onChange={(event) => setForm((current) => ({ ...current, maxCompanies: event.target.value }))}
              />
              <Input
                placeholder="Max users"
                type="number"
                min="0"
                value={form.maxUsers}
                onChange={(event) => setForm((current) => ({ ...current, maxUsers: event.target.value }))}
              />
              <Input
                placeholder="Default trial days"
                type="number"
                min="1"
                value={form.defaultTrialDays}
                onChange={(event) => setForm((current) => ({ ...current, defaultTrialDays: event.target.value }))}
              />
              <Input
                placeholder="Sort order"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
              />
            </div>

            <div>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Plan description"
                rows={3}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}
                />
                Active for assignment
              </label>
              <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isTrialCapable}
                  onChange={() => setForm((current) => ({ ...current, isTrialCapable: !current.isTrialCapable }))}
                />
                Trial capable
              </label>
            </div>

            <div className="rounded border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div className="text-sm font-semibold text-slate-900">Feature Flags</div>
                <Badge variant="outline">{activeFeatureCount} enabled</Badge>
              </div>
              <div className="grid gap-2 p-3 md:grid-cols-2">
                {form.features.map((feature) => (
                  <label key={feature.featureKey} className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={feature.enabled}
                      onChange={() => toggleFeature(feature.featureKey)}
                    />
                    <span>
                      <span className="block font-medium text-slate-900">{feature.featureLabel}</span>
                      <span className="block text-xs text-slate-500">{feature.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={savePlan} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving...' : editId ? 'Update Plan' : 'Create Plan'}
              </Button>
              {editId ? (
                <Button variant="outline" onClick={resetForm} disabled={saving}>
                  Cancel Edit
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Plan Catalog</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Trial</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Subscriptions</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-slate-500">
                      Loading plans...
                    </TableCell>
                  </TableRow>
                ) : plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-slate-500">
                      No plans available.
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{plan.name}</div>
                        <div className="text-xs text-slate-500">{plan.description || '-'}</div>
                      </TableCell>
                      <TableCell>{plan.currency} {plan.amount.toFixed(2)}</TableCell>
                      <TableCell>
                        C: {plan.maxCompanies ?? 'U'} | U: {plan.maxUsers ?? 'U'}
                      </TableCell>
                      <TableCell>{plan.defaultTrialDays ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={plan.isActive ? 'default' : 'outline'}>
                          {plan.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>{plan.subscriptionCount}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEdit(plan)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void toggleActive(plan)} disabled={saving}>
                            {plan.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
