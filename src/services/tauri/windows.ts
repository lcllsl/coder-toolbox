import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { cursorPosition, getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window'

import type { PanelCategory, PanelNavigationPayload } from '@/types/navigation'
import type { ReminderId } from '@/features/health/types'
import type { HitRegion, OrbWindowGeometry, Point, SnapEdge, SnapResult } from '@/types/orb'
import { containsPoint } from '@/utils/petal-layout'
import { isTauriRuntime } from './runtime'

const PANEL_NAVIGATE_EVENT = 'panel:navigate'
const ORB_PANEL_CLOSED_EVENT = 'orb:panel-closed'

export async function openPanel(category: PanelCategory): Promise<void> {
  if (!isTauriRuntime()) {
    window.dispatchEvent(
      new CustomEvent<PanelNavigationPayload>(PANEL_NAVIGATE_EVENT, {
        detail: { category },
      }),
    )
    return
  }

  await invoke('open_panel', { category })
}

export async function closePanel(reopenPetals = false): Promise<void> {
  if (!isTauriRuntime()) {
    window.dispatchEvent(new CustomEvent('panel:preview-close', { detail: { reopenPetals } }))
    return
  }
  await invoke('close_panel', { reopenPetals })
}

export async function hideOrb(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('hide_orb')
}

export async function setOrbExpanded(
  expanded: boolean,
  geometry?: OrbWindowGeometry | null,
  snapEdge?: SnapEdge,
): Promise<OrbWindowGeometry> {
  if (!isTauriRuntime()) {
    const previewPlacement = new URLSearchParams(window.location.search).get('placement')
    const previewGeometries: Record<string, OrbWindowGeometry> = {
      'bottom-right': {
            width: 340,
            height: 340,
            orbX: 296,
            orbY: 296,
            horizontal: 'left',
            vertical: 'up',
      },
      top: {
        width: 340,
        height: 340,
        orbX: 170,
        orbY: 44,
        horizontal: 'center',
        vertical: 'down',
      },
      bottom: {
        width: 340,
        height: 340,
        orbX: 170,
        orbY: 296,
        horizontal: 'center',
        vertical: 'up',
      },
    }
    const previewGeometry =
      previewGeometries[previewPlacement ?? ''] ??
      ({
            width: 340,
            height: 340,
            orbX: 290,
            orbY: 170,
            horizontal: 'left',
            vertical: 'center',
      } satisfies OrbWindowGeometry)
    return expanded
      ? previewGeometry
      : {
          width: 88,
          height: 88,
          orbX: 44,
          orbY: 44,
          horizontal: geometry?.horizontal ?? 'left',
          vertical: geometry?.vertical ?? 'center',
        }
  }

  return invoke<OrbWindowGeometry>('set_orb_expanded', {
    expanded,
    anchorX: geometry?.orbX,
    anchorY: geometry?.orbY,
    snapEdge,
  })
}

export async function showSettings(): Promise<void> {
  if (!isTauriRuntime()) {
    window.dispatchEvent(
      new CustomEvent<PanelNavigationPayload>(PANEL_NAVIGATE_EVENT, {
        detail: { category: 'settings' },
      }),
    )
    return
  }
  await invoke('show_settings')
}

export async function getOrbPosition(): Promise<Point> {
  if (!isTauriRuntime()) return { x: 0, y: 0 }
  const appWindow = getCurrentWindow()
  const [position, scaleFactor] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.scaleFactor(),
  ])
  return position.toLogical(scaleFactor)
}

export async function moveOrbTo(position: Point): Promise<void> {
  if (!isTauriRuntime()) return
  await getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y))
}

export async function snapOrbToEdge(): Promise<SnapResult> {
  if (!isTauriRuntime()) return { edge: 'right', x: 0, y: 0 }
  return invoke<SnapResult>('snap_orb_to_edge')
}

export async function setOrbEdgeCollapsed(edge: SnapEdge, collapsed: boolean): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('set_orb_edge_collapsed', { edge, collapsed })
}

export async function onOrbPanelClosed(
  handler: (reopenPetals: boolean, debugReminderId?: ReminderId) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return listen<{ reopenPetals: boolean; debugReminderId?: ReminderId }>(ORB_PANEL_CLOSED_EVENT, (event) => {
    handler(event.payload.reopenPetals, event.payload.debugReminderId)
  })
}

export interface CursorEventGate {
  setIgnoring(ignore: boolean): Promise<void>
  stop(): Promise<void>
}

export function createCursorEventGate(
  applyIgnoreState: (ignore: boolean) => Promise<void>,
): CursorEventGate {
  let stopped = false
  let operation = Promise.resolve()
  let stopOperation: Promise<void> | undefined

  const enqueue = (ignore: boolean, force = false) => {
    operation = operation
      .catch(() => undefined)
      .then(async () => {
        if (stopped && ignore && !force) return
        await applyIgnoreState(ignore)
      })
    return operation
  }

  return {
    setIgnoring(ignore) {
      if (stopped) return operation
      return enqueue(ignore)
    },
    stop() {
      if (stopOperation) return stopOperation
      stopped = true
      stopOperation = enqueue(false, true).catch(() => enqueue(false, true))
      return stopOperation
    },
  }
}

export function startOrbHitTest(getRegions: () => readonly HitRegion[]): () => Promise<void> {
  if (!isTauriRuntime()) return async () => undefined

  const appWindow = getCurrentWindow()
  let stopped = false
  let checking = false
  let currentlyIgnoring = false
  const cursorEventGate = createCursorEventGate((ignore) =>
    appWindow.setIgnoreCursorEvents(ignore),
  )

  const check = async () => {
    if (stopped || checking) return
    checking = true
    try {
      const [cursor, position, scaleFactor] = await Promise.all([
        cursorPosition(),
        appWindow.outerPosition(),
        appWindow.scaleFactor(),
      ])
      const localPoint = {
        x: (cursor.x - position.x) / scaleFactor,
        y: (cursor.y - position.y) / scaleFactor,
      }
      if (stopped) return
      const shouldReceiveEvents = getRegions().some((region) => containsPoint(region, localPoint))
      const shouldIgnore = !shouldReceiveEvents
      if (shouldIgnore !== currentlyIgnoring) {
        await cursorEventGate.setIgnoring(shouldIgnore)
        currentlyIgnoring = shouldIgnore
      }
    } catch {
      if (!stopped) {
        await cursorEventGate.setIgnoring(false).catch(() => undefined)
        currentlyIgnoring = false
      }
    } finally {
      checking = false
    }
  }

  const timer = window.setInterval(check, 48)
  void check()

  return async () => {
    stopped = true
    window.clearInterval(timer)
    await cursorEventGate.stop().catch(() => undefined)
  }
}

export async function onPanelNavigate(
  handler: (payload: PanelNavigationPayload) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<PanelNavigationPayload>(PANEL_NAVIGATE_EVENT, (event) => {
      handler(event.payload)
    })
  }

  const listener = (event: Event) => {
    handler((event as CustomEvent<PanelNavigationPayload>).detail)
  }
  window.addEventListener(PANEL_NAVIGATE_EVENT, listener)
  return () => window.removeEventListener(PANEL_NAVIGATE_EVENT, listener)
}
