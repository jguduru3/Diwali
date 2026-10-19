// Types for the service worker build only (tsconfig.sw.json).
declare interface ServiceWorkerGlobalScope {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
}
