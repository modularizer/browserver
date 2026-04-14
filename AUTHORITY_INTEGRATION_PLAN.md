# Plan: `plat/authority` Namespace Integration into `browserver` Studio

**TL;DR:** Add Google OAuth identity and namespace ownership to `browserver` without touching its static-site nature. Three new modules (`identity.ts` store, `namespace.ts` store, `authorityClient.ts` fetch wrapper) supply all authority-API interaction. Two new UI surfaces (`NamespaceDashboard.tsx` panel, `StatusBar` identity chip) wire into the existing Zustand + workbench panel system. Anonymous users can still use the full IDE without signing in, but hosting is hard-gated to `dmz/*` server names unless signed in.

---

## Architecture Diagram

```
┌─────────────────────── browserver (static site) ─────────────────────────┐
│                                                                            │
│  App.tsx                                                                   │
│  ├─ on mount: check ?oauthGrant= → identityStore.handleOAuthCallback()    │
│  └─ clean URL with history.replaceState()                                  │
│                                                                            │
│  store/identity.ts  (Zustand + localStorage "browserver:identity")         │
│  ├─ state: { googleSub, email, name, picture, idToken, signedInAt } | null │
│  ├─ signIn()    → navigate to VITE_AUTHORITY_URL/oauthStart?redirect_uri   │
│  ├─ handleOAuthCallback(grantId) → POST /oauthExchange → persist           │
│  └─ signOut()   → clear localStorage key                                   │
│                                                                            │
│  store/namespace.ts (Zustand + localStorage TTL cache)                     │
│  ├─ state: { namespaces[], requests[], loading, error }                    │
│  ├─ fetchMyNamespaces(googleSub)                                           │
│  ├─ fetchMyRequests(googleSub)                                             │
│  ├─ requestNamespace(ns, meta)                                             │
│  └─ fetchServerNames / addServerName / removeServerName                    │
│                                                                            │
│  runtime/authorityClient.ts  (plain fetch, no backend proxy)               │
│  ├─ oauthExchange(grantId)                                                 │
│  ├─ getMyNamespaces(sub) / getMyRequests(sub)                              │
│  └─ requestNamespace / addServerName / removeServerName                    │
│                                                                            │
│  shell/NamespaceDashboard.tsx  (new bottom-panel tab: "Namespace")         │
│  ├─ identity header: avatar / email / sign-in button                       │
│  ├─ My Namespaces list (expandable rows → server names within each ns)     │
│  ├─ Request Namespace inline form                                          │
│  └─ Pending Requests list with status chips                                │
│                                                                            │
│  shell/StatusBar.tsx  (identity chip added, right side)                    │
│                                                                            │
│  runtime/localTsRuntime.ts  +  shell/ServersSection.tsx                    │
│  └─ server-name validation gate (hard dmz/ enforcement when anonymous)     │
│                                                                            │
│  store/workspace.ts (types: BottomPanelId, EditorViewId)                   │
│  └─ add 'namespace' to both union types                                    │
│                                                                            │
│  shell/EditorViewHost.tsx                                                  │
│  └─ add if (viewId === 'namespace') return <NamespaceDashboard />          │
│                                                                            │
│  shell/BottomPanel.tsx                                                     │
│  └─ add { id: 'namespace', label: 'Namespace', ... } to tabs[]             │
│                                                                            │
│  apps/studio/.env.example  (VITE_AUTHORITY_URL)                            │
└────────────────────────────────────────────────────────────────────────────┘
                │  plain fetch (CORS-enabled)    │  WebSocket
                ▼                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│            plat/authority  (external Node.js service)                      │
│  GET  /oauthStart                                                          │
│  GET  /oauthCallback  →  redirect to browserver/?oauthGrant={id}           │
│  POST /oauthExchange  →  { sub, email, name, picture, id_token }           │
│  POST /request        →  namespace ownership request                       │
│  GET  /namespaces?sub=  →  approved namespaces for user                    │
│  GET  /requests?sub=    →  pending/rejected requests for user              │
│  GET  /servers?ns=      →  server names within a namespace                 │
│  POST /servers          →  register server name                            │
│  DELETE /servers/:name  →  remove server name                              │
│  wss://authority/ws/host  (host registration — via plat's registerWithAuthority,
│                             NOT browserver code)                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## The Core Rule (unchanged from authority README)

```typescript
// This routing rule already exists in plat/authority/src/services/routing-service.ts
// browserver respects it — anonymous users are restricted to dmz/ naming

mode = serverName.startsWith("dmz/") ? "dmz" : "authority"
```

- `dmz/*` → public MQTT, no ownership, no auth, works today and forever
- everything else → authority mode, requires namespace ownership + Google auth

---

## Phased Implementation Steps

### Phase 1 — Identity Foundation (no UI, no breaking changes)

**Step 1.1 — Create `apps/studio/src/runtime/authorityClient.ts`**

Thin, typed `fetch` wrapper for all authority endpoints. Reads `import.meta.env.VITE_AUTHORITY_URL`. All functions throw on non-2xx. Pure async functions, no side effects, no store dependencies.

Key exports:
```typescript
export interface OAuthExchangeResult {
  sub: string
  email?: string
  name?: string
  picture?: string
  id_token?: string
}

export interface ApprovedNamespace {
  namespace: string
  approvedAt: number
}

export interface NamespaceRequestRecord {
  id: string
  namespace: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  submittedAt: number
}

export async function oauthExchange(grantId: string): Promise<OAuthExchangeResult>
export async function getMyNamespaces(googleSub: string): Promise<ApprovedNamespace[]>
export async function getMyRequests(googleSub: string): Promise<NamespaceRequestRecord[]>
export async function requestNamespace(googleSub: string, namespace: string, metadata?: Record<string, unknown>): Promise<{ ok: boolean }>
export async function getServerNames(namespace: string): Promise<string[]>
export async function addServerName(googleSub: string, namespace: string, serverName: string): Promise<{ ok: boolean }>
export async function removeServerName(googleSub: string, serverName: string): Promise<{ ok: boolean }>
```

**Step 1.2 — Create `apps/studio/src/store/identity.ts`**

Zustand store modelled after `trust.ts`. Persisted to `localStorage` key `browserver:identity`.

```typescript
export interface IdentityUser {
  googleSub: string
  email: string
  name: string
  picture: string
  idToken: string
  signedInAt: number
}

interface IdentityState {
  user: IdentityUser | null
  // Redirect browser to authority /oauthStart with redirect_uri = window.location.origin + '/'
  signIn: () => void
  // Consume grant_id from URL, call oauthExchange, persist result
  handleOAuthCallback: (grantId: string) => Promise<void>
  // Clear stored identity
  signOut: () => void
}

export const selectIsSignedIn = (state: IdentityState) => state.user !== null
export const useIdentityStore = create<IdentityState>()(...)
```

Hydrated synchronously from `localStorage` on module load (plain JSON). No async hydration needed.

**Step 1.3 — Add OAuth callback detection to `apps/studio/src/App.tsx`**

In an early top-level `useEffect` (runs before workspace hydration has side-effects on the URL):

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const grantId = params.get('oauthGrant')
  if (grantId) {
    void useIdentityStore.getState().handleOAuthCallback(grantId)
    history.replaceState({}, '', window.location.pathname)
  }
}, [])
```

Additive — no existing behavior changes.

**Step 1.4 — Add `apps/studio/.env.example`**

```
# URL of the deployed plat authority server (enables namespace/identity features)
VITE_AUTHORITY_URL=https://authority.css.run
```

If `VITE_AUTHORITY_URL` is empty/undefined, `authorityClient.ts` throws with a clear message; the identity and namespace stores catch this and surface a "authority not configured" note instead of crashing.

---

### Phase 2 — Namespace Store

**Step 2.1 — Create `apps/studio/src/store/namespace.ts`**

Zustand store. Calls `authorityClient.*` passing `googleSub` from `useIdentityStore.getState()`. Responses cached in `localStorage` key `browserver:namespace:cache` with 5-minute TTL. All fetch actions are no-ops (silent returns) when user is not signed in.

```typescript
export interface NamespaceState {
  namespaces: ApprovedNamespace[]
  requests: NamespaceRequestRecord[]
  serverNames: Record<string, string[]>  // namespace → server names[]
  loading: boolean
  error: string | null
  isSessionExpired: boolean

  fetchMyNamespaces: () => Promise<void>
  fetchMyRequests: () => Promise<void>
  requestNamespace: (namespace: string, metadata?: Record<string, unknown>) => Promise<void>
  fetchServerNames: (namespace: string) => Promise<void>
  addServerName: (namespace: string, serverName: string) => Promise<void>
  removeServerName: (namespace: string, serverName: string) => Promise<void>
  invalidateCache: () => void
}

export const useNamespaceStore = create<NamespaceState>()(...)
```

Auto-refresh on sign-in/out by subscribing to identity store changes (use Zustand's `subscribe`).

---

### Phase 3 — Namespace Dashboard Panel

**Step 3.1 — Create `apps/studio/src/shell/NamespaceDashboard.tsx`**

Dense, IDE-style panel. Zero padding orgy — uses the same `rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2` style as `TrustPanel`. Three sections:

**(a) Identity Header**
- If signed out: compact banner with "Sign in with Google" button → `identityStore.signIn()`
- If signed in: one-line row with: colored initial avatar circle, `name`, `email`, `sign out` link

**(b) My Namespaces**
- Compact list of approved namespaces (one row each)
- Click/expand to reveal server names list inline
- Each server name: `serverName` + trash button
- `+` inline input at bottom of expanded list to add a server name
- Loading / error states in-line (no separate loading screen)

**(c) Request Namespace**
- Collapsed by default into a single `[+ Request namespace]` link
- Expands to: `<input placeholder="my-namespace" />` + optional collapsible textarea for use-case + `Request` button
- Inline success/error feedback (no modal)

**(d) Pending & Past Requests**
- Compact table: namespace | date | status chip (`pending`=amber, `approved`=green, `rejected`=red)
- `rejectionReason` shown as tooltip on rejected rows

When session is expired: show a `[session expired — re-authenticate]` strip that calls `identityStore.signIn()`.

**Step 3.2 — Extend `apps/studio/src/store/workspace.ts`**

Two targeted union extensions:

```typescript
// Before:
export type BottomPanelId = 'logs' | 'calls' | 'build' | 'problems' | 'client' | 'data' | 'trust' | 'history'
// After:
export type BottomPanelId = 'logs' | 'calls' | 'build' | 'problems' | 'client' | 'data' | 'trust' | 'history' | 'namespace'

// Before:
export type EditorViewId = 'inspect' | 'api' | 'client' | 'swagger' | 'redoc' | 'data' | 'trust' | 'history' | 'logs' | 'calls' | 'build' | 'problems' | 'browser'
// After: add 'namespace'
```

Add to `editorViewDefinitions`:
```typescript
{ id: 'namespace', label: 'Namespace' },
```

~3 line diff. No logic changes.

**Step 3.3 — Extend `apps/studio/src/shell/BottomPanel.tsx`**

Add namespace tab alongside the existing trust/history tabs. Render `<NamespaceDashboard />` in the body case (same pattern as `TrustPanel`). Add to `bottomTabToViewId` mapping.

**Step 3.4 — Extend `apps/studio/src/shell/EditorViewHost.tsx`**

```typescript
if (viewId === 'namespace') return <NamespaceDashboard />
```

Import `NamespaceDashboard`. ~3 line diff.

---

### Phase 4 — Status Bar Identity Chip & Command Palette

**Step 4.1 — Extend `apps/studio/src/shell/StatusBar.tsx`**

Add `useIdentityStore` subscription. In the right-side group (before theme label), add a compact chip:

```tsx
// If signed in:
<button
  onClick={() => setActiveBottomPanel('namespace')}
  className="opacity-70 hover:opacity-100"
  title={user.email}
>
  {user.name.split(' ')[0]}
</button>

// If anonymous:
<button
  onClick={() => setActiveBottomPanel('namespace')}
  className="opacity-50 hover:opacity-70"
  title="Sign in to use custom namespaces"
>
  anon
</button>
```

Same `text-[10px]` styling as all other status bar elements. ~10 line diff.

**Step 4.2 — Extend command palette in `apps/studio/src/store/commandPalette.ts` (or `App.tsx`)**

Two additive entries:
- `panel.namespace` → `Show Namespace panel` → opens bottom panel 'namespace'
- `identity.signout` → `Sign out` → `identityStore.signOut()` (only shown when signed in)

---

### Phase 5 — Server Name Validation

**Step 5.1 — Extend `apps/studio/src/shell/ServersSection.tsx`**

Add a namespace indicator to `ServerCard` (the component that shows a running/stopped server). Reads `useIdentityStore` and `useNamespaceStore`. Displays:

- Anonymous + `dmz/` prefix → dim `[dmz]` chip, nothing alarming
- Anonymous + no `dmz/` → red `blocked: sign in or use dmz/` chip with tooltip "Anonymous hosting is limited to dmz/*"
- Signed in + owned namespace → green `✓` chip
- Signed in + unowned namespace → red `blocked: namespace not owned` chip

This is a **hard gate in the UI** — disable launch controls when the current server name is not allowed.

**Step 5.2 — Extend `apps/studio/src/runtime/localTsRuntime.ts`**

In the pre-launch guard, add hard enforcement. If user is anonymous and server name doesn't start with `dmz/`, reject launch immediately:

```typescript
if (!identityUser && !serverName.startsWith('dmz/')) {
  throw new Error('Anonymous hosting is restricted to dmz/* server names. Sign in to use custom namespaces.')
}
```

This is a **hard runtime safety check** in addition to UI disabling, so direct calls cannot bypass the rule. ~12 line diff.

---

## File-by-File Breakdown

| File | Status | Lines (est.) | Description |
|------|--------|:---:|-------------|
| `runtime/authorityClient.ts` | **NEW** | ~100 | Pure fetch wrapper. All authority API calls. Reads `VITE_AUTHORITY_URL`. |
| `store/identity.ts` | **NEW** | ~100 | Zustand identity store. Persisted to `localStorage`. OAuth redirect + exchange logic. |
| `store/namespace.ts` | **NEW** | ~150 | Zustand namespace store. Calls `authorityClient`. TTL cache. Auto-refresh on sign-in. |
| `shell/NamespaceDashboard.tsx` | **NEW** | ~250 | Dense IDE panel: identity header + namespaces list + request form + pending requests. |
| `store/workspace.ts` | **MODIFY** | +3 | Extend `BottomPanelId`, `EditorViewId`, `editorViewDefinitions`. |
| `shell/BottomPanel.tsx` | **MODIFY** | +15 | Add namespace tab + render case. Mirrors trust/history pattern. |
| `shell/EditorViewHost.tsx` | **MODIFY** | +3 | Add `'namespace'` case → `<NamespaceDashboard />`. |
| `shell/StatusBar.tsx` | **MODIFY** | +10 | Identity chip (anon / signed-in name). Opens namespace panel on click. |
| `shell/ServersSection.tsx` | **MODIFY** | +25 | Namespace ownership status chips on `ServerCard` plus disabled launch control when blocked. |
| `runtime/localTsRuntime.ts` | **MODIFY** | +12 | Hard runtime guard: reject anonymous non-`dmz/*` launches and signed-in unowned namespaces. |
| `App.tsx` | **MODIFY** | +20 | `?oauthGrant=` detection on mount. 2 new command palette entries. |
| `.env.example` | **NEW** | +3 | `VITE_AUTHORITY_URL` with default value. |

**Total net new code: ~650 lines.** All existing code is unchanged except targeted additive extensions.

---

## Key Decisions / Tradeoffs

### 1. Bottom panel tab vs. right panel tab for NamespaceDashboard
Placing it as a bottom panel tab is preferable: it requires touching fewer type unions; the dashboard is context-independent (not bound to a file/runtime); it parallels how `Trust` lives in the bottom panel. The right panel tab can be added later as a drag-target if needed (same pattern, ~20 more lines).

### 2. Lazy namespace cache vs. eager fetch
Namespace data is fetched on demand (panel open) and cached with a TTL — not eagerly at sign-in. This avoids blocking startup, respects offline-first/no-network-required-for-editing, and doesn't add latency to the main workspace hydration path.

### 3. Hard server-name policy enforcement
The rule is enforced in two places: UI (launch control disabled with explicit reason) and runtime (guard throws before launch). This guarantees anonymous users can only host `dmz/*`, while still preserving static-site behavior and full IDE access for unsigned users.

### 4. `id_token` storage
Storing the Google `id_token` in `localStorage` is consistent with how trust key pairs are stored today. Token expiry (~1h) is handled gracefully: the namespace store detects 401 responses, sets `isSessionExpired: true`, and the dashboard surfaces a "re-authenticate" strip.

### 5. Authority URL baked at build time
`VITE_AUTHORITY_URL` is resolved at build time (`import.meta.env`). This is correct for a static-site product: no runtime config endpoint needed. Self-hosted deployments rebuild with their own URL. If the var is absent, authority features degrade gracefully (no crash, just a "not configured" note in the dashboard).

### 6. No silent auto-prefixing
Per AGENTS.md: "do not fake runtime flows." The launcher must not rewrite names automatically. Invalid names are blocked with explicit actionable errors ("use `dmz/...`" or "sign in and request a namespace").

---

## What Stays Unchanged (Backward Compatibility Guarantees)

- Anonymous users can open, edit, run clients, inspect history/logs, and use all IDE features without sign-in
- All existing stores (`trust`, `workspace`, `runtime`, `database`, `checkpoints`, `history`, `layout`) are **unmodified in behavior**
- `BottomPanel`, `RightPanel`, `EditorViewHost` changes are purely **additive** (new tab/case, never replacing existing ones)
- Anonymous hosting is restricted to `dmz/*` by both UI and runtime guard; this is intentional policy, not a regression
- Project snapshots/exports/imports are unaffected — `identity` state is never included in workspace bundles (it's user-global credentials, not project state)
- Single-file packaging (`vite-plugin-singlefile`) continues to work — `authorityClient.ts` uses only browser-native `fetch`, zero Node.js dependencies
- The `plat` CSS transport, MQTT signaling, WebRTC handshake, and `dmz/` routing are completely untouched

---

## Future Enhancements (not in this plan, but designed for)

### Delegated / self-hosted authority support (from FUTURE.md)
The `authorityClient.ts` abstraction and `IdentityState.idToken` field are already positioned to support delegated authority discovery (a user pointing browserver at their own authority instance). This would be an additional field in the identity store and a toggle in the dashboard — no architectural changes needed.

### Authorized sub-path hosting
The authority's `AuthorityAuthorizeSubpathHostMessage` type already supports assigning other Google accounts to host under a user's namespace subpaths. The `NamespaceDashboard` can gain a "Collaborators" section per namespace row when this feature is ready on the authority side.

### Namespace usage stats & presence
The `wss://authority/ws/presence` endpoint provides server online/offline events. A future "Live" chip in the namespace dashboard (per server name) could subscribe to this socket and show real-time hosting status.

### Admin panel integration
The existing `authority/admin/` React app (approve/reject requests) is a separate deployment. If desired, its views could be embedded as a protected section of `NamespaceDashboard` for users with `isAdmin: true` in their Google profile record — surfaced by checking a `user.isAdmin` field returned from `oauthExchange`.

---

## OAuth Flow Reference (Static-Site Compatible)

```
1. User clicks "Sign in with Google" in NamespaceDashboard (or StatusBar chip)
   └─ identityStore.signIn()
      └─ window.location.href = `${VITE_AUTHORITY_URL}/oauthStart?redirect_uri=${encodeURIComponent(window.location.origin + '/')}`

2. Authority builds Google OAuth URL, redirects user-agent to accounts.google.com

3. User authenticates with Google

4. Google redirects to authority /oauthCallback
   └─ Authority creates one-time grant, redirects to:
      https://[browserver-origin]/?oauthGrant=<uuid>

5. App.tsx useEffect detects ?oauthGrant= on mount
   └─ identityStore.handleOAuthCallback(grantId)
      └─ POST {AUTHORITY_URL}/oauthExchange { grant_id }
         → { sub, email, name, picture, id_token }
         → stored in localStorage key "browserver:identity"
         → URL cleaned with history.replaceState()

6. identity store user is now non-null
   └─ namespace store auto-fetches approved namespaces
   └─ StatusBar chip shows user name
   └─ NamespaceDashboard shows identity header + namespaces
   └─ id_token available for plat's registerWithAuthority() calls
```

This flow is 100% static-site compatible. The redirect lands on the browserver origin (a static HTML file), and the grant exchange is a simple `fetch` POST to the authority server.


