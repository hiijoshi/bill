import { ImageResponse } from 'next/og'
import { PwaIconMarkup } from '@/lib/pwa/icon-markup'

export async function GET() {
  return new ImageResponse(
    PwaIconMarkup({ size: 192 }),
    {
      width: 192,
      height: 192
    }
  )
}
