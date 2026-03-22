'use client'

import { type LucideIcon, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type AccountMenuItem = {
  label: string
  icon?: LucideIcon
  onClick: () => void
  tone?: 'default' | 'danger'
  separatorBefore?: boolean
}

type HeaderAccountPanelProps = {
  name?: string | null
  userId?: string | null
  role?: string | null
  contextLabel?: string | null
  menuItems: AccountMenuItem[]
}

function formatRole(role?: string | null) {
  if (!role) return 'Account'
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function initialsFromIdentity(name?: string | null, userId?: string | null) {
  const source = (name || userId || 'U').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

export default function HeaderAccountPanel({
  name,
  userId,
  role,
  contextLabel,
  menuItems,
}: HeaderAccountPanelProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const displayName = name?.trim() || userId?.trim() || 'Account'
  const roleLabel = formatRole(role)
  const initials = initialsFromIdentity(name, userId)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50',
          open && 'border-slate-300 bg-slate-50'
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_rgba(15,23,42,0.96))] text-[11px] font-semibold text-white">
          {initials}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.3)]">
          <div className="rounded-xl px-3 py-3">
            <p className="text-sm font-semibold text-slate-900">{displayName}</p>
            <p className="mt-0.5 text-xs text-slate-500">{roleLabel}</p>
            {contextLabel ? <p className="mt-1 text-[11px] text-slate-400">{contextLabel}</p> : null}
          </div>

          <div className="mt-1 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label}>
                  {item.separatorBefore ? <div className="my-2 border-t border-slate-100" /> : null}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      item.onClick()
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-50',
                      item.tone === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'
                    )}
                    role="menuitem"
                  >
                    {Icon ? (
                      <span className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-full',
                        item.tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                    ) : null}
                    <span className="font-medium">{item.label}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
