import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';

if (process.env.LIBRARY_DATA_DIR) app.setPath('userData', process.env.LIBRARY_DATA_DIR);
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 840, minWidth: 950, minHeight: 650, title: '拾知', backgroundColor: '#f6f7fb', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  registerIpc(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  void win.loadFile(join(__dirname, '../renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
