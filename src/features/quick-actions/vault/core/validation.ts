import type { VaultItem, VaultItemInput } from '../types'

export interface VaultValidationResult {
  error?: string
  warning?: string
}

export function validateVaultInitialization(
  masterPassword: string,
  confirmation: string,
): VaultValidationResult {
  if (!masterPassword) return { error: '请输入主密码' }
  if (masterPassword !== confirmation) return { error: '两次输入的主密码不一致' }
  if (masterPassword.length < 8) {
    return { warning: '当前主密码较短，建议使用更长且不易猜测的密码。' }
  }
  return {}
}

export function validateVaultItem(input: VaultItemInput): VaultValidationResult {
  if (!input.title.trim()) return { error: '请填写系统名称' }
  if (!input.password) return { error: '请填写密码' }
  return {}
}

export function normalizeVaultItemInput(input: VaultItemInput): VaultItemInput {
  return {
    title: input.title.trim(),
    username: input.username,
    password: input.password,
    note: input.note,
  }
}

export function filterVaultItems(items: readonly VaultItem[], search: string): VaultItem[] {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return [...items]
  return items.filter((item) =>
    item.title.toLocaleLowerCase().includes(query)
    || item.username.toLocaleLowerCase().includes(query),
  )
}
