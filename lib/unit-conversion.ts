export const UNIVERSAL_UNITS = {
  KG: 'kg',
  QUINTAL: 'qt',
  KG_PER_QUINTAL: 100
} as const

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function toKg(unitCount: number, kgEquivalent: number): number {
  return toNumber(unitCount) * toNumber(kgEquivalent, 1)
}

export function kgToQuintal(kg: number): number {
  return toNumber(kg) / UNIVERSAL_UNITS.KG_PER_QUINTAL
}

export function quintalToKg(quintal: number): number {
  return toNumber(quintal) * UNIVERSAL_UNITS.KG_PER_QUINTAL
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
