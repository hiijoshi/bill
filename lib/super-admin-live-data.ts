export const SUPER_ADMIN_DATA_CHANGED_EVENT = 'super-admin-data-changed'

export type SuperAdminDataChangeDetail = {
  updatedAt: number
}

const SUPER_ADMIN_LIVE_CHANNEL_NAME = 'mbill-super-admin-live-data'
let superAdminLiveChannel: BroadcastChannel | null | undefined

function getSuperAdminLiveChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null
  }

  if (superAdminLiveChannel !== undefined) {
    return superAdminLiveChannel
  }

  try {
    superAdminLiveChannel = new BroadcastChannel(SUPER_ADMIN_LIVE_CHANNEL_NAME)
  } catch {
    superAdminLiveChannel = null
  }

  return superAdminLiveChannel
}

export function dispatchSuperAdminDataChanged(detail?: Partial<SuperAdminDataChangeDetail>): void {
  if (typeof window === 'undefined') return

  const payload: SuperAdminDataChangeDetail = {
    updatedAt:
      typeof detail?.updatedAt === 'number' && Number.isFinite(detail.updatedAt)
        ? detail.updatedAt
        : Date.now()
  }

  window.dispatchEvent(new CustomEvent<SuperAdminDataChangeDetail>(SUPER_ADMIN_DATA_CHANGED_EVENT, { detail: payload }))
  getSuperAdminLiveChannel()?.postMessage(payload)
}

export function subscribeSuperAdminDataChanged(
  listener: (detail: SuperAdminDataChangeDetail) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const onWindowEvent = (event: Event) => {
    const detail = (event as CustomEvent<SuperAdminDataChangeDetail>).detail
    if (!detail) return
    listener(detail)
  }

  window.addEventListener(SUPER_ADMIN_DATA_CHANGED_EVENT, onWindowEvent)

  const channel = getSuperAdminLiveChannel()
  const onChannelMessage = (event: MessageEvent<SuperAdminDataChangeDetail>) => {
    if (!event.data) return
    listener(event.data)
  }
  channel?.addEventListener('message', onChannelMessage)

  return () => {
    window.removeEventListener(SUPER_ADMIN_DATA_CHANGED_EVENT, onWindowEvent)
    channel?.removeEventListener('message', onChannelMessage)
  }
}
