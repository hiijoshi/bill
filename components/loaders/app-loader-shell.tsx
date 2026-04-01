'use client'

import DashboardLayout from '@/app/components/DashboardLayout'

import { TaskLoader, type TaskLoaderKind } from '@/components/loaders/task-loader'

type AppLoaderShellProps = {
  kind: TaskLoaderKind
  companyId?: string
  title?: string
  message?: string
  fullscreen?: boolean
  compact?: boolean
  className?: string
  lockViewport?: boolean
}

export function AppLoaderShell({
  kind,
  companyId,
  title,
  message,
  fullscreen = false,
  compact = false,
  className,
  lockViewport = false
}: AppLoaderShellProps) {
  const content = (
    <TaskLoader
      kind={kind}
      title={title}
      message={message}
      fullscreen={fullscreen}
      compact={compact}
      className={className}
    />
  )

  if (companyId === undefined) {
    return content
  }

  return (
    <DashboardLayout companyId={companyId} lockViewport={lockViewport}>
      {content}
    </DashboardLayout>
  )
}
