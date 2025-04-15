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
    const transmissionTime = receiveTime - data.sendTime;

    if (data.isFirst) {
      socket.emit('first-frame-ack', { receiveTime });
    }

    socket.broadcast.emit('video-frame', { buffer: data.buffer, sendTime: data.sendTime, receiveTime });
  });

  socket.on('screen-share-ended', () => {
    io.emit('transmission-ended');
    console.log('서버: 화면 전송 종료 알림 전달');
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 종료:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO 서버가 포트 ${PORT}에서 실행 중`);
});