const net = require("net");

// TCP 서버에 연결
const client = new net.Socket();
client.connect(4000, "192.168.137.88", () => {
  console.log("📡 TCP 서버에 연결됨");
});

const startBtn = document.getElementById("startBtn");
const videoElem = document.getElementById("video");

startBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    videoElem.srcObject = stream;

    const mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp8" });

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        const buffer = Buffer.from(await event.data.arrayBuffer());
        client.write(buffer); // TCP 서버로 전송
      }
    };

    mediaRecorder.start(1000); // 1초마다 데이터 전송
  } catch (err) {
    console.error("❌ 스트리밍 시작 실패:", err);
  }
});
