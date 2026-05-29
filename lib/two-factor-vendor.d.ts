declare module 'speakeasy' {
  type GenerateSecretOptions = {
    name?: string
    issuer?: string
    length?: number
  }

  type GeneratedSecret = {
    ascii: string
    hex: string
    base32: string
    otpauth_url?: string
  }

  type VerifyOptions = {
    secret: string
    encoding?: 'ascii' | 'hex' | 'base32'
    token: string
    window?: number
  }

  const speakeasy: {
    generateSecret(options?: GenerateSecretOptions): GeneratedSecret
    totp: {
      verify(options: VerifyOptions): boolean
    }
  }

  export = speakeasy
}

declare module 'qrcode' {
  type QRCodeToDataURLOptions = {
    width?: number
    margin?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>
}
