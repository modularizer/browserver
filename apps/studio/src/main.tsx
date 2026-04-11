import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SiteViewer } from './SiteViewer'
import { parseStudioRoute } from './routing/studioRoute'
import './index.css'

function Root() {
  const route = parseStudioRoute(window.location.pathname, import.meta.env.BASE_URL)

  if (route.mode === 'preview' && route.serverName) {
    return <SiteViewer serverName={route.serverName} />
  }

  return <App initialProjectId={route.projectName ?? undefined} />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
