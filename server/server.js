const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 성능 추적 변수들
const MAX_FRAME_LOG = 10000;
let frameCount = 0;
let sumServerDelay = 0;
let minServerDelay = Infinity;
let maxServerDelay = -Infinity;
let serverStart=null;

// 시간 동기화 오프셋 (첫 프레임에서 계산될 예정)
let clientServerTimeOffset = null;

// 로그 파일 생성
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
const logFileName = `server_metrics_${timestamp}.txt`;
const logStream = fs.createWriteStream(logFileName, { flags: 'a' });

// 콘솔과 파일 모두에 로그 기록
function log(message) {
  const timeStr = new Date().toLocaleString();
  const logMsg = `[${timeStr}] ${message}`;
  console.log(logMsg);
  logStream.write(logMsg + '\n');
}

io.on('connection', (socket) => {
  log(`클라이언트 연결됨: ${socket.id}`);

  socket.on('video-frame', (data) => {
    // 프레임을 다른 모든 클라이언트에게 전달 (브로드캐스트)
    socket.broadcast.emit('video-frame', { 
      buffer: data.buffer, 
      idx: data.idx,
      dur: data.dur,
    });
2
    socket.emit('ack-frame', {

    });
    
    frameCount++;
  });

  socket.on("milestone", (m) => {
    // 서버 타임스탬프와 함께 이정표를 클라이언트에게 전달
    io.emit("milestone", {
      ...m,
      serverTime: Date.now()
    });
  });

  socket.on('screen-share-ended', () => {
    // 최종 통계를 파일에 저장
    const avgDelay = sumServerDelay / Math.min(frameCount, MAX_FRAME_LOG);
    
    const finalStats = {
      totalFrames: frameCount,
      avgServerDelay: avgDelay,
      minServerDelay: minServerDelay,
      maxServerDelay: maxServerDelay,
      timeOffset: clientServerTimeOffset
    };
    
    fs.writeFileSync(`server_final_stats_${timestamp}.json`, JSON.stringify(finalStats, null, 2));
    log(`최종 통계가 server_final_stats_${timestamp}.json에 저장되었습니다`);
    
    io.emit('transmission-ended');
    log('화면 공유가 종료되었으며, 모든 클라이언트에게 알림이 전송되었습니다');
  });

  socket.on('disconnect', () => {
    log(`클라이언트 연결 해제: ${socket.id}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  log(`Socket.IO 서버가 포트 ${PORT}에서 실행 중입니다`);
});
