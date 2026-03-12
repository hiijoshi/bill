'use client'

import { useCallback, useEffect, useState } from 'react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

type ActivityRow = {
  id: string
  type: string
  action: string
  details: string
  timestamp: string
}

export default function SuperAdminAuditLogsPage() {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/super-admin/activity')
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load audit logs')
      }
      setRows(Array.isArray(payload) ? payload : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SuperAdminShell
      title="Audit Logs"
      subtitle="Recent system actions for compliance and traceability"
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Latest Activity</CardTitle>
            <Button variant="outline" onClick={() => load()} disabled={loading}>Refresh</Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.action}</TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell>{row.details}</TableCell>
                      <TableCell>{new Date(row.timestamp).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
