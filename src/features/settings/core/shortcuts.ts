export interface ShortcutValidation {
  value?: string
  error?: string
}

const modifierAliases: Record<string, string> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift',
  cmd: 'Command', command: 'Command', meta: 'Command', super: 'Super',
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
}

export function validateGlobalShortcut(input: string): ShortcutValidation {
  const parts = input.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return { error: '请输入至少一个修饰键和一个按键' }
  const key = parts.at(-1)
  const rawModifiers = parts.slice(0, -1)
  const modifiers = rawModifiers.map((modifier) => modifierAliases[modifier.toLowerCase()])
  if (!key || modifiers.some((modifier) => !modifier)) return { error: '快捷键格式无法识别' }
  if (modifiers.length < 2) return { error: '请使用至少两个修饰键，避免占用常见系统快捷键' }
  const uniqueModifiers = [...new Set(modifiers)]
  if (uniqueModifiers.length !== modifiers.length) return { error: '快捷键包含重复的修饰键' }
  const normalizedKey = key.length === 1 ? key.toUpperCase() : `${key[0]?.toUpperCase()}${key.slice(1).toLowerCase()}`
  const value = [...uniqueModifiers, normalizedKey].join('+')
  const forbidden = new Set(['Command+Space', 'Alt+Tab', 'Ctrl+Alt+Delete'])
  if (forbidden.has(value)) return { error: '该组合通常由系统占用，请换一个快捷键' }
  return { value }
}
