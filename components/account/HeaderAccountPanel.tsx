'use client'

import { type LucideIcon, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const [isClient, setIsClient] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const displayName = name?.trim() || userId?.trim() || 'Account'
  const roleLabel = formatRole(role)
  const initials = initialsFromIdentity(name, userId)

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 256 // w-64
    const viewportPadding = 10
    const preferredLeft = rect.right - menuWidth
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
    const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft))
    const top = rect.bottom + viewportPadding
    setMenuPosition({ top, left })
  }, [])

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node
      if (rootRef.current?.contains(targetNode) || menuRef.current?.contains(targetNode)) return
      setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    const handleViewportChange = () => {
      updateMenuPosition()
    }

    updateMenuPosition()

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open, updateMenuPosition])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50',
          open && 'border-slate-300 bg-slate-50'
        )}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_rgba(15,23,42,0.96))] text-[11px] font-semibold text-white">
          {initials}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && isClient && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              style={{ top: menuPosition.top, left: menuPosition.left }}
              className="fixed z-[100] w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.3)]"
            >
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
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
