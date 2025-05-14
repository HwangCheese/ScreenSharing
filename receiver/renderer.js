// receiver (Server)
const io = require('socket.io-client');
const socket = io('http://localhost:3000');
const fs = require('fs');
const { exec } = require("child_process");
const pidusage = require('pidusage');
const os = require('os');
const util  = require('util');
const { memoryUsage } = require('process');
const execP = util.promisify(exec);

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
let sumDecodeSq = 0;
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
            sumDecodeSq += decDelay * decDelay;
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

      socket.on('video-frame', ({ buffer, idx, dur }) => {
        const tNow = performance.now();
        const chunk = new Uint8Array(buffer);

        if (startRecv === null) {
          // 첫 프레임이면 현재 시각을 기준점으로 설정
          startRecv = tNow;
        }

        // 첫 프레임 수신 시점 기록 (최초 한 번만)
        if (!firstReceiveTime) {
          firstReceiveTime = tNow;
        }

        // if (prevRecv !== null) {
        //   // chunk 간 지연 = (실제 도착 간격) - (보낸 쪽 chunk 길이)
        //   const delay = (tNow - prevRecv);

        //   delays[delayInx % MAX_FRAME_LOG] = delay;
        //   sumDelay += delay;
        //   if (delay < minDelay) minDelay = delay;
        //   if (delay > maxDelay) maxDelay = delay;
        //   delayInx++; 
        // }
        // prevRecv = tNow;
        // prevDur  = dur;

        // if (lastFrameShownTime !== null) {
        //   const interDelay = tNow - lastFrameShownTime;
        //   logMessage(`앞 프레임 이후 빈 시간: ${interDelay.toFixed(1)}ms`);
        //   delays[delayInx % MAX_FRAME_LOG] = interDelay;
        //   sumDelay += interDelay;
        //   if (interDelay < minDelay) minDelay = interDelay;
        //   if (interDelay > maxDelay) maxDelay = interDelay;
        //   delayInx++;
        //   lastFrameShownTime = null;
        // }

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
        // const avgDelay = delayInx > 0 ? sumDelay / delayInx : 0; // delayInx가 0이 아닌지 확인
        // const avgDecode = dInx > 0 ? sumDecode / dInx : 0; // dInx가 0이 아닌지 확인

        // const stats = {
        //   timestamp: new Date().toLocaleString(),
        //   firstFrameReceiveTime: firstReceiveTime,
        //   lastFrameReceiveTime: lastReceiveTime,
        //   duration: duration,
        //   totalFrames: chunkIdx,
        //   avgNetworkDelay: avgDelay,
        //   minNetworkDelay: minDelay,
        //   maxNetworkDelay: maxDelay,
        //   avgDecodeDelay: avgDecode,
        //   minDecodeDelay: minDecode,
        //   maxDecodeDelay: maxDecode
        // };

        // // 통계 로그에 저장
        // const statsFile = `receiver_stats_${timestamp}_${experimentNumber}.json`;
        // fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        // logMessage(`📊 수신 통계 저장됨: ${statsFile}`);

        // // 수신 로그 기록
        // const content = `🕒 기록 시각: ${new Date().toLocaleString()}\n` +
        //   `수신 시작: ${firstReceiveTime}\n` +
        //   `수신 종료: ${lastReceiveTime}\n` +
        //   `총 수신 시간: ${duration}ms\n` +
        //   `총 수신 프레임: ${chunkIdx}\n` +
        //   `평균 네트워크 지연: ${avgDelay.toFixed(2)}ms\n` +
        //   `평균 디코딩 지연: ${avgDecode.toFixed(2)}ms\n`;

        // fs.writeFileSync(logFileName, content, { flag: 'a' });
        // logMessage(`📄 수신 시간 기록 저장됨: ${logFileName}`);

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
    socket.on('milestone', ({ mark, senderTime, minLate, maxLate, avgLate, minSize, maxSize, avgSize }) => {
      const recvNow = Date.now();
      const netDelta = recvNow - senderTime;      // 발신-수신 벽시계 차

      let avgDecode = sumDecode / dInx;
      const varDecode = dInx > 0 ? (sumDecodeSq / dInx) - (avgDecode ** 2) : 0;
      const stdDecode = Math.sqrt(Math.max(varDecode, 0));

      let label = '';
      if (mark === 60000) label = '⏱️ 1분';
      else if (mark === 300000) label = '⏱️ 5분';
      else if (mark === 1800000) label = '🏁 30분(끝)';

      const avgCpu = cpuCount > 0 ? sumCpu / cpuCount : 0;
      const stdCpu = cpuCount > 0 ? Math.sqrt((sumCpuSq / cpuCount) - avgCpu ** 2) : 0;

      const haveGpu = gpuCount > 0;
      const avgGpu  = haveGpu ? sumGpu / gpuCount : 0;
      const stdGpu  = haveGpu ? Math.sqrt((sumGpuSq / gpuCount) - avgGpu ** 2) : 0;

      const avgMem = memCount > 0 ? sumMem / memCount : 0;
      const stdMem  = memCount > 0 ? Math.sqrt((sumMemSq / memCount) - avgMem ** 2) : 0;

      const decodeLine = `🎞️ 디코딩→화면 지연 avg ${avgDecode.toFixed(1)} ms (표준편차 ${stdDecode.toFixed(1)}) | `
        + `min ${minDecode.toFixed(1)} ms | max ${maxDecode.toFixed(1)} ms`;

      const resourceLine = `🖥️ CPU avg ${avgCpu.toFixed(1)}% (표준편차 ${stdCpu.toFixed(1)}) | `
                            + `min ${minCpu.toFixed(1)}% | max ${maxCpu.toFixed(1)}%`
                            + (haveGpu
                              ? `\n  🖥️ GPU avg ${avgGpu.toFixed(1)}% (표준편차 ${stdGpu.toFixed(1)}) `
                                + `| min ${minGpu.toFixed(1)}% | max ${maxGpu.toFixed(1)}%`
                              : `\n  🖥️ GPU N/A`)
                            + `\n  🗄️ MEM avg ${avgMem.toFixed(1)} MB (표준편차 ${stdMem.toFixed(1)}) `
                            + `| min ${minMem.toFixed(1)} MB | max ${maxMem.toFixed(1)} MB`;

      const sizeLine = `👾 Chunk size stats avg ${avgSize} MB | min ${minSize} MB | max ${maxSize} MB`

      const milestoneMsg = `\n${label} 지점 도착!`
        + `\n  📊 delay 통계   avg ${avgLate} ms | min ${minLate} ms | max ${maxLate} ms`
        + `\n  ${decodeLine}`
        + `\n  ${sizeLine}`
        + `\n  ${resourceLine}`;

      logMessage(milestoneMsg);

      // 마일스톤 데이터 저장
      const milestoneData = {
        timestamp: new Date().toLocaleString(),
        mark: mark,
        delay: {
          avg: avgLate,
          min: minLate,
          max: maxLate
        },
        decodeDelay: {
          avg: avgDecode !== "N/A" ? parseFloat(avgDecode) : null,
          min: minDecode !== Infinity ? minDecode : null,
          max: maxDecode !== -Infinity ? maxDecode : null,
        },
        framesReceived: chunkIdx,
        cpuUsage: {
          avg: avgCpu,
          std: stdCpu,
          min: minCpu,
          max: maxCpu
        },
        gpuUsage: haveGpu ? {
          avg: avgGpu,
          std: stdGpu,
          min: minGpu,
          max: maxGpu
        } : null,
        memoryUsage: {
          avg: avgMem,
          std: stdMem,
          min: minMem,
          max: maxMem
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
let sumCpu = 0, sumCpuSq = 0, cpuCount = 0;
let minCpu = Infinity; let maxCpu = -Infinity;

let sumGpu = 0, sumGpuSq = 0, gpuCount = 0;
let minGpu = Infinity, maxGpu = -Infinity;

let sumMem = 0, sumMemSq = 0, memCount = 0;
let minMem = Infinity, maxMem = -Infinity;

const monitoringInterval = setInterval(async () => {
  try {
    // pidusage: cpu(%)  memory(bytes)
    const { cpu, memory } = await pidusage(process.pid);

    /* ── CPU (프로세스 단위) ── */
    sumCpu += cpu; sumCpuSq  += cpu * cpu; cpuCount++;
    if (cpu < minCpu) minCpu = cpu;
    if (cpu > maxCpu) maxCpu = cpu;

    /* ── MEM (RSS MB) ── */
    const memMB = memory / (1024 * 1024);
    sumMem += memMB; sumMemSq  += memMB * memMB; memCount++;
    if (memMB < minMem) minMem = memMB;
    if (memMB > maxMem) maxMem = memMB;

  } catch (e) { }

  const gpuUtil = await queryGpuUtil();
  if (gpuUtil !== null) {
    sumGpu += gpuUtil; sumGpuSq += gpuUtil * gpuUtil; gpuCount++;
    if (gpuUtil < minGpu) minGpu = gpuUtil;
    if (gpuUtil > maxGpu) maxGpu = gpuUtil;
  }
}, 5000);

async function queryGpuUtil() {
  // 1) NVIDIA
  try {
    const { stdout } = await execP('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits');
    const v = parseFloat(stdout.trim());
    if (!isNaN(v)) return v;
  } catch {}

  // 2) Intel iGPU
  try {
    const { stdout } = await execP('intel_gpu_top -J -s 1000 -o - | head -n 20');
    const m = stdout.match(/"busy"\s*:\s*(\d+(\.\d+)?)/);
    if (m) return parseFloat(m[1]);
  } catch {}

  // 3) AMD Radeon
  try {
    const { stdout } = await execP('rocm-smi --showuse');
    const m = stdout.match(/GPU use \: (\d+)%/i);
    if (m) return parseFloat(m[1]);
  } catch {}
  try {
    const { stdout } = await execP('radeontop -d - -l 1');
    const m = stdout.match(/gpu\s+(\d+\.\d+)%/i);
    if (m) return parseFloat(m[1]);
  } catch {}

  // 4) Apple Silicon (macOS)
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execP('powermetrics --samplers gpu_power -n 1 2>/dev/null');
      const m = stdout.match(/Average Utilization\s+(\d+(\.\d+)?)%/i);
      if (m) return parseFloat(m[1]);
    } catch {}
  }

  // 5) Windows 10/11
  if (process.platform === 'win32') {
    /* 3-A) typeperf 한 샘플 (-sc 1) */
    try {
      const { stdout } = await execP(
        'typeperf "\\\\GPU Engine(*)\\\\Utilization Percentage" -sc 1'
      );
      const lines = stdout.trim().split(/\r?\n/);
      const last = lines[lines.length - 1];
      const nums = last.split(',').slice(1)          // 첫 컬럼은 타임스탬프
        .map(s => parseFloat(s.replace(/"/g, '')))
        .filter(n => !isNaN(n) && n > 0);
      if (nums.length) {
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    } catch {}

    /* 3-B) wmic (WMI 카운터) */
    try {
      const { stdout } = await execP(
        'wmic path Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine ' +
        'get UtilizationPercentage /format:csv'
      );
      const nums = stdout.split(/\r?\n/)
        .map(l => parseFloat(l.split(',').pop()))
        .filter(n => !isNaN(n) && n > 0);
      if (nums.length) {
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    } catch {}
  }

  // 암것도 안 속함
  return null;
}

// 프로그램 종료 시 자원 정리
process.on('SIGINT', () => {
  logMessage("프로그램 종료 중...");
  clearInterval(monitoringInterval);
  logStream.end();
  process.exit(0);
});
