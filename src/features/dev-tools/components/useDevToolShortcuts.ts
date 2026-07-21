import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

export function useDevToolShortcuts(actions: {
  run: () => void
  copy: () => void
  focus: () => void
}) {
  let listening = false
  const handler = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key === 'Enter') {
      event.preventDefault()
      actions.run()
    } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      actions.copy()
    } else if (event.key.toLowerCase() === 'k') {
      event.preventDefault()
      actions.focus()
    }
  }
  const start = () => {
    if (listening) return
    window.addEventListener('keydown', handler)
    listening = true
  }
  const stop = () => {
    window.removeEventListener('keydown', handler)
    listening = false
  }
  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)
}
