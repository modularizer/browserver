import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SiteViewer } from './SiteViewer'
import { samples } from './samples'
import { ACTIVE_WORKSPACE_KEY } from './store/workspace'
import { buildIdeRoutePath, parseStudioRoute } from './routing/studioRoute'
import { installCssServiceWorker } from './runtime/cssServiceWorker'
import './index.css'

void installCssServiceWorker().catch((err) => {
  console.error('[browserver] Failed to install css service worker', err)
})

function Root() {
  const [pathname, setPathname] = React.useState(() => window.location.pathname)
  React.useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const syncIdeRoute = React.useCallback((projectId: string, options?: { replace?: boolean }) => {
    const nextPath = buildIdeRoutePath(projectId, import.meta.env.BASE_URL)
    if (window.location.pathname === nextPath) return
    const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`
    if (options?.replace) {
      window.history.replaceState(null, '', nextUrl)
    } else {
      window.history.pushState(null, '', nextUrl)
    }
    setPathname(window.location.pathname)
  }, [])
  const route = parseStudioRoute(pathname, import.meta.env.BASE_URL)
  React.useEffect(() => {
    if (route.mode !== 'ide' || !route.projectName) return
    const canonicalPath = buildIdeRoutePath(route.projectName, import.meta.env.BASE_URL)
    if (window.location.pathname === canonicalPath) return
    window.history.replaceState(null, '', `${canonicalPath}${window.location.search}${window.location.hash}`)
    setPathname(window.location.pathname)
  }, [route.mode, route.projectName])
  React.useEffect(() => {
    if (route.mode !== 'ide' || route.projectName) return
    const redirectProjectId = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? samples[0]?.id
    if (!redirectProjectId) return
    syncIdeRoute(redirectProjectId, { replace: true })
  }, [route.mode, route.projectName, syncIdeRoute])
  if (route.mode === 'ide' && !route.projectName) {
    return null
  }
  if (route.mode === 'preview' && route.serverName) {
    return (
      <SiteViewer
        serverName={route.serverName}
        previewPath={route.previewPath}
        initialApiMode={route.apiViewMode}
        previewMode={route.previewMode}
        targetUrl={route.targetUrl}
      />
    )
  }
  return (
    <App
      key={`ide:${route.projectName ?? 'default'}`}
      initialProjectId={route.projectName ?? undefined}
      onProjectRouteChange={syncIdeRoute}
    />
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
