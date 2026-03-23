import type { NextConfig } from "next";
import { isProduction } from './lib/config'

const ALLOWED_ORIGINS_LIST = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const PRIMARY_ALLOWED_ORIGIN = ALLOWED_ORIGINS_LIST[0] || 'http://localhost:3000'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1:51445'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: {
      allowedOrigins: [
        '127.0.0.1:51445',
        'mbill.hiijoshi.in',
        'hiijoshi.in',
        'www.hiijoshi.in',
        ...ALLOWED_ORIGINS_LIST.map((o) => {
          try { return new URL(o).host } catch { return o }
        })
      ].filter(Boolean)
    }
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: PRIMARY_ALLOWED_ORIGIN
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS, PATCH'
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token'
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true'
          },
          {
            key: 'Vary',
            value: 'Origin'
          },
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
              ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.supabase.com wss://*.supabase.co"
              : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.supabase.com wss://*.supabase.co"
          }
        ]
      }
    ]
  }
};

export default nextConfig;