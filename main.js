const { app, BrowserWindow } = require("electron");
const io = require("socket.io-client");

let mainWindow;
let socket = io("http://localhost:3000"); // 서버와 연결

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");

  socket.on("screen-data", (data) => {
    mainWindow.webContents.send("update-screen", data);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
