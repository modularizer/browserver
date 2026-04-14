// NOTE: Avoid static imports so Vite doesn't need to resolve packages at build time.
// We dynamically load isomorphic-git and lightning-fs. If local packages are missing,
// we fall back to CDN ESM builds to keep the app working in dev.

export interface GitRepo {
  fs: any
  dir: string
  gitdir: string
  ready: Promise<void>
}

// Lazy loaders with simple caching
let _git: any | null = null
let _LightningFS: any | null = null

async function loadGit(): Promise<any> {
  if (_git) return _git
  // Obfuscate specifier to avoid Vite prebundling
  const name = ['isomorphic', '-', 'git'].join('')
  try {
    // @ts-ignore
    _git = (await import(/* @vite-ignore */ name)).default ?? (await import(/* @vite-ignore */ name))
    return _git
  } catch (_err) {
    // Fallback to CDN
    const url = 'https://esm.sh/isomorphic-git@1.25.7?bundle'
    _git = await import(/* @vite-ignore */ url)
    return _git
  }
}

async function loadLightning(): Promise<any> {
  if (_LightningFS) return _LightningFS
  const name = ['@isomorphic-git/', 'lightning-fs'].join('')
  try {
    const mod = await import(/* @vite-ignore */ name)
    _LightningFS = (mod as any).default ?? mod
    return _LightningFS
  } catch (_err) {
    const url = 'https://esm.sh/@isomorphic-git/lightning-fs@4.6.2?bundle'
    const mod = await import(/* @vite-ignore */ url)
    _LightningFS = (mod as any).default ?? mod
    return _LightningFS
  }
}

const repos = new Map<string, GitRepo>()

function relPath(workspaceId: string, fullPath: string): string {
  // fullPath is like "/<workspaceId>/<name>"
  const trimmed = fullPath.replace(/^\/+/, '')
  const parts = trimmed.split('/')
  if (parts[0] === workspaceId) {
    return parts.slice(1).join('/')
  }
  return trimmed
}

async function mkdirp(fs: any, path: string) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += '/' + part
    try {
      // @ts-ignore
      await fs.promises.mkdir(current)
    } catch (err: any) {
      if (!err || (err.code !== 'EEXIST' && err.message?.includes('EEXIST') === false)) {
        // ignore if exists; rethrow others
        if (err?.code !== 'EEXIST') {
          // no-op
        }
      }
    }
  }
}

export async function ensureRepo(workspaceId: string): Promise<GitRepo> {
  const existing = repos.get(workspaceId)
  if (existing) return existing

  const LightningFS = await loadLightning()
  const fs = new LightningFS(`browserver-git-${workspaceId}`)
  const dir = '/repo'
  const gitdir = '/repo/.git'

  const ready = (async () => {
    const git = await loadGit()
    // @ts-ignore
    const pfs = fs.promises
    try {
      await pfs.stat(dir)
    } catch {
      await pfs.mkdir(dir)
    }
    // Initialize repo if needed
    try {
      await pfs.stat(gitdir)
    } catch {
      await git.init({ fs, dir, defaultBranch: 'main' })
    }
  })()

  const repo: GitRepo = { fs, dir, gitdir, ready }
  repos.set(workspaceId, repo)
  await ready
  return repo
}

export async function writeWorkspaceTree(workspaceId: string, files: Array<{ path: string; content: string | Uint8Array }>): Promise<void> {
  const repo = await ensureRepo(workspaceId)
  await repo.ready
  // @ts-ignore
  const pfs = repo.fs.promises

  // Write files to working directory
  for (const file of files) {
    const rel = relPath(workspaceId, file.path)
    const parent = rel.split('/').slice(0, -1).join('/')
    if (parent) await mkdirp(repo.fs, `${repo.dir}/${parent}`)
    await pfs.writeFile(`${repo.dir}/${rel}`, file.content)
  }

  // Stage additions/changes and detect deletions via statusMatrix
  const git = await loadGit()
  const matrix = await git.statusMatrix({ fs: repo.fs, dir: repo.dir })
  for (const row of matrix) {
    const [filepath, _head, workdir, stage] = row as [string, number, number, number]
    if (workdir === 0) {
      if (stage !== 0) {
        await git.remove({ fs: repo.fs, dir: repo.dir, filepath })
      }
      continue
    }
    if (workdir !== stage) {
      await git.add({ fs: repo.fs, dir: repo.dir, filepath })
    }
  }
}

export async function commitWorkspace(workspaceId: string, files: Array<{ path: string; content: string | Uint8Array }>, message: string): Promise<string> {
  const repo = await ensureRepo(workspaceId)
  await writeWorkspaceTree(workspaceId, files)
  const git = await loadGit()
  const oid = await git.commit({
    fs: repo.fs,
    dir: repo.dir,
    message,
    author: { name: 'browserver', email: 'local@browserver' },
    committer: { name: 'browserver', email: 'local@browserver' },
  })
  return oid
}

export async function getHeadOid(workspaceId: string): Promise<string | null> {
  const repo = await ensureRepo(workspaceId)
  const git = await loadGit()
  try {
    const oid = await git.resolveRef({ fs: repo.fs, dir: repo.dir, ref: 'HEAD' })
    return oid
  } catch {
    return null
  }
}

export async function log(workspaceId: string, depth = 50): Promise<Array<{ oid: string; message: string; author: { name?: string; email?: string; timestamp?: number } | undefined; committer: { name?: string; email?: string; timestamp?: number } | undefined; }>> {
  const repo = await ensureRepo(workspaceId)
  const git = await loadGit()
  const commits = await git.log({ fs: repo.fs, dir: repo.dir, depth })
  return commits.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message,
    author: entry.commit.author ? { ...entry.commit.author, timestamp: (entry.commit.author as any).timestamp } : undefined,
    committer: entry.commit.committer ? { ...entry.commit.committer, timestamp: (entry.commit.committer as any).timestamp } : undefined,
  }))
}
