const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

io.on('connection', (socket) => {
  console.log('클라이언트 연결:', socket.id);

  socket.on('video-frame', (data) => {
    const receiveTime = performance.now();

    // 송신 → 서버까지 걸린 시간
    const transmissionTime = receiveTime - data.sendTime;

    // 데이터 그대로 브로드캐스트 (서버 수신 시간 포함)
    const sendTime = performance.now();
    socket.broadcast.emit('video-frame', { buffer: data.buffer, sendTime: data.sendTime, receiveTime });
    const sendEndTime = performance.now();
    console.log(`server -> sender 전송 시간: ${sendEndTime - sendTime}`);
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 종료:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO 서버가 포트 ${PORT}에서 실행 중`);
});