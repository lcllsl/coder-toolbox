import { defineStore } from 'pinia'

export type ToastTone = 'neutral' | 'success' | 'warning'

export interface ToastMessage {
  id: number
  message: string
  tone: ToastTone
}

let nextToastId = 1

export const useFeedbackStore = defineStore('feedback', {
  state: () => ({
    toasts: [] as ToastMessage[],
  }),
  actions: {
    notify(message: string, tone: ToastTone = 'neutral', duration = 2_400) {
      const id = nextToastId++
      this.toasts.push({ id, message, tone })
      window.setTimeout(() => this.dismiss(id), duration)
      return id
    },
    dismiss(id: number) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
  },
})
