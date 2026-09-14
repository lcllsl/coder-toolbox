import type { SmartTableBatch, SmartTableSourceBlock } from './types'

const MAX_BLOCK_CHARS = 4_000

export function splitSourceBlocks(text: string): SmartTableSourceBlock[] {
  const blocks: SmartTableSourceBlock[] = []
  const pattern = /[^\n]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const raw = match[0]
    const trimmed = raw.trim()
    if (!trimmed) continue
    const leading = raw.indexOf(trimmed)
    for (let offset = 0; offset < trimmed.length; offset += MAX_BLOCK_CHARS) {
      const part = trimmed.slice(offset, offset + MAX_BLOCK_CHARS)
      const startOffset = match.index + leading + offset
      blocks.push({ id: `source-${blocks.length + 1}`, text: part, startOffset, endOffset: startOffset + part.length })
    }
  }
  if (!blocks.length && text.trim()) {
    const startOffset = text.indexOf(text.trim())
    blocks.push({ id: 'source-1', text: text.trim(), startOffset, endOffset: startOffset + text.trim().length })
  }
  return blocks
}

export function createSourceBatches(blocks: SmartTableSourceBlock[], maxBlocks = 35, maxChars = 12_000): SmartTableBatch[] {
  const batches: SmartTableBatch[] = []
  let current: SmartTableSourceBlock[] = []
  let currentChars = 0
  for (const block of blocks) {
    if (current.length && (current.length >= maxBlocks || currentChars + block.text.length > maxChars)) {
      batches.push({ index: batches.length, sourceBlocks: current })
      current = []
      currentChars = 0
    }
    current.push(block)
    currentChars += block.text.length
  }
  if (current.length) batches.push({ index: batches.length, sourceBlocks: current })
  return batches
}
