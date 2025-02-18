const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
const path = require('path');

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile("index.html");
    
    // 윈도우가 닫히면 앱 종료
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
});