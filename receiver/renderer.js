// receiver (Server)
const io = require('socket.io-client');
const socket = io('http://localhost:3000');
const fs = require('fs');
const { exec } = require("child_process");
const pidusage = require('pidusage');

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];

// 성능 측정을 위한 배열들
const MAX_FRAME_LOG = 10000000;
const frameReceiveTimes = new Array(MAX_FRAME_LOG).fill(null);
const receivedChunks = new Array(MAX_FRAME_LOG).fill(null);
const delays = new Array(MAX_FRAME_LOG).fill(null);
let minDelay = Infinity;
let maxDelay = -Infinity;
let delayInx = 0;
let frameIdx = 0;
let chunkIdx = 0;
let sumDelay = 0;
let expectedArrivalTime = null;

document.addEventListener('DOMContentLoaded', () => {
  const videoElement = document.getElementById('videoReceiver');
  if (!videoElement) {
    console.error("비디오 요소를 찾을 수 없습니다.");
    return;
  }

  if ('MediaSource' in window) {
    const mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      const mime = 'video/webm; codecs="vp8"';
      const sourceBuffer = mediaSource.addSourceBuffer(mime);

      const queue = new Array(MAX_FRAME_LOG).fill(null);
      let queueHead = 0;
      let queueTail = 0;
      let isUpdating = false;
      let lastAppendTime = null;

      const appendChunk = (chunk) => {
        if (sourceBuffer.updating || isUpdating) {
          queue[queueTail % MAX_FRAME_LOG] = chunk;
          queueTail++;
        } else {
          isUpdating = true;
          lastAppendTime = performance.now();
          try {
            sourceBuffer.appendBuffer(chunk);
          } catch (e) {
            console.error('SourceBuffer에 추가 중 오류:', e);
          }
        }
      };

      sourceBuffer.addEventListener('updateend', () => {
        isUpdating = false;

        videoElement.requestVideoFrameCallback(() => {
          const shown = performance.now();          // 2-b  (실제 화면 표시 시각)
          if (lastAppendTime !== null) {
            console.log(`🎞️ [디코딩→화면] ${(shown - lastAppendTime).toFixed(1)} ms`);
          }
        });

        if (queueTail > queueHead) {
          const nextChunk = queue[queueHead % MAX_FRAME_LOG];
          queue[queueHead % MAX_FRAME_LOG] = null; // 읽었으면 비워주기(optional)
          queueHead++;
          appendChunk(nextChunk);
        }
      });

      let firstReceiveTime = null;
      let lastReceiveTime = null;

      socket.on('video-frame', ({ buffer, idx, dur, tSend, tRecv }) => {
        const tNow = performance.now();
        const chunk = new Uint8Array(buffer);

        if (expectedArrivalTime === null) {
          // 첫 프레임이면 현재 시각을 기준점으로 설정
          expectedArrivalTime = tNow + dur;
        } else {
          // 누적 예상 도착 시각 업데이트
          expectedArrivalTime += dur;
        }

        const deltaDelay = tNow - expectedArrivalTime;
        console.log(
          `#${idx} 청크 | 예상도착 - 실제도착 Δdelay: ${deltaDelay.toFixed(1)}ms`
        );

        // frameReceiveTimes[frameIdx % MAX_FRAME_LOG] = tNow;
        // frameIdx++;
        // if (prevRecvTime !== null) {
        //   console.log(`📡 [Socket 간격] ${ (receivedTime - prevRecvTime).toFixed(1) } ms`);
        // }
        // prevRecvTime = receivedTime;

        // 첫 프레임 수신 시점 기록 (최초 한 번만)
        if (!firstReceiveTime) {
          firstReceiveTime = tNow;
          console.log(`🎬 첫 프레임 수신 시간: ${firstReceiveTime}`);
        }

        delays[delayInx % MAX_FRAME_LOG] = deltaDelay;
        delayInx++;

        sumDelay += deltaDelay;
        if (deltaDelay < minDelay) minDelay = deltaDelay;
        if (deltaDelay > maxDelay) maxDelay = deltaDelay;

        appendChunk(chunk);
        receivedChunks[chunkIdx % MAX_FRAME_LOG] = chunk;
        chunkIdx++;
      });

      function analyzeVideoFPS(filePath) {
        const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${filePath}"`;

        exec(ffprobeCmd, (err, stdout, stderr) => {
          if (err) {
            console.error("❌ ffprobe 실행 오류:", err);
            return;
          }

          const totalFrames = parseInt(stdout.trim());
          console.log(`📈 수신된 영상의 실제 프레임 수: ${totalFrames}`);
        });
      }

      socket.on('transmission-ended', () => {
        lastReceiveTime = Date.now();
        const duration = lastReceiveTime - firstReceiveTime;
        const timestamp = new Date().toISOString()
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .split('.')[0];
        const experimentNumber = 1;
        const logFile = `receiver_log_${timestamp}_${experimentNumber}.txt`;
        const content = `🕒 기록 시각: ${new Date().toLocaleString()}\nT2: ${firstReceiveTime}\nT3: ${lastReceiveTime}\nReception Duration (T3 - T2): ${duration}ms\n`;
        fs.writeFileSync(logFile, content);
        console.log(`📄 수신 시간 기록 저장됨: ${logFile}`);

        // ✅ 수신된 프레임을 WebM 파일로 저장
        if (receivedChunks.length > 0) {
          const validBufs = receivedChunks
            .slice(0, chunkIdx)       // 아직 안 쓴 영역 제외
            .filter(Boolean)          // null 제거
            .map(u8 => Buffer.from(u8));

          const mergedBuffer = Buffer.concat(validBufs);
          const webmFileName = `received_${timestamp}_${experimentNumber}.webm`;
          fs.writeFileSync(webmFileName, mergedBuffer);
          console.log(`💾 WebM 저장 완료: ${webmFileName}`);
          analyzeVideoFPS(webmFileName);
        } else {
          console.log("⚠️ 저장할 수신 프레임이 없습니다.");
        }

        // 손실률 관련 부분은 제거
        fs.writeFileSync(`received_frame_result_${timestamp}_${experimentNumber}.txt`, lossLog);

      });

    });

    // 1m, 5m, 30m 마일스톤 오면 한 번만 통계 출력
    socket.on('milestone', ({ mark, senderTime }) => {
      const recvNow = Date.now();
      const netDelta = recvNow - senderTime;      // 발신-수신 벽시계 차

      const avg = (sumDelay / delays.length).toFixed(1);

      let label = '';
      if (mark === 60000) label = '⏱️ 1분';
      else if (mark === 300000) label = '⏱️ 5분';
      else if (mark === 1800000) label = '🏁 30분(끝)';

      console.log(`\n${label} 지점 도착!`);
      console.log(`  ↔️  sender→receiver 지연: ${netDelta} ms`);
      console.log(`  📊 delay 통계   avg ${avg} ms | min ${minDelay} ms | max ${maxDelay} ms`);
    });


  } else {
    console.error("MediaSource API가 이 브라우저에서 지원되지 않습니다.");
  }
});

setInterval(() => {
  pidusage(process.pid, (err, stats) => {
    if (err) {
      console.error("pidusage 오류:", err);
      return;
    }
    console.log(`🖥️ CPU 사용량: ${stats.cpu.toFixed(2)}% | 메모리 사용량: ${(stats.memory / 1024 / 1024).toFixed(2)} MB`);
  });
}, 5000); // 5초마다 체크
