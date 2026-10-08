export type ContextReading = { tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      reading: ContextReading | null
      isHidden: boolean
      warnedAt: number
    }
  }
}
