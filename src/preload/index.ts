import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('libraryApi', { getStatus: () => ipcRenderer.invoke('library:status') });
