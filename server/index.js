const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

io.on('connection', (socket) => {
  console.log('클라이언트 연결:', socket.id);

  socket.on('video-frame', (data) => {
    console.log('비디오 프레임 수신');
    // 받은 비디오 데이터를 다른 클라이언트로 브로드캐스트
    socket.broadcast.emit('video-frame', data);  // 다른 클라이언트로 전달
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 종료:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO 서버가 포트 ${PORT}에서 실행 중`);
});
