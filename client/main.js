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

    // 화면 공유 요청을 처리하는 핸들러
    ipcMain.handle("get-sources", async () => {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return sources;
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            callback({ video: sources[0], audio: 'loopback' });
        }, { useSystemPicker: true });
    });

    // 윈도우가 닫히면 앱 종료
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
});
