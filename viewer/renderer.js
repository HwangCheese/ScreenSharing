const { app, BrowserWindow } = require("electron");
const io = require("socket.io-client");

const socket = io("http://localhost:3000"); // 서버 연결

const videoElement = document.getElementById("screen"); // <video> 태그 가져오기
const mediaSource = new MediaSource(); // MediaSource 객체 생성
videoElement.src = URL.createObjectURL(mediaSource); // MediaSource로 비디오 연결

let sourceBuffer = null;

mediaSource.addEventListener("sourceopen", () => {
  // MediaSource가 열렸을 때, SourceBuffer를 추가
  sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8"');
  
  socket.on("screen-data", (data) => {
    if (sourceBuffer && !sourceBuffer.updating && data) {
      // SourceBuffer가 비어 있고 데이터가 있을 때만 appendBuffer 실행
      try {
        sourceBuffer.appendBuffer(new Uint8Array(data));
      } catch (err) {
        console.error("Buffer 추가 실패:", err);
      }
    }
  });
});

mediaSource.addEventListener("sourceended", () => {
  console.log("MediaSource가 닫혔습니다.");
  // MediaSource가 끝나면 추가적으로 처리할 내용이 있으면 여기서 해줄 수 있음
});

