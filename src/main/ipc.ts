import { ipcMain, type BrowserWindow } from 'electron';
export function registerIpc(win: BrowserWindow) {
  ipcMain.handle('library:status', event => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Forbidden');
    return { ready: true };
  });
}
