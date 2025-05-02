const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 성능 추적 변수들
const MAX_FRAME_LOG = 10000;
const frameArrivals = new Array(MAX_FRAME_LOG).fill(null);
const serverDelays = new Array(MAX_FRAME_LOG).fill(null);
const processingTimes = new Array(MAX_FRAME_LOG).fill(null);
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
    const serverReceiveTime = performance.now();
    
    // 첫 프레임 - 시간 동기화 초기화
    if (frameCount === 0) {
      // 클라이언트와 서버 시간의 차이 저장
      // data.tAbs는 프레임이 생성된 절대 클라이언트 시간임
      if (data.tAbs) {
        clientServerTimeOffset = Date.now() - data.tAbs;
        log(`클라이언트와 서버 간 시간 오프셋: ${clientServerTimeOffset}ms`);
      }
    }
    
    // 상대 시간을 기준으로 서버 지연 계산
    // data.tRel은 클라이언트 측에서 프레임 생성 이후 시간임
    const networkTransitTime = data.tRel; // 서버에 도착하는데 걸린 시간
    
    // 서버 처리 시간 계산
    const processingStartTime = performance.now();
    
    // 지표 추적
    frameArrivals[frameCount % MAX_FRAME_LOG] = serverReceiveTime;
    
    if (frameCount > 0) {
      // 예상 도착 시간과 실제 시간을 비교하여 서버 지연 계산
      // 가변적인 청크 지속 시간에도 작동함
      const expectedInterval = data.dur; // 이전 청크의 지속 시간
      const actualInterval = frameCount > 0 ? 
        serverReceiveTime - frameArrivals[(frameCount - 1) % MAX_FRAME_LOG] : 
        0;
        
      // 서버 지연은 실제와 예상 간격의 차이임
      // 양수 값은 서버가 예상보다 늦게 받았음을 의미
      // 음수 값은 서버가 예상보다 일찍 받았음을 의미
      const ideal = serverStart + data.tRel;
      const serverDelay = serverReceiveTime - ideal;
      
      serverDelays[frameCount % MAX_FRAME_LOG] = serverDelay;
      sumServerDelay += serverDelay;
      minServerDelay = Math.min(minServerDelay, serverDelay);
      maxServerDelay = Math.max(maxServerDelay, serverDelay);
      
      // 디버깅을 위해 100번째 프레임마다 로그 기록
      if (frameCount % 100 === 0) {
        const avgDelay = sumServerDelay / Math.min(frameCount, MAX_FRAME_LOG);
        log(`프레임 #${frameCount}: 서버 지연 = ${serverDelay.toFixed(2)}ms, 평균 = ${avgDelay.toFixed(2)}ms, 최소 = ${minServerDelay.toFixed(2)}ms, 최대 = ${maxServerDelay.toFixed(2)}ms`);
      }
    }
    
    // 프레임을 다른 모든 클라이언트에게 전달 (브로드캐스트)
    socket.broadcast.emit('video-frame', { 
      buffer: data.buffer, 
      idx: data.idx,
      dur: data.dur,
      tRel: data.tRel,
      tServer: serverReceiveTime // 수신자 분석을 위한 서버 타임스탬프 추가
    });
    
    // 서버에서의 처리 시간 계산
    const processingEndTime = performance.now();
    const processingTime = processingEndTime - processingStartTime;
    processingTimes[frameCount % MAX_FRAME_LOG] = processingTime;
    
    // 타이밍 정보와 함께 첫 프레임 확인
    if (frameCount === 0) {
      socket.emit('first-frame-ack', { 
        receiveTime: serverReceiveTime,
        serverTime: Date.now() // 동기화를 위한 절대 서버 시간
      });
      serverStart = serverReceiveTime;  
    }
    
    frameCount++;
  });

  socket.on("milestone", (m) => {
    // 이정표에서 통계 계산 및 로깅
    const avgDelay = sumServerDelay / Math.min(frameCount, MAX_FRAME_LOG);
    const sumProcessing = processingTimes.reduce((sum, time) => sum + (time || 0), 0);
    const avgProcessing = sumProcessing / Math.min(frameCount, MAX_FRAME_LOG);
    
    log(`\n--- 이정표 ${m.mark}ms ---`);
    log(`처리된 프레임: ${frameCount}`);
    log(`평균 서버 지연: ${avgDelay.toFixed(2)}ms`);
    log(`최소 서버 지연: ${minServerDelay.toFixed(2)}ms`);
    log(`최대 서버 지연: ${maxServerDelay.toFixed(2)}ms`);
    log(`평균 처리 시간: ${avgProcessing.toFixed(2)}ms`);
    
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