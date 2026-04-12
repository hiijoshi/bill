import { ImageResponse } from 'next/og'
import { PwaIconMarkup } from '@/lib/pwa/icon-markup'

export const size = {
  width: 180,
  height: 180
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    PwaIconMarkup({ size: 180 }),
    size
  )
}
