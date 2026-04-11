import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SiteViewer } from './SiteViewer'
import './index.css'

// Route: /site/:serverName renders the site viewer (full-page, no IDE chrome)
// Everything else renders the normal IDE
function Root() {
  const path = window.location.pathname
  // Handle both /site/name and /browserver/site/name (GitHub Pages prefix)
  const siteMatch = path.match(/\/site\/([^/]+)/)
  if (siteMatch) {
    return <SiteViewer serverName={siteMatch[1]!} />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
