import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface TauriConfig {
  app: {
    security: {
      csp: string
    }
  }
}

describe('Tauri security configuration', () => {
  it('allows in-memory clipboard image previews', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as TauriConfig

    expect(config.app.security.csp).toMatch(/img-src[^;]*\bblob:/)
  })
})
