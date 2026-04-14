import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const studioDir = path.resolve(__dirname, '../studio')
const studioDistIndex = path.join(studioDir, 'dist/index.html')
const profilesRootName = 'browserver-desktop'

function parseArgValue(flag) {
  const direct = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  if (direct) return direct.slice(flag.length + 1)

  const index = process.argv.findIndex((arg) => arg === flag)
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1]
  }

  return null
}

function sanitizeProfileId(value) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'default'
}

const requestedProfileId = sanitizeProfileId(parseArgValue('--profile') ?? 'default')
const explicitBundlePath = parseArgValue('--profile-bundle')

function globalStateDir() {
  return path.join(app.getPath('appData'), profilesRootName)
}

function registryDir() {
  return path.join(globalStateDir(), 'profiles')
}

function profileDir(profileId) {
  return path.join(globalStateDir(), 'instances', profileId)
}

function profileDataDir(profileId) {
  return path.join(profileDir(profileId), 'user-data')
}

function profileBundlePath(profileId) {
  return path.join(registryDir(), `${profileId}.json`)
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function readJson(filePath) {
  const source = await fs.readFile(filePath, 'utf8')
  return JSON.parse(source)
}

function isDesktopProfileBundle(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.version === 1
    && value.profile
    && value.project
    && typeof value.profile.id === 'string'
    && value.project.workspace,
  )
}

async function loadRegisteredBundle(profileId) {
  const filePath = profileBundlePath(profileId)
  try {
    const bundle = await readJson(filePath)
    return isDesktopProfileBundle(bundle) ? { bundle, filePath } : null
  } catch {
    return null
  }
}

async function loadBundleFromFile(filePath) {
  if (!filePath) return null
  const bundle = await readJson(filePath)
  if (!isDesktopProfileBundle(bundle)) {
    throw new Error('Invalid browserver desktop profile bundle')
  }
  return { bundle, filePath }
}

async function saveBundleToRegistry(bundle) {
  const profileId = sanitizeProfileId(bundle.profile.id)
  const destination = profileBundlePath(profileId)
  await ensureDir(registryDir())
  await fs.writeFile(destination, JSON.stringify(bundle, null, 2))
  return destination
}

async function loadLaunchProfile(profileId) {
  const loaded = explicitBundlePath
    ? await loadBundleFromFile(explicitBundlePath)
    : await loadRegisteredBundle(profileId)
  if (!loaded) return null
  return {
    profileId,
    bundlePath: loaded.filePath,
    bundle: loaded.bundle,
  }
}

function studioUrl() {
  const devUrl = process.env.BROWSERVER_STUDIO_DEV_URL
  if (devUrl) return devUrl
  return pathToFileURL(studioDistIndex).toString()
}

function buildWindowTitle(launchProfile) {
  const profileName = launchProfile?.bundle?.profile?.appName?.trim()
  return profileName || 'browserver desktop'
}

async function loadWindowIcon(launchProfile) {
  const icon = launchProfile?.bundle?.profile?.icon
  if (!icon?.source) return undefined

  if (typeof icon.source === 'string' && icon.source.startsWith('data:image/')) {
    return nativeImage.createFromDataURL(icon.source)
  }

  if (typeof icon.source === 'string' && icon.source.includes('<svg')) {
    return nativeImage.createFromDataURL(`data:image/svg+xml,${encodeURIComponent(icon.source)}`)
  }

  return undefined
}

let mainWindow = null
let activeLaunchProfile = null

async function createWindow() {
  activeLaunchProfile = await loadLaunchProfile(requestedProfileId)
  const icon = await loadWindowIcon(activeLaunchProfile)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: buildWindowTitle(activeLaunchProfile),
    icon,
    backgroundColor: '#0f1117',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (activeLaunchProfile?.bundle?.profile?.id) {
    const modelId = `browserver.profile.${sanitizeProfileId(activeLaunchProfile.bundle.profile.id)}`
    app.setAppUserModelId(modelId)
  }

  await mainWindow.loadURL(studioUrl())
}

async function importDesktopProfileFromDialog() {
  const owner = BrowserWindow.getFocusedWindow() ?? mainWindow
  const result = await dialog.showOpenDialog(owner, {
    title: 'Import Browserver Desktop Profile',
    buttonLabel: 'Import Profile',
    properties: ['openFile'],
    filters: [
      { name: 'Browserver Desktop Profiles', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const loaded = await loadBundleFromFile(result.filePaths[0])
  const savedPath = await saveBundleToRegistry(loaded.bundle)
  const profileId = sanitizeProfileId(loaded.bundle.profile.id)

  app.relaunch({
    args: process.argv
      .slice(1)
      .filter((arg) => !arg.startsWith('--profile=') && !arg.startsWith('--profile-bundle='))
      .concat([`--profile=${profileId}`, `--profile-bundle=${savedPath}`]),
  })
  app.exit(0)
  return { profileId, bundlePath: savedPath, bundle: loaded.bundle }
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import Desktop Profile…',
          click: () => {
            void importDesktopProfileFromDialog()
          },
        },
        {
          label: 'Open Profiles Folder',
          click: async () => {
            await ensureDir(registryDir())
            await shell.openPath(registryDir())
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
    template[3].submenu.push({ type: 'separator' }, { role: 'front' })
  } else {
    template[0].submenu.push({ type: 'separator' }, { role: 'quit' })
  }

  return Menu.buildFromTemplate(template)
}

ipcMain.handle('desktop:get-launch-profile', async () => activeLaunchProfile)
ipcMain.handle('desktop:import-profile', async () => importDesktopProfileFromDialog())

app.setName('browserver desktop')
app.setPath('userData', profileDataDir(requestedProfileId))

app.whenReady().then(async () => {
  await ensureDir(profileDataDir(requestedProfileId))
  await ensureDir(registryDir())
  Menu.setApplicationMenu(buildAppMenu())
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
