'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'

export type SearchableSelectOption = {
  value: string
  label: string
  description?: string
  keywords?: string[]
}

type Props = {
  id: string
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Select option',
  searchPlaceholder = 'Search...',
  emptyText = 'No options found.',
  disabled = false,
  triggerClassName,
  contentClassName
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    const query = normalizeText(search)
    if (!query) return options

    return options.filter((option) => {
      const haystacks = [option.label, option.description || '', ...(option.keywords || [])]
      return haystacks.some((entry) => normalizeText(entry).includes(query))
    })
  }, [options, search])

  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        className={`flex h-10 w-full min-w-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName || ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? 'text-foreground' : 'text-muted-foreground'}`}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div className={`absolute z-50 mt-1 w-full min-w-0 rounded-md border border-slate-200 bg-white shadow-lg ${contentClassName || ''}`}>
          <div className="border-b border-slate-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
          </div>

          <div
            id={`${id}-listbox`}
            role="listbox"
            className="max-h-64 overflow-y-auto py-1"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const selected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      selected ? 'bg-slate-100 text-slate-900' : 'text-slate-700'
                    }`}
                    onClick={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block break-words">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block break-words text-xs text-slate-500">{option.description}</span>
                      ) : null}
                    </span>
                    {selected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-900" /> : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
