export type StudioFileLanguage =
  | 'typescript'
  | 'python'
  | 'javascript'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'yaml'
  | 'image'
  | 'video'
  | 'pdf'
  | 'csv'
  | 'xlsx'
  | 'archive'
  | 'plaintext'

export interface SampleFile {
  name: string
  content: string | Uint8Array
  language: StudioFileLanguage
}

export interface Sample {
  id: string
  name: string
  description: string
  serverLanguage: 'typescript' | 'python'
  files: SampleFile[]
}


// Utility: file extension to StudioFileLanguage
function getLanguageFromExtension(filename: string): StudioFileLanguage {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': return 'typescript'
    case 'tsx': return 'typescript'
    case 'jsx': return 'javascript'
    case 'js': return 'javascript'
    case 'py': return 'python'
    case 'json': return 'json'
    case 'html': return 'html'
    case 'css': return 'css'
    case 'md': return 'markdown'
    case 'yaml':
    case 'yml': return 'yaml'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg': return 'image'
    case 'mp4':
    case 'webm': return 'video'
    case 'pdf': return 'pdf'
    case 'csv': return 'csv'
    case 'xlsx': return 'xlsx'
    case 'zip':
    case 'tar':
    case 'gz': return 'archive'
    case 'ipynb': return 'json'
    default: return 'plaintext'
  }
}

// Utility: is this file binary?
function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  return [
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'webm', 'pdf', 'xlsx', 'zip', 'tar', 'gz'
  ].includes(ext || '')
}

// Use import.meta.glob to get all files in all sample directories
const sampleDirs = [
  'ts-hello',
  'ts-math',
  'ts-static-site',
  'ts-react',
  'ts-react-wordle',
  'py-hello',
]

// Text files → ?raw so we get the original source, NOT Vite's transformed
// module output (which would rewrite imports to /@fs/... and append a
// sourceMappingURL).  Binary files → ?url so we can fetch() as a blob.
const textSampleFiles = import.meta.glob('./{ts-hello,ts-math,ts-static-site,ts-react,ts-react-wordle,py-hello}/*', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
const binarySampleFiles = import.meta.glob('./{ts-hello,ts-math,ts-static-site,ts-react,ts-react-wordle,py-hello}/*', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>

async function loadSampleFile(path: string, filename: string): Promise<string | Uint8Array> {
  if (isBinaryFile(filename)) {
    const url = binarySampleFiles[path]
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch ' + filename + ': ' + res.status)
    const blob = await res.blob()
    return new Uint8Array(await blob.arrayBuffer())
  }
  const raw = textSampleFiles[path]
  if (raw === undefined) throw new Error('Missing raw text for ' + path)
  return raw
}

// Map of sample metadata
const sampleMeta: Record<string, { name: string, description: string, serverLanguage: 'typescript' | 'python' }> = {
  'ts-hello': {
    name: 'Hello (TypeScript)',
    description: 'Minimal greeting server with one method.',
    serverLanguage: 'typescript',
  },
  'ts-math': {
    name: 'Math (TypeScript)',
    description: 'Arithmetic server with add, multiply, and factorial.',
    serverLanguage: 'typescript',
  },
  'ts-static-site': {
    name: 'Static Site (TypeScript)',
    description: 'Serve HTML, CSS, and other static files from a client-side server.',
    serverLanguage: 'typescript',
  },
  'ts-react': {
    name: 'React + Tailwind (Frontend)',
    description: 'Frontend React app bundled in-browser with the browserver bundler.',
    serverLanguage: 'typescript',
  },
  'ts-react-wordle': {
    name: 'Wordle (React Game)',
    description: 'Playable Wordle clone: React UI + api.ts game layer + persisted stats.',
    serverLanguage: 'typescript',
  },
  'py-hello': {
    name: 'Hello (Python)',
    description: 'Minimal greeting server in Python.',
    serverLanguage: 'python',
  },
}

// Build the samples array programmatically (populated at module load below)
// eslint-disable-next-line prefer-const
let samplesArray: Sample[] = []

// Group files by sample dir
const filesBySample: Record<string, { name: string, path: string }[]> = {}
for (const path of Object.keys(textSampleFiles)) {
  const m = /^\.\/(.+?)\/(.+)$/.exec(path)
  if (!m) continue
  const sampleDir = m[1]
  const filename = m[2]
  if (!filesBySample[sampleDir]) filesBySample[sampleDir] = []
  filesBySample[sampleDir].push({ name: filename, path })
}

// Load all files for each sample and build the samples array
const samplePromises = Object.entries(filesBySample).map(async ([sampleDir, files]) => {
  const meta = sampleMeta[sampleDir]
  if (!meta) return null
  const fileObjs: SampleFile[] = await Promise.all(files.map(async ({ name, path }) => {
    const content = await loadSampleFile(path, name)
    return {
      name,
      content,
      language: getLanguageFromExtension(name),
    }
  }))
  return {
    id: `dmz/${sampleDir}`,
    name: meta.name,
    description: meta.description,
    serverLanguage: meta.serverLanguage,
    files: fileObjs,
  } as Sample
})

export const samplesPromise: Promise<Sample[]> = Promise.all(samplePromises).then(arr => arr.filter(Boolean) as Sample[])

// Top-level await resolves samples before any consumer imports it.
samplesArray = await samplesPromise
export const samples: Sample[] = samplesArray
