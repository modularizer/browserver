# Plan: Static File Serving in Browserver Client-Side Servers

## Context

plat now supports `StaticFolder` (class variables) and `FileResponse` (method return type) for static file serving. The client-side server (`src/client-side-server/server.ts`) already handles both — it resolves static folder paths before API routes and serializes file responses as `{ _type: 'file', filename, contentType, content: base64, headers }`.

Browserver manages workspaces with multi-file support. Each workspace has files stored in IndexedDB (`@browserver/storage`) as `StoredWorkspaceFile[]` with `{ path, language, content, updatedAt }`. Server code is launched via `startClientSideServerFromSource()` from plat.

**The goal**: let browserver users add static files (HTML, CSS, images, etc.) to their workspace and serve them from their client-side server using `StaticFolder`.

## What already works (no changes needed)

If a user writes a controller with a `StaticFolder` using an in-memory file map, it works today:

```ts
import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { StaticFolder } from '@modularizer/plat/static'

class MyApp {
  site = new StaticFolder({
    'index.html': '<h1>Hello</h1>',
    'style.css': 'body { color: red }',
  })

  async greet() { return 'hi' }
}

export default serveClientSideServer('my-app', [MyApp])
```

This already works because `MemoryFileSystem` handles `Record<string, string>` and the client-side server scans for `StaticFolder` instances on controller properties.

## What needs work

### 1. Expose workspace files as a VirtualFileSystem

Users shouldn't have to inline file contents into their server code. Browserver already stores workspace files in IndexedDB — we should let users reference them:

```ts
import { StaticFolder } from '@modularizer/plat/static'

class MyApp {
  // __workspaceFiles is injected by browserver at runtime
  assets = new StaticFolder(__workspaceFiles, { 
    exclude: ['**/*.ts', '**/*.tsx'],
    index: 'index.html' 
  })
}
```

**Implementation:**

- **`apps/studio/src/runtime/localTsRuntime.ts`**: Before calling `startClientSideServerFromSource()`, build a `Record<string, string | { read(): string }>` from the workspace's non-code files and inject it as a global `__workspaceFiles` variable in the runtime context.

- **Filter logic**: Include files with extensions like `.html`, `.css`, `.json`, `.png`, `.jpg`, `.svg`, `.ico`, `.txt`, `.md`, `.woff`, `.woff2`. Exclude `.ts`, `.tsx`, `.js` source files (these are code, not static assets).

- **Lazy reads**: For large binary files, use the `{ read(): string }` form of `MemoryFileEntry` so content is only loaded from IndexedDB on demand.

```ts
// In localTsRuntime.ts, before startClientSideServerFromSource():
const staticFiles: Record<string, string> = {}
for (const file of workspace.files) {
  if (isStaticAsset(file.path)) {
    staticFiles[file.path] = file.content
  }
}
// Inject as global available to user code
globalThis.__workspaceFiles = staticFiles
```

### 2. Custom VirtualFileSystem backed by IndexedDB

For more dynamic use cases, create a `BrowserverFileSystem` that implements plat's `VirtualFileSystem` interface and reads directly from the workspace store:

**New file: `apps/studio/src/runtime/browserverFileSystem.ts`**

```ts
import type { VirtualFileSystem } from '@modularizer/plat/static'
import { loadWorkspaceSnapshot } from '@browserver/storage'

export class BrowserverFileSystem implements VirtualFileSystem {
  constructor(
    private workspaceId: string,
    private filter?: (path: string) => boolean,
  ) {}

  async list(path: string): Promise<string[]> {
    const snapshot = await loadWorkspaceSnapshot(this.workspaceId)
    if (!snapshot) return []
    const prefix = path ? path + '/' : ''
    const entries = new Set<string>()
    for (const file of snapshot.files) {
      if (!file.path.startsWith(prefix)) continue
      if (this.filter && !this.filter(file.path)) continue
      const rest = file.path.slice(prefix.length)
      const slash = rest.indexOf('/')
      entries.add(slash >= 0 ? rest.slice(0, slash + 1) : rest)
    }
    return [...entries]
  }

  async read(path: string): Promise<string | null> {
    const snapshot = await loadWorkspaceSnapshot(this.workspaceId)
    if (!snapshot) return null
    const file = snapshot.files.find(f => f.path === path)
    return file?.content ?? null
  }
}
```

This could be exposed to user code as `__browserverFS` or used internally.

### 3. Add static file types to the workspace file tree

**`packages/storage/src/index.ts`**: The `StoredWorkspaceLanguage` type already includes `'html'`, `'css'`, `'image'`, `'json'`, etc. No schema changes needed.

**`apps/studio/src/store/workspace.ts`**: The workspace store needs to support adding non-code files:
- Add a method or action to import files (drag-and-drop, file picker) as workspace files
- Binary files (images, fonts) should be stored as base64 in the `content` field
- The file tree sidebar should render non-code files with appropriate icons

### 4. UI for adding static assets

**File import**: Add a button or drag-and-drop zone in the file explorer sidebar to import static assets into the workspace. Use `FileReader` to read as text or base64.

**Visual indicator**: Mark files that are being served as static assets (e.g., a small globe icon or "static" badge) so users know which files their server exposes.

**Preview**: For HTML files being served, add a "Preview" tab that hits the client-side server's static route to render the page.

### 5. Update samples/templates

Add a sample workspace demonstrating static file serving:

**`apps/studio/src/samples/ts-static-site/`**:
```
server.ts    — controller with StaticFolder
index.html   — sample landing page  
style.css    — sample styles
```

```ts
// server.ts
import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { StaticFolder } from '@modularizer/plat/static'

class SiteApi {
  root = new StaticFolder(__workspaceFiles, {
    exclude: ['**/*.ts'],
    index: 'index.html',
  })

  async health() { return { ok: true } }
}

export default serveClientSideServer('static-site', [SiteApi])
```

### 6. Client proxy support for file responses

The browserver client panel (`apps/studio/src/runtime/openapiInvoke.ts`) invokes operations and displays results. It needs to handle file responses:

- When a response has `_type: 'file'`, render it appropriately:
  - HTML/text → render in an iframe or code block
  - Images → render as `<img>` with base64 src
  - Other → download link
- The client panel should also support navigating to static folder paths (e.g., `/assets/style.css`) and displaying the result

### 7. Monaco editor type declarations

**`apps/studio/src/editor/setupMonaco.ts`**: Add type declarations for:
- `StaticFolder` class (constructor overloads, opts)
- `FileResponse` class (from() factory)
- `__workspaceFiles` global (the injected workspace files map)

This gives users autocomplete when writing static file serving code.

## Implementation order

1. **Monaco types** — add `StaticFolder`, `FileResponse`, `__workspaceFiles` declarations to setupMonaco.ts
2. **`__workspaceFiles` injection** — modify localTsRuntime.ts to build and inject the files map
3. **BrowserverFileSystem** — new file implementing VirtualFileSystem over IndexedDB
4. **File import UI** — drag-and-drop / file picker for adding static assets to workspace
5. **Sample workspace** — `ts-static-site` sample demonstrating the feature
6. **Client panel file rendering** — handle `_type: 'file'` responses in the UI
7. **Python runtime** — same `__workspaceFiles` injection in pythonRuntime.ts (once plat-python supports StaticFolder)

## Dependencies

- `@modularizer/plat` >= 0.8.0 (includes `StaticFolder`, `FileResponse`, client-side server support)
- No new npm packages needed — everything builds on plat's existing `MemoryFileSystem` and `VirtualFileSystem`
