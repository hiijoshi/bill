import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

export default async function Home() {
  // Keep app-user shortcut, but do not auto-jump into the developer-only super-admin area.
  const appSession = await getSession()
  if (appSession) {
    redirect('/main/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-3xl font-bold mb-6">Welcome to Mandi ERP</h1>
      <div className="space-y-4">
        <a
          href="/login"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          User Login
        </a>
        <a
          href="/super-admin/login"
          className="inline-block px-6 py-3 bg-gray-800 text-white rounded hover:bg-gray-900"
        >
          Super Admin Login
        </a>
      </div>
    </div>
  )
}
