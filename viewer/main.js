const { app, BrowserWindow } = require("electron");
const io = require("socket.io-client");

let mainWindow;
let socket = io("http://localhost:3000"); // 서버와 연결

app.disableHardwareAcceleration(); // 이 부분은 main.js에서 호출

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

  // 렌더링 프로세스가 준비된 후에만 소켓 데이터 전송
  mainWindow.webContents.once('dom-ready', () => {
    socket.on("screen-data", (data) => {
      try {
        mainWindow.webContents.send("update-screen", data);
      } catch (err) {
        console.error("렌더링 프로세스 전송 오류:", err);
      }
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

