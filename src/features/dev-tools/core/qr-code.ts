const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_CANVAS_EDGE = 3_000
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
])

export interface QrPixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function validateQrContent(content: string): string {
  if (!content.length) throw new Error('请输入要转换为二维码的内容')
  return content
}

export async function generateQrDataUrl(content: string): Promise<string> {
  try {
    const { default: QRCode } = await import('qrcode')
    return await QRCode.toDataURL(validateQrContent(content), {
      width: 360,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: { dark: '#172033', light: '#ffffff' },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('too big')) {
      throw new Error('内容过长，无法生成单个二维码')
    }
    if (error instanceof Error && error.message.startsWith('请输入')) throw error
    throw new Error('二维码生成失败')
  }
}

export async function decodeQrPixels({ data, width, height }: QrPixels): Promise<string> {
  const { default: jsQR } = await import('jsqr')
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
  if (!result?.data) throw new Error('未在图片中识别到二维码')
  return result.data
}

function validateImage(file: File): void {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('请选择 PNG、JPG、WebP、GIF 或 BMP 图片')
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error('二维码图片不能超过 15 MB')
}

export async function decodeQrFile(file: File): Promise<string> {
  validateImage(file)
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    if (!bitmap.width || !bitmap.height) throw new Error('图片尺寸无效')
    const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取图片像素')
    context.drawImage(bitmap, 0, 0, width, height)
    return await decodeQrPixels(context.getImageData(0, 0, width, height))
  } catch (error) {
    if (error instanceof Error && (error.message.includes('二维码') || error.message.includes('图片'))) {
      throw error
    }
    throw new Error('二维码图片读取失败')
  } finally {
    bitmap?.close()
  }
}
