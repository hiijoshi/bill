import { redirect } from 'next/navigation'
import { env } from '@/lib/config'

export default function LoginBypassPage() {
  if (env.NODE_ENV !== 'development') {
    redirect('/login')
  }
  redirect('/main/dashboard')
}
