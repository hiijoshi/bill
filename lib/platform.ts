"use client"

import { useEffect, useMemo, useState } from "react"

export type RuntimePlatform = "web" | "android" | "ios"
export type ViewportClass = "phone" | "tablet" | "desktop"
export type DensityMode = "compact" | "comfortable"

export type PlatformProfile = {
  runtimePlatform: RuntimePlatform
  viewport: ViewportClass
  density: DensityMode
  prefersReducedMotion: boolean
  isTouchPrimary: boolean
  isApple: boolean
  isAndroid: boolean
  isDesktop: boolean
  isTablet: boolean
  isPhone: boolean
}

function detectRuntimePlatform(userAgent: string): RuntimePlatform {
  const normalized = userAgent.toLowerCase()

  if (/iphone|ipad|ipod|ios/.test(normalized)) {
    return "ios"
  }

  if (/android/.test(normalized)) {
    return "android"
  }

  return "web"
}

function getViewportClass(width: number): ViewportClass {
  if (width >= 1180) return "desktop"
  if (width >= 768) return "tablet"
  return "phone"
}

function getDensityMode(width: number, pointerIsCoarse: boolean): DensityMode {
  if (width >= 1180 && !pointerIsCoarse) return "compact"
  return "comfortable"
}

function readPlatformProfile(): PlatformProfile {
  if (typeof window === "undefined") {
    return {
      runtimePlatform: "web",
      viewport: "desktop",
      density: "compact",
      prefersReducedMotion: false,
      isTouchPrimary: false,
      isApple: false,
      isAndroid: false,
      isDesktop: true,
      isTablet: false,
      isPhone: false,
    }
  }

  const userAgent = window.navigator.userAgent || ""
  const runtimePlatform = detectRuntimePlatform(userAgent)
  const coarseQuery = window.matchMedia?.("(pointer: coarse)")
  const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)")
  const isTouchPrimary = Boolean(coarseQuery?.matches)
  const viewport = getViewportClass(window.innerWidth)
  const density = getDensityMode(window.innerWidth, isTouchPrimary)

  return {
    runtimePlatform,
    viewport,
    density,
    prefersReducedMotion: Boolean(reduceMotionQuery?.matches),
    isTouchPrimary,
    isApple: runtimePlatform === "ios",
    isAndroid: runtimePlatform === "android",
    isDesktop: viewport === "desktop",
    isTablet: viewport === "tablet",
    isPhone: viewport === "phone",
  }
}

export function usePlatformProfile(): PlatformProfile {
  const [profile, setProfile] = useState<PlatformProfile>(() => readPlatformProfile())

  useEffect(() => {
    const sync = () => {
      setProfile(readPlatformProfile())
    }

    sync()

    const coarseQuery = window.matchMedia?.("(pointer: coarse)")
    const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)")

    window.addEventListener("resize", sync)
    coarseQuery?.addEventListener?.("change", sync)
    reduceMotionQuery?.addEventListener?.("change", sync)

    return () => {
      window.removeEventListener("resize", sync)
      coarseQuery?.removeEventListener?.("change", sync)
      reduceMotionQuery?.removeEventListener?.("change", sync)
    }
  }, [])

  return profile
}

export function usePlatformClasses() {
  const profile = usePlatformProfile()

  return useMemo(
    () => ({
      profile,
      container:
        profile.isDesktop
          ? "mx-auto w-full max-w-[1600px] px-6 xl:px-8"
          : profile.isTablet
            ? "mx-auto w-full max-w-6xl px-5"
            : "w-full px-4",
      shellPadding:
        profile.isDesktop
          ? "p-4 xl:p-5"
          : profile.isTablet
            ? "p-3.5"
            : "p-0",
      topBarHeight: profile.isPhone ? "min-h-[72px]" : "min-h-[84px]",
      contentSpacing: profile.isDesktop ? "space-y-6" : "space-y-4",
    }),
    [profile]
  )
}
