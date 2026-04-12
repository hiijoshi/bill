import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mbill ERP',
    short_name: 'Mbill',
    description: 'Premium billing, ledger, stock, reports, and reconciliation ERP with installable app experience.',
    start_url: '/main/dashboard?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#e8eef6',
    theme_color: '#0f172a',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      {
        src: '/pwa-icons/192',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/pwa-icons/512',
        sizes: '512x512',
        type: 'image/png'
      },
      {
        src: '/pwa-icons/maskable',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  }
}
