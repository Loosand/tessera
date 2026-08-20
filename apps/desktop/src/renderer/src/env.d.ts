import type { DesktopApi } from "@tessera/contracts"

declare global {
  interface Window {
    tessera: DesktopApi
  }
}
