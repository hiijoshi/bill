'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Upload, Save } from 'lucide-react'

interface CompanyPageProps {
  params: { companyId: string }
}

export default function CompanyMaster({ params }: CompanyPageProps) {
  const [companyData, setCompanyData] = useState({
    name: '',
    gstNumber: '',
    mandiLicense: '',
    address: '',
    phone: '',
    email: '',
    logo: ''
  })

  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    // Load company data
    loadCompanyData()
  }, [params.companyId])

  const loadCompanyData = async () => {
    try {
      const response = await fetch(`/api/companies/${params.companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCompanyData(data)
      }
    } catch (error) {
      console.error('Error loading company data:', error)
    }
  }

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/companies/${params.companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companyData)
      })

      if (response.ok) {
        setIsEditing(false)
        alert('Company profile updated successfully!')
      }
    } catch (error) {
      console.error('Error saving company data:', error)
      alert('Error saving company data')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Company Profile</h1>
        <Button onClick={() => setIsEditing(!isEditing)}>
          {isEditing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Company Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo Upload */}
          <div className="flex items-center space-x-4">
            <div className="w-24 h-24 bg-gray-200 rounded-lg flex items-center justify-center">
              {companyData.logo ? (
                <img src={companyData.logo} alt="Company Logo" className="w-full h-full object-cover rounded-lg" />
              ) : (
                <Building2 className="h-8 w-8 text-gray-400" />
              )}
            </div>
            <div>
              <Button variant="outline" className="mb-2">
                <Upload className="h-4 w-4 mr-2" />
                Upload Logo
              </Button>
              <p className="text-sm text-gray-500">PNG, JPG up to 2MB</p>
            </div>
          </div>

          {/* Company Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label htmlFor="name">Company Name</Label>
              <Input
                id="name"
                value={companyData.name}
                onChange={(e) => setCompanyData({ ...companyData, name: e.target.value })}
                disabled={!isEditing}
              />
            </div>
            <div>
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input
                id="gstNumber"
                value={companyData.gstNumber}
                onChange={(e) => setCompanyData({ ...companyData, gstNumber: e.target.value })}
                disabled={!isEditing}
              />
            </div>
            <div>
              <Label htmlFor="mandiLicense">Mandi License Number</Label>
              <Input
                id="mandiLicense"
                value={companyData.mandiLicense}
                onChange={(e) => setCompanyData({ ...companyData, mandiLicense: e.target.value })}
                disabled={!isEditing}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={companyData.phone}
                onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                disabled={!isEditing}
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={companyData.email}
                onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                disabled={!isEditing}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <textarea
              id="address"
              className="w-full p-2 border border-gray-300 rounded-md"
              rows={3}
              value={companyData.address}
              onChange={(e) => setCompanyData({ ...companyData, address: e.target.value })}
              disabled={!isEditing}
            />
          </div>

          {isEditing && (
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
