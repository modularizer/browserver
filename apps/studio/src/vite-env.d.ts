/// <reference types="vite/client" />

import type { DesktopProfileBundle } from './config/desktopProfileBundle'

interface ImportMetaEnv {
  readonly VITE_AUTHORITY_URL?: string
  readonly VITE_SITE_VIEWER_ORIGIN?: string
}

declare global {
  interface BrowserverDesktopLaunchProfile {
    profileId: string
    bundlePath: string
    bundle: DesktopProfileBundle
  }

  interface BrowserverDesktopBridge {
    isDesktop: true
    getLaunchProfile: () => Promise<BrowserverDesktopLaunchProfile | null>
    importDesktopProfile: () => Promise<BrowserverDesktopLaunchProfile | null>
  }

  interface Window {
    browserverDesktop?: BrowserverDesktopBridge
  }
}

export {}
