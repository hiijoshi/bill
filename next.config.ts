import type { NextConfig } from "next";
import { isProduction } from './lib/config'

const ALLOWED_ORIGINS_LIST = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const DEFAULT_LOCAL_ALLOWED_HOSTS = ['127.0.0.1:3000', 'localhost:3000']

function toHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return origin || null
  }
}

const ALLOWED_ACTION_HOSTS = Array.from(
  new Set(
    [...DEFAULT_LOCAL_ALLOWED_HOSTS, ...ALLOWED_ORIGINS_LIST.map((origin) => toHost(origin)).filter(Boolean) as string[]]
  )
)

const CONNECT_SRC_VALUES = ["'self'"]

if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    CONNECT_SRC_VALUES.push(supabaseOrigin)
    CONNECT_SRC_VALUES.push(supabaseOrigin.replace(/^http/, 'ws'))
  } catch {
    CONNECT_SRC_VALUES.push('https://*.supabase.co', 'https://*.supabase.com', 'wss://*.supabase.co')
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: DEFAULT_LOCAL_ALLOWED_HOSTS,
  serverExternalPackages: ['@napi-rs/canvas', 'pdf-parse', 'pdfjs-dist'],
  turbopack: {
    root: process.cwd()
  },
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-select'],
    serverActions: {
      allowedOrigins: ALLOWED_ACTION_HOSTS
    }
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Content-Security-Policy',
            value: isProduction
              ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src ${CONNECT_SRC_VALUES.join(' ')}`
              : `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src ${CONNECT_SRC_VALUES.join(' ')}`
          }
        ]
      }
    ]
  }
};

const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? require('@next/bundle-analyzer')({
        enabled: true
      })
    : (config: NextConfig) => config

export default withBundleAnalyzer(nextConfig);
