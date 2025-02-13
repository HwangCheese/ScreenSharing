const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public")); // 필요하면 정적 파일 제공

io.on("connection", (socket) => {
  console.log("클라이언트 연결됨:", socket.id);

  socket.on("screen-data", (data) => {
    // 받은 화면 데이터를 모든 클라이언트에 브로드캐스트
    socket.broadcast.emit("screen-data", Buffer.from(data));
  });

  socket.on("disconnect", () => {
    console.log("클라이언트 연결 종료:", socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`서버가 ${PORT} 포트에서 실행 중`);
});
