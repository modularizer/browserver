import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('browserverDesktop', {
  isDesktop: true,
  getLaunchProfile: () => ipcRenderer.invoke('desktop:get-launch-profile'),
  importDesktopProfile: () => ipcRenderer.invoke('desktop:import-profile'),
})
