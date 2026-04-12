'use client'

import { useEffect, useState } from 'react'
import { Download, RefreshCw, Smartphone } from 'lucide-react'

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua)
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  return isIos && isSafari
}

export default function PwaClientBoot() {
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null)
  const [installing, setInstalling] = useState(false)
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const locallyDismissed = window.localStorage.getItem('mbill:pwa-prompt-dismissed') === 'true'
    setDismissed(locallyDismissed)
    setShowIosHint(!locallyDismissed && isIosSafari() && !isStandaloneMode())

    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') {
      return
    }

    let reloadedForUpdate = false

    const registerServiceWorker = async () => {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      if (registration.waiting) {
        setUpdateReady(registration.waiting)
      }

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing
        if (!installingWorker) return

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateReady(installingWorker)
          }
        })
      })

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedForUpdate) return
        reloadedForUpdate = true
        window.location.reload()
      })
    }

    void registerServiceWorker()
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      if (dismissed || isStandaloneMode()) return
      setInstallPrompt(event as DeferredInstallPrompt)
    }

    const handleInstalled = () => {
      setInstallPrompt(null)
      setShowIosHint(false)
      window.localStorage.removeItem('mbill:pwa-prompt-dismissed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [dismissed])

  const dismissPrompt = () => {
    setDismissed(true)
    setInstallPrompt(null)
    setShowIosHint(false)
    window.localStorage.setItem('mbill:pwa-prompt-dismissed', 'true')
  }

  const triggerInstall = async () => {
    if (!installPrompt) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
    } finally {
      setInstalling(false)
      setInstallPrompt(null)
    }
  }

  const triggerUpdate = () => {
    updateReady?.postMessage({ type: 'SKIP_WAITING' })
  }

  const showInstallCard = !dismissed && !isStandaloneMode() && (Boolean(installPrompt) || showIosHint)

  if (!showInstallCard && !updateReady) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="pointer-events-auto w-full max-w-xl space-y-3">
        {showInstallCard ? (
          <div className="premium-panel rounded-[1.6rem] px-4 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-950">Install Mbill ERP</div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {installPrompt
                    ? 'Pin the ERP to your home screen for a faster standalone experience with app-style launch.'
                    : 'On iPhone Safari, tap Share and choose “Add to Home Screen” for the standalone app experience.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {installPrompt ? (
                    <button
                      type="button"
                      onClick={() => void triggerInstall()}
                      disabled={installing}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {installing ? 'Preparing…' : 'Install app'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={dismissPrompt}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {updateReady ? (
          <div className="premium-panel rounded-[1.4rem] px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Update ready</div>
                <p className="text-sm text-slate-600">A fresh version of the app shell is available.</p>
              </div>
              <button
                type="button"
                onClick={triggerUpdate}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
