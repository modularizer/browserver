declare module 'virtual:plat-client-bundle' {
  export const files: Array<{ path: string; contents: string }>
  export const aliases: Record<string, string>
}
