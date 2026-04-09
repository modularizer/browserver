import { useState } from 'react'
import { Modal } from './Modal'

const WELCOME_KEY = 'browserver.welcomed'

function hasSeenWelcome(): boolean {
  try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return false }
}
function markWelcomeSeen(): void {
  try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* ignore */ }
}

interface WelcomeModalProps {
  forceOpen?: boolean
  onForceClose?: () => void
}

export function WelcomeModal({ forceOpen, onForceClose }: WelcomeModalProps = {}) {
  const [autoOpen, setAutoOpen] = useState(() => !hasSeenWelcome())
  const open = forceOpen || autoOpen
  const handleClose = () => { markWelcomeSeen(); setAutoOpen(false); onForceClose?.() }

  return (
    <Modal
      open={open}
      title="Welcome to browserver"
      onClose={handleClose}
      actions={
        <button onClick={handleClose} className="rounded bg-bs-accent px-3 py-1 text-[11px] text-bs-accent-text">
          got it, let's go →
        </button>
      }
    >
      <div className="space-y-4 text-[12px]">

        {/* Tagline */}
        <p className="text-bs-text leading-relaxed">
          <span className="font-semibold text-bs-accent">browserver</span> is a browser-native IDE for writing, launching, and monitoring real servers — with zero backend, zero cloud, and zero install.
        </p>

        {/* Normal vs browserver */}
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Why this is weird</div>
          <p className="text-bs-text-muted leading-relaxed">
            Every website, app, or API you use sends your requests to some company's servers in a data center. Even "serverless" is just someone else's computer. The server lives in the cloud — you're always just a client calling into it.
          </p>
          <p className="text-bs-text leading-relaxed">
            browserver flips this. You write a server class, hit <span className="font-medium">Run</span>, and your browser tab <em>becomes</em> that server. Other tabs, pages, or devices connect to it directly — peer‑to‑peer — after a tiny handshake. No data center. No company server in the loop.
          </p>
        </div>

        {/* Core concepts */}
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Core concepts</div>
          <ul className="space-y-1 text-bs-text-muted">
            <li className="flex gap-2">
              <span>🧠</span>
              <span>
                <span className="font-medium text-bs-text">server</span> — a TypeScript or Python class running live inside your browser tab, exposing typed API methods.{' '}
                <span className="text-bs-text-faint">Wait — Python? Yes, really. browserver runs a full CPython interpreter compiled to <span className="font-medium text-bs-text">WebAssembly</span> via Pyodide, right in your tab. No install. (Limitation: no raw sockets, no subprocesses, and only packages pre-built for Pyodide — but NumPy, pandas, and most of the scientific stack are included.)</span>
              </span>
            </li>
            <li className="flex gap-2">
              <span>👤</span>
              <span>
                <span className="font-medium text-bs-text">client</span> — auto-generated from the server's API shape; connects from any tab, page, or device on the network.{' '}
                Clients can also point at <em>any</em> standard server that exposes an <span className="font-medium text-bs-text">openapi.json</span> — cloud APIs, local services, whatever.{' '}
                <span className="text-bs-text-faint">But the heart of the project is connecting to browser-based <span className="font-medium text-bs-text">client-side servers</span> running in other tabs — no cloud, no backend, pure WebRTC.</span>
              </span>
            </li>
          </ul>
        </div>

        {/* Diagram */}
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">How peers find each other &amp; connect</div>
          <div className="overflow-x-auto rounded border border-bs-border bg-bs-bg-sidebar px-3 py-2 font-mono text-[10px] leading-[1.6] text-bs-text-muted">
            <pre className="whitespace-pre">{
`                         ┌──────────┐
           ┌──── ① ─────▶│   STUN   │◀──── ① ────┐
           │             │ (public  │             │
           │             │  addr)   │             │
  ┌────────┴───────┐     └──────────┘    ┌────────┴───────┐
  │   🧠 server    │     ┌──────────┐    │   👤 client    │
  │   (your tab)   │─②──▶│   MQTT   │◀②─│  (any device)  │
  │                │     │ (signal) │    │                │
  └────────────────┘     └──────────┘    └────────────────┘
           │                                      │
           └──────────── ③ WebRTC ────────────────┘
                    direct · encrypted
                  (no cloud in the loop)`
            }</pre>
          </div>
          <ul className="space-y-1 text-bs-text-muted">
            <li className="flex gap-2"><span>①</span><span><span className="font-medium text-bs-text">STUN</span> — each peer asks a public STUN server "what's my external IP and port?" so the other side knows how to reach it through NAT.</span></li>
            <li className="flex gap-2"><span>②</span><span><span className="font-medium text-bs-text">MQTT</span> — peers swap those addresses + connection info (SDP/ICE) through a lightweight pub/sub broker. No data is stored; it just passes messages.</span></li>
            <li className="flex gap-2"><span>③</span><span><span className="font-medium text-bs-text">WebRTC</span> — with addresses exchanged, an encrypted direct data channel opens between the two tabs. All RPC calls go through this; nothing touches a server.</span></li>
          </ul>
        </div>

        {/* Python / Pyodide — covered inline in Core concepts above */}

        {/* Prior work */}
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Prior work by modularizer</div>
          <ul className="space-y-1 text-bs-text-muted">
            <li className="flex gap-2">
              <span>⚙️</span>
              <span><a href="https://modularizer.github.io/plat/" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">plat</a> — the peer-to-peer transport layer browserver is built on. Handles MQTT signaling, STUN/ICE, WebRTC data channels, client codegen, and OpenAPI.</span>
            </li>
            <li className="flex gap-2">
              <span>💬</span>
              <span><a href="https://modularizer.github.io/rtchat/" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">rtchat</a> — browser-to-browser chat with no backend, built on the same WebRTC peer model that powers browserver's connections.</span>
            </li>
            <li className="flex gap-2">
              <span>🎲</span>
              <span><a href="https://modularizer.github.io/gameboard/#quoridor.tortoise.p2" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">gameboard</a> — peer-to-peer game board (Quoridor and others) demonstrating real-time browser-to-browser state sync over WebRTC.</span>
            </li>
            <li className="flex gap-2">
              <span>🐍</span>
              <span><a href="https://modularizer.github.io/pyprez/" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">pyprez</a> — Python in the browser via Pyodide/WebAssembly, the foundation for browserver's in-browser Python runtime.</span>
            </li>
            <li className="flex gap-2">
              <span>🔧</span>
              <span><a href="https://github.com/modularizer/socketwrench" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">socketwrench</a> — a Python library for ergonomic WebSocket and HTTP server wiring, useful alongside browserver for traditional server targets.</span>
            </li>
            <li className="flex gap-2">
              <span>🗄️</span>
              <span><a href="https://github.com/modularizer/xpdb" target="_blank" rel="noreferrer" className="font-medium text-bs-accent hover:underline">xpdb</a> — an in-browser, tabular, SQL-like database that powers browserver's client-side data layer. Each hosted server gets its own editable xpdb instance.</span>
            </li>
          </ul>
        </div>

        {/* Footer */}
        <p className="border-t border-bs-border pt-3 text-[11px] text-bs-text-faint">
          ✱ <em>The only "cloud" touches:</em> a one-time load of the IDE's HTML/JS, and the STUN + MQTT handshake (a few KB, no stored data). After that — pure tab-to-tab. Everything else — projects, databases, trust records — lives in <span className="text-bs-text">your browser</span>.
        </p>

      </div>
    </Modal>
  )
}

