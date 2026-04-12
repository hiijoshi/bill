import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Manrope } from 'next/font/google'
import './globals.css'
import AppShell from '@/app/AppShell'

const appSans = Manrope({
  subsets: ['latin'],
  variable: '--font-app-sans',
  display: 'swap'
})

const appMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-app-mono',
  display: 'swap'
})

export const metadata: Metadata = {
  applicationName: 'Mbill ERP',
  title: {
    default: 'Mbill ERP',
    template: '%s | Mbill ERP'
  },
  description: 'Premium billing, reconciliation, ledger, and business management ERP for web and mobile install experience.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Mbill ERP',
    statusBarStyle: 'default'
  },
  icons: {
    icon: [
      { url: '/icon', sizes: '512x512', type: 'image/png' }
    ],
    apple: [
      { url: '/apple-icon', sizes: '180x180', type: 'image/png' }
    ],
    shortcut: ['/icon']
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${appSans.variable} ${appMono.variable} motion-minimal-app app-chrome antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
