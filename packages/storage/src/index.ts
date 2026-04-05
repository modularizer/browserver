const WORKSPACE_KEY = 'browserver:workspace'

export function loadRaw(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(WORKSPACE_KEY)
}

export function saveRaw(data: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(WORKSPACE_KEY, data)
}
