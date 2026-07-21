export async function copyText(value: string): Promise<void> {
  if (!value) throw new Error('当前没有可复制的结果')
  await navigator.clipboard.writeText(value)
}

export async function readClipboardText(): Promise<string> {
  return navigator.clipboard.readText()
}
