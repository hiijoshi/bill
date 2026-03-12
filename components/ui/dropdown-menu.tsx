"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface DropdownMenuProps {
  children: React.ReactNode
  trigger: React.ReactNode
  className?: string
}

interface DropdownMenuContentProps {
  children: React.ReactNode
  className?: string
}

interface DropdownMenuItemProps {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, trigger, className }) => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div className="relative inline-block text-left">
      <div
        className={cn(
          "inline-flex justify-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2",
          className
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        {trigger}
        <ChevronDown className="ml-2 h-4 w-4" />
      </div>
      
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
          <div className="py-1" role="menu">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

const DropdownMenuTrigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => {
    return <div ref={ref} {...props} />
  }
)

DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

const DropdownMenuContent: React.FC<DropdownMenuContentProps> = ({ children, className }) => {
  return (
    <div className={cn("py-1", className)}>
      {children}
    </div>
  )
}

const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({ children, onClick, className }) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 cursor-pointer",
        className
      )}
      role="menuitem"
    >
      {children}
    </div>
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
}
