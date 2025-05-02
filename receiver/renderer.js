// receiver (Server)
const io = require('socket.io-client');
const socket = io('http://localhost:3000');
const fs = require('fs');
const { exec } = require("child_process");
const pidusage = require('pidusage');
const os = require('os');

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
let chunkIdx = 0;
let sumDelay = 0;
let startRecv = null;

const decodeDelays = new Array(MAX_FRAME_LOG).fill(null);
let dInx = 0;
let sumDecode = 0;
let minDecode = Infinity;
let maxDecode = -Infinity;

// 로그 파일 스트림 설정
const experimentNumber = 1;
const logFileName = `receiver_performance_${timestamp}_${experimentNumber}.txt`;
const logStream = fs.createWriteStream(logFileName, { flags: 'a' });

// 로그 함수
function logMessage(message) {
  const timeStr = new Date().toLocaleString();
  const fullMsg = `[${timeStr}] ${message}`;
  console.log(fullMsg);
  logStream.write(fullMsg + '\n');
}

document.addEventListener('DOMContentLoaded', () => {
  const videoElement = document.getElementById('videoReceiver');
  if (!videoElement) {
    logMessage("비디오 요소를 찾을 수 없습니다.");
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
            logMessage('SourceBuffer에 추가 중 오류: ' + e.message);
          }
        }
      };

      let baseWall = null;
      let lastFrameShownTime = null;

      sourceBuffer.addEventListener('updateend', () => {
        isUpdating = false;

        videoElement.requestVideoFrameCallback((tWall, info) => {
          if (baseWall === null) {
            baseWall = tWall;             // 화면에 실제로 첫 프레임 그려진 시각
          }

          const shown = performance.now();          // 2-b  (실제 화면 표시 시각)
          lastFrameShownTime = shown;
          if (lastAppendTime !== null) {
            const decDelay = shown - lastAppendTime;           // 디코딩→화면 지연

            // 배열에 저장
            decodeDelays[dInx % MAX_FRAME_LOG] = decDelay;
            dInx++;
            sumDecode += decDelay;
            if (decDelay < minDecode) minDecode = decDelay;
            if (decDelay > maxDecode) maxDecode = decDelay;
          }
        });

        if (queueTail > queueHead) {
          const nextChunk = queue[queueHead % MAX_FRAME_LOG];
          queue[queueHead % MAX_FRAME_LOG] = null;
          queueHead++;
          appendChunk(nextChunk);
        }
      });

      let firstReceiveTime = null;
      let lastReceiveTime = null;
      let prevRecv = null;
      let prevDur = null;

      socket.on('video-frame', ({ buffer, idx, dur, tRel }) => {
        const tNow = performance.now();
        const chunk = new Uint8Array(buffer);

        if (startRecv === null) {
          // 첫 프레임이면 현재 시각을 기준점으로 설정
          startRecv = tNow;
          logMessage(`🎬 첫 프레임 수신 시작: ${startRecv}`);
        }

        // 첫 프레임 수신 시점 기록 (최초 한 번만)
        if (!firstReceiveTime) {
          firstReceiveTime = tNow;
          logMessage(`🎬 첫 프레임 수신 시간: ${firstReceiveTime}`);
        }

        // if (prevRecv !== null && prevDur !== null) {
        //   // chunk 간 지연 = (실제 도착 간격) - (보낸 쪽 chunk 길이)
        //   const delay = (tNow - prevRecv) - prevDur;

        //   delays[delayInx % MAX_FRAME_LOG] = delay;
        //   sumDelay += delay;
        //   if (delay < minDelay) minDelay = delay;
        //   if (delay > maxDelay) maxDelay = delay;
        //   delayInx++; 
        // }
        // prevRecv = tNow;
        // prevDur  = dur;

        if (lastFrameShownTime !== null) {
          const interDelay = tNow - lastFrameShownTime;
          logMessage(`앞 프레임 이후 빈 시간: ${interDelay.toFixed(1)}ms`);
          delays[delayInx % MAX_FRAME_LOG] = interDelay;
          sumDelay += interDelay;
          if (interDelay < minDelay) minDelay = interDelay;
          if (interDelay > maxDelay) maxDelay = interDelay;
          delayInx++;
          lastFrameShownTime = null;
        }

        appendChunk(chunk);
        receivedChunks[chunkIdx % MAX_FRAME_LOG] = chunk;
        chunkIdx++;

        // 매 100번째 프레임마다 성능 로그 기록
        if (chunkIdx % 100 === 0) {
          const avgDelay = delayInx > 0 ? sumDelay / delayInx : 0; // delayInx가 0이 아닌지 확인
          const avgDecode = dInx > 0 ? sumDecode / dInx : 0; // dInx가 0이 아닌지 확인
          logMessage(`📊 프레임 #${chunkIdx}: 평균 지연 ${avgDelay.toFixed(2)}ms | 평균 디코딩 지연 ${avgDecode.toFixed(2)}ms`);
        }
      });

      function analyzeVideoFPS(filePath) {
        const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${filePath}"`;

        exec(ffprobeCmd, (err, stdout, stderr) => {
          if (err) {
            logMessage("❌ ffprobe 실행 오류: " + err.message);
            return;
          }

          const totalFrames = parseInt(stdout.trim());
          logMessage(`📈 수신된 영상의 실제 프레임 수: ${totalFrames}`);

          // 총 수신 시간 기준으로 실제 FPS 계산
          if (lastReceiveTime && firstReceiveTime) {
            const durationSec = (lastReceiveTime - firstReceiveTime) / 1000;
            const fps = totalFrames / durationSec;
            logMessage(`📈 실제 FPS: ${fps.toFixed(2)}`);
          }
        });
      }

      socket.on('transmission-ended', () => {
        lastReceiveTime = performance.now();
        const duration = lastReceiveTime - firstReceiveTime;

        // 최종 성능 통계 기록
        const avgDelay = delayInx > 0 ? sumDelay / delayInx : 0; // delayInx가 0이 아닌지 확인
        const avgDecode = dInx > 0 ? sumDecode / dInx : 0; // dInx가 0이 아닌지 확인

        const stats = {
          timestamp: new Date().toLocaleString(),
          firstFrameReceiveTime: firstReceiveTime,
          lastFrameReceiveTime: lastReceiveTime,
          duration: duration,
          totalFrames: chunkIdx,
          avgNetworkDelay: avgDelay,
          minNetworkDelay: minDelay,
          maxNetworkDelay: maxDelay,
          avgDecodeDelay: avgDecode,
          minDecodeDelay: minDecode,
          maxDecodeDelay: maxDecode
        };

        // 통계 로그에 저장
        const statsFile = `receiver_stats_${timestamp}_${experimentNumber}.json`;
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        logMessage(`📊 수신 통계 저장됨: ${statsFile}`);

        // 수신 로그 기록
        const content = `🕒 기록 시각: ${new Date().toLocaleString()}\n` +
          `수신 시작: ${firstReceiveTime}\n` +
          `수신 종료: ${lastReceiveTime}\n` +
          `총 수신 시간: ${duration}ms\n` +
          `총 수신 프레임: ${chunkIdx}\n` +
          `평균 네트워크 지연: ${avgDelay.toFixed(2)}ms\n` +
          `평균 디코딩 지연: ${avgDecode.toFixed(2)}ms\n`;

        fs.writeFileSync(logFileName, content, { flag: 'a' });
        logMessage(`📄 수신 시간 기록 저장됨: ${logFileName}`);

        // ✅ 수신된 프레임을 WebM 파일로 저장
        if (chunkIdx > 0) {
          const validBufs = [];
          for (let i = 0; i < chunkIdx; i++) {
            const chunk = receivedChunks[i % MAX_FRAME_LOG];
            if (chunk) {
              validBufs.push(Buffer.from(chunk));
            }
          }

          const mergedBuffer = Buffer.concat(validBufs);
          const webmFileName = `received_${timestamp}_${experimentNumber}.webm`;
          fs.writeFileSync(webmFileName, mergedBuffer);
          logMessage(`💾 WebM 저장 완료: ${webmFileName}`);
          analyzeVideoFPS(webmFileName);
        } else {
          logMessage("⚠️ 저장할 수신 프레임이 없습니다.");
        }
      });
    });

    // 1m, 5m, 30m 마일스톤 오면 한 번만 통계 출력
    socket.on('milestone', ({ mark, senderTime }) => {
      const recvNow = Date.now();
      const netDelta = recvNow - senderTime;      // 발신-수신 벽시계 차

      // delayInx가 0인 경우를 방지하기 위한 체크
      const avg = delayInx > 0 ? (sumDelay / delayInx).toFixed(1) : "N/A";
      const avgDecode = dInx > 0 ? (sumDecode / dInx).toFixed(1) : "N/A";

      let label = '';
      if (mark === 60000) label = '⏱️ 1분';
      else if (mark === 300000) label = '⏱️ 5분';
      else if (mark === 1800000) label = '🏁 30분(끝)';

      const avgCpu = cpuCount > 0 ? sumCpu / cpuCount : 0;
      const milestoneMsg = `\n${label} 지점 도착!` +
        `\n  ↔️  sender→receiver 지연: ${netDelta} ms` +
        `\n  📊 delay 통계   avg ${avg} ms | min ${minDelay.toFixed(1)} ms | max ${maxDelay.toFixed(1)} ms` +
        `\n  🎞️ 디코딩→화면 지연 avg ${avgDecode} ms | min ${minDecode.toFixed(1)} ms | max ${maxDecode.toFixed(1)} ms` +
        `\n  🖥️ CPU 사용량   avg ${avgCpu.toFixed(2)}% | min ${minCpuUsage.toFixed(2)}% | max ${maxCpuUsage.toFixed(2)}%`;

      logMessage(milestoneMsg);

      // 마일스톤 데이터 저장
      const milestoneData = {
        timestamp: new Date().toLocaleString(),
        mark: mark,
        networkLatency: netDelta,
        avgDelay: avg !== "N/A" ? parseFloat(avg) : null,
        minDelay: minDelay !== Infinity ? minDelay : null,
        maxDelay: maxDelay !== -Infinity ? maxDelay : null,
        avgDecodeDelay: avgDecode !== "N/A" ? parseFloat(avgDecode) : null,
        minDecodeDelay: minDecode !== Infinity ? minDecode : null,
        maxDecodeDelay: maxDecode !== -Infinity ? maxDecode : null,
        framesReceived: chunkIdx,
        cpuUsage: {
          avg: avgCpu,
          min: minCpuUsage,
          max: maxCpuUsage
        }
      };

      fs.writeFileSync(`milestone_${mark / 1000}min_${timestamp}.json`, JSON.stringify(milestoneData, null, 2));
    });
  } else {
    logMessage("MediaSource API가 이 브라우저에서 지원되지 않습니다.");
  }
});

function getCpuInfo() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach(core => {
    idle += core.times.idle;
    total += core.times.user
      + core.times.nice
      + core.times.sys
      + core.times.idle
      + core.times.irq;
  });
  return { idle, total };
}
let prevCpuGlobal = getCpuInfo();
let sumCpu = 0;
let cpuCount = 0;
let minCpuUsage = Infinity;
let maxCpuUsage = -Infinity;
let lastCpuUsage = 0;

setInterval(() => {
  const currCpu = getCpuInfo();
  const idleDiff = currCpu.idle - prevCpuGlobal.idle;
  const totalDiff = currCpu.total - prevCpuGlobal.total;
  lastCpuUsage = (1 - idleDiff / totalDiff) * 100;

  // 누적·카운트·min/max 업데이트
  sumCpu += lastCpuUsage;
  cpuCount++;
  if (lastCpuUsage < minCpuUsage) minCpuUsage = lastCpuUsage;
  if (lastCpuUsage > maxCpuUsage) maxCpuUsage = lastCpuUsage;

  prevCpuGlobal = currCpu;
}, 5000);

// 프로그램 종료 시 자원 정리
process.on('SIGINT', () => {
  logMessage("프로그램 종료 중...");
  clearInterval(monitoringInterval);
  logStream.end();
  process.exit(0);
});