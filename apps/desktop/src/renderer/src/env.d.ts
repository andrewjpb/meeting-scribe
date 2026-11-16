import type { ScribeApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposto pelo preload (src/preload/index.ts). */
    readonly __scribeApi: ScribeApi
  }
}

export {}
