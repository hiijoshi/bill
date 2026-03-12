'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Company {
  id: string
  name: string
}

interface CompanySelectorProps {
  companies: Company[]
}

export default function CompanySelector({ companies }: CompanySelectorProps) {
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const router = useRouter()

  const handleSelect = () => {
    if (!selectedCompany) return

    void (async () => {
      try {
        const response = await fetch('/api/auth/company', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ companyId: selectedCompany, force: true })
        })

        if (!response.ok) {
          return
        }

        router.push('/main/dashboard')
      } catch {
        // Silent fail and keep user on selector page
      }
    })()
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="company">Select Company</Label>
        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSelect} disabled={!selectedCompany} className="w-full">
        Select Company
      </Button>
    </div>
  )
}
