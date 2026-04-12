import { ImageResponse } from 'next/og'
import { PwaIconMarkup } from '@/lib/pwa/icon-markup'

export const size = {
  width: 512,
  height: 512
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    PwaIconMarkup({ size: 512 }),
    size
  )
}
