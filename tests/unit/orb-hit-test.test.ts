import { describe, expect, it, vi } from 'vitest'

import { createCursorEventGate } from '@/services/tauri/windows'

describe('orb cursor event gate', () => {
  it('restores cursor events after an in-flight ignore request when stopped', async () => {
    let releaseIgnore: (() => void) | undefined
    const appliedStates: boolean[] = []
    const applyIgnoreState = vi.fn(async (ignore: boolean) => {
      if (ignore) await new Promise<void>((resolve) => { releaseIgnore = resolve })
      appliedStates.push(ignore)
    })
    const gate = createCursorEventGate(applyIgnoreState)

    const ignoring = gate.setIgnoring(true)
    await vi.waitFor(() => expect(releaseIgnore).toBeTypeOf('function'))
    const stopping = gate.stop()
    releaseIgnore?.()
    await Promise.all([ignoring, stopping])

    expect(appliedStates).toEqual([true, false])
  })

  it('does not allow stale ignore requests after it has stopped', async () => {
    const appliedStates: boolean[] = []
    const gate = createCursorEventGate(async (ignore) => {
      appliedStates.push(ignore)
    })

    await gate.stop()
    await gate.setIgnoring(true)

    expect(appliedStates).toEqual([false])
  })

  it('still restores cursor events when the preceding update fails', async () => {
    const appliedStates: boolean[] = []
    const applyIgnoreState = vi.fn(async (ignore: boolean) => {
      if (ignore) throw new Error('temporary native failure')
      appliedStates.push(ignore)
    })
    const gate = createCursorEventGate(applyIgnoreState)

    const ignoring = gate.setIgnoring(true)
    const ignoringExpectation = expect(ignoring).rejects.toThrow('temporary native failure')
    await vi.waitFor(() => expect(applyIgnoreState).toHaveBeenCalledWith(true))
    const stopping = gate.stop()
    await ignoringExpectation
    await stopping

    expect(appliedStates).toEqual([false])
  })

  it('retries restoring cursor events once after a native failure', async () => {
    let restoreAttempts = 0
    const gate = createCursorEventGate(async (ignore) => {
      if (!ignore && restoreAttempts++ === 0) throw new Error('temporary restore failure')
    })

    await gate.stop()

    expect(restoreAttempts).toBe(2)
  })
})
