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
  content: string
  language: StudioFileLanguage
}

export interface Sample {
  id: string
  name: string
  description: string
  serverLanguage: 'typescript' | 'python'
  files: SampleFile[]
}

import tsHelloServer from './ts-hello/server.ts?raw'
import tsHelloClient from './ts-hello/client.ts?raw'
import tsMathServer from './ts-math/server.ts?raw'
import tsMathClient from './ts-math/client.ts?raw'
import pyHelloServer from './py-hello/server.py?raw'
import pyHelloClient from './py-hello/client.ts?raw'
import pyHelloNotebook from './py-hello/notebook.ipynb?raw'

export const samples: Sample[] = [
  {
    id: 'ts-hello',
    name: 'Hello (TypeScript)',
    description: 'Minimal greeting server with one method.',
    serverLanguage: 'typescript',
    files: [
      { name: 'server.ts', content: tsHelloServer, language: 'typescript' },
      { name: 'client.ts', content: tsHelloClient, language: 'typescript' },
    ],
  },
  {
    id: 'ts-math',
    name: 'Math (TypeScript)',
    description: 'Arithmetic server with add, multiply, and factorial.',
    serverLanguage: 'typescript',
    files: [
      { name: 'server.ts', content: tsMathServer, language: 'typescript' },
      { name: 'client.ts', content: tsMathClient, language: 'typescript' },
    ],
  },
  {
    id: 'py-hello',
    name: 'Hello (Python)',
    description: 'Minimal greeting server in Python.',
    serverLanguage: 'python',
    files: [
      { name: 'server.py', content: pyHelloServer, language: 'python' },
      { name: 'client.ts', content: pyHelloClient, language: 'typescript' },
      { name: 'notebook.ipynb', content: pyHelloNotebook, language: 'json' },
    ],
  },
]
