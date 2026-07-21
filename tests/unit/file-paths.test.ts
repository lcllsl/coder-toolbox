import { describe, expect, it } from 'vitest'

import { buildDateFolderName, fileNameFromPath, formatFileSize, parentPath, transferExpiryDate, unixToWindowsPath, windowsToUnixPath } from '@/features/files/core/paths'

describe('file path tools', () => {
  it('converts Windows paths without changing meaningful characters', () => {
    expect(windowsToUnixPath('C:\\Users\\demo\\file.txt')).toEqual({ value: 'C:/Users/demo/file.txt' })
    expect(windowsToUnixPath('C:\\Users\\demo', true)).toEqual({ value: '/mnt/c/Users/demo' })
    expect(windowsToUnixPath('relative\\path', true).error).toContain('盘符')
  })

  it('only converts recognizable WSL mount paths back to Windows', () => {
    expect(unixToWindowsPath('/mnt/d/work/demo')).toEqual({ value: 'D:\\work\\demo' })
    expect(unixToWindowsPath('/Users/demo').error).toContain('/mnt/<drive>/')
  })

  it('extracts file names and parent directories across separators', () => {
    expect(fileNameFromPath('/Users/demo/report.pdf')).toBe('report.pdf')
    expect(fileNameFromPath('C:\\work\\src\\')).toBe('src')
    expect(parentPath('/Users/demo/report.pdf')).toBe('/Users/demo')
    expect(parentPath('C:\\work\\src')).toBe('C:\\work')
  })

  it('builds supported date folder names and rejects unsafe topics', () => {
    const date = new Date(2026, 6, 21)
    expect(buildDateFolderName('YYYY-MM-DD', '', date)).toEqual({ value: '2026-07-21' })
    expect(buildDateFolderName('YYYYMMDD', '', date)).toEqual({ value: '20260721' })
    expect(buildDateFolderName('YYYY-MM-DD_topic', '设计稿', date)).toEqual({ value: '2026-07-21_设计稿' })
    expect(buildDateFolderName('YYYY-MM-DD_topic', '../危险', date).error).toBeTruthy()
  })

  it('calculates transfer expiry and readable sizes', () => {
    expect(transferExpiryDate('2026-07-21T00:00:00.000Z')).toBe('2026-07-28T00:00:00.000Z')
    expect(transferExpiryDate('invalid')).toBeUndefined()
    expect(formatFileSize(900)).toBe('900 B')
    expect(formatFileSize(1536)).toBe('1.50 KB')
    expect(formatFileSize(12 * 1024 * 1024)).toBe('12.0 MB')
  })
})
