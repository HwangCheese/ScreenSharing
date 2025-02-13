const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const path = require("path");

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // 간단하게 하기 위해 nodeIntegration과 contextIsolation을 false로 설정합니다.
      // 실제 프로젝트에서는 보안을 위해 preload 스크립트 사용을 권장합니다.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // 화면 캡쳐 요청이 있을 때 실행할 커스텀 핸들러 설정
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], useSystemPicker: true })
      .then((sources) => {
        if (sources && sources.length > 0) {
          // 여기서는 첫 번째 화면 소스를 선택합니다.
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({ cancel: true });
        }
      })
      .catch((err) => {
        console.error("화면 소스 가져오기 실패:", err);
        callback({ cancel: true });
      });
  });

  mainWindow.loadFile("index.html");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
