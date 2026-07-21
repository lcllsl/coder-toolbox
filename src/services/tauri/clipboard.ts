import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Image } from '@tauri-apps/api/image'
import { BaseDirectory } from '@tauri-apps/api/path'
import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'

import { isTauriRuntime } from './runtime'

const IMAGE_CACHE_DIRECTORY = 'clipboard-images'
const CLIPBOARD_SETTINGS_CHANGED = 'clipboard:settings-changed'
const CLIPBOARD_HISTORY_CHANGED = 'clipboard:history-changed'

export interface ClipboardImageData {
  rgba: Uint8Array
  width: number
  height: number
}

export async function getClipboardSequenceNumber(): Promise<number | null> {
  if (!isTauriRuntime()) return null
  return invoke<number>('clipboard_sequence_number')
}

export async function publishClipboardSettingsChanged(): Promise<void> {
  if (isTauriRuntime()) await emit(CLIPBOARD_SETTINGS_CHANGED)
  else window.dispatchEvent(new Event(CLIPBOARD_SETTINGS_CHANGED))
}

export async function onClipboardSettingsChanged(handler: () => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen(CLIPBOARD_SETTINGS_CHANGED, handler)
  window.addEventListener(CLIPBOARD_SETTINGS_CHANGED, handler)
  return () => window.removeEventListener(CLIPBOARD_SETTINGS_CHANGED, handler)
}

export async function publishClipboardHistoryChanged(): Promise<void> {
  if (isTauriRuntime()) await emit(CLIPBOARD_HISTORY_CHANGED)
  else window.dispatchEvent(new Event(CLIPBOARD_HISTORY_CHANGED))
}

export async function onClipboardHistoryChanged(handler: () => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen(CLIPBOARD_HISTORY_CHANGED, handler)
  window.addEventListener(CLIPBOARD_HISTORY_CHANGED, handler)
  return () => window.removeEventListener(CLIPBOARD_HISTORY_CHANGED, handler)
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (isTauriRuntime()) return await readText()
    return null
  } catch {
    return null
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    await writeText(text)
    return
  }
  await navigator.clipboard.writeText(text)
}

export async function readClipboardImage(): Promise<ClipboardImageData | null> {
  if (!isTauriRuntime()) return null
  try {
    const image = await readImage()
    try {
      const [rgba, size] = await Promise.all([image.rgba(), image.size()])
      return { rgba, width: size.width, height: size.height }
    } finally {
      await image.close()
    }
  } catch {
    return null
  }
}

async function encodePng(image: ClipboardImageData): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas_context_unavailable')
  context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('png_encode_failed')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function saveClipboardImage(id: string, image: ClipboardImageData): Promise<string> {
  const path = `${IMAGE_CACHE_DIRECTORY}/${id}.png`
  await mkdir(IMAGE_CACHE_DIRECTORY, { baseDir: BaseDirectory.AppCache, recursive: true })
  await writeFile(path, await encodePng(image), { baseDir: BaseDirectory.AppCache })
  return path
}

export async function loadClipboardImageUrl(path: string): Promise<string> {
  if (!isTauriRuntime()) return path
  const bytes = await readFile(path, { baseDir: BaseDirectory.AppCache })
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
}

export async function deleteClipboardImage(path: string): Promise<void> {
  if (!isTauriRuntime()) return
  try { await remove(path, { baseDir: BaseDirectory.AppCache }) }
  catch { /* Cache files may already have been removed by the operating system. */ }
}

async function decodePng(bytes: Uint8Array): Promise<ClipboardImageData> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas_context_unavailable')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return { rgba: new Uint8Array(data.data), width: data.width, height: data.height }
}

export async function writeCachedClipboardImage(path: string): Promise<void> {
  const bytes = await readFile(path, { baseDir: BaseDirectory.AppCache })
  const cached = await decodePng(bytes)
  const image = await Image.new(cached.rgba, cached.width, cached.height)
  try { await writeImage(image) }
  finally { await image.close() }
}
