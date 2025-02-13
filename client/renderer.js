// Socket.IO 클라이언트 연결 (서버 주소에 맞게 수정)
const socket = io("http://localhost:3000");

const startBtn = document.getElementById("startBtn");
const videoElem = document.getElementById("video");

startBtn.addEventListener("click", async () => {
  try {
    // getDisplayMedia 호출 시, 메인 프로세스에서 설정한 setDisplayMediaRequestHandler가 실행됩니다.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false, // 필요 시 true로 변경
    });
    videoElem.srcObject = stream;

    // MediaRecorder 사용 – MediaRecorder는 브라우저 API입니다.
    const options = { mimeType: "video/webm; codecs=vp8" };
    const mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        // 서버로 데이터 청크 전송
        socket.emit("stream", { chunk: event.data });
      }
    };

    mediaRecorder.start(1000); // 1초마다 데이터 청크 전송
    console.log("스트리밍 시작됨");
  } catch (err) {
    console.error("스트리밍 시작 실패:", err);
  }
});
