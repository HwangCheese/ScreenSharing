const io = require('socket.io-client');
const socket = io('http://localhost:3000');
const fs = require('fs');
const { exec } = require("child_process");

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];

// 성능 측정을 위한 배열들
const frameDecodeTimes = [];
const frameReceiveTimes = [];
const frameDelays = [];
const avgDelayBlocks = [];
const receivedChunks = [];

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

      const queue = [];
      let isUpdating = false;

      const appendChunk = (chunk) => {
        if (sourceBuffer.updating || isUpdating) {
          queue.push(chunk);
        } else {
          isUpdating = true;
          try {
            sourceBuffer.appendBuffer(chunk);
          } catch (e) {
            console.error('SourceBuffer에 추가 중 오류:', e);
          }
        }
      };

      sourceBuffer.addEventListener('updateend', () => {
        isUpdating = false;
        if (queue.length > 0) {
          const nextChunk = queue.shift();
          appendChunk(nextChunk);
        }
      });

      let firstReceiveTime = null;
      let lastReceiveTime = null;

      socket.on('video-frame', (data) => {
        const receivedTime = Date.now();
        frameReceiveTimes.push(receivedTime);

        // 첫 프레임 수신 시점 기록 (최초 한 번만)
        if (!firstReceiveTime) {
          firstReceiveTime = receivedTime;
          console.log(`🎬 첫 프레임 수신 시간: ${firstReceiveTime}`);
        }

        const chunk = new Uint8Array(data.buffer);
        receivedChunks.push(chunk);  // ✅ 수신된 프레임을 바로 저장
        appendChunk(chunk);
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
          const mergedBuffer = Buffer.concat(receivedChunks);  // 수신된 모든 프레임을 합침
          const webmFileName = `received_${timestamp}_${experimentNumber}.webm`;
          fs.writeFileSync(webmFileName, mergedBuffer);  // .webm 파일로 저장
          console.log(`💾 수신된 프레임을 WebM으로 저장 완료: ${webmFileName}`);

          analyzeVideoFPS(webmFileName);
        } else {
          console.log("⚠️ 저장할 수신 프레임이 없습니다.");
        }

        // 손실률 계산 및 로그 파일로 저장
        const receivedFrames = frameReceiveTimes.length;
        // 손실률 계산 부분 삭제됨
        console.log(`📦 수신된 프레임 수: ${receivedFrames}`);

        const lossLog = `수신 분석 결과\n총 수신 프레임: ${receivedFrames}\n`;
        // 손실률 관련 부분은 제거
        fs.writeFileSync(`received_frame_result_${timestamp}_${experimentNumber}.txt`, lossLog);

      });

    });

  } else {
    console.error("MediaSource API가 이 브라우저에서 지원되지 않습니다.");
  }
});