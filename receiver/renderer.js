const io = require('socket.io-client');
const socket = io('http://localhost:3000');

// 성능 측정을 위한 배열들
const frameDecodeTimes = [];   // 각 프레임의 압축 해제(디코딩) 시간 (ms)
const frameReceiveTimes = [];  // 각 프레임이 수신된 시간 (ms)
const frameJitterValues = [];  // 연속 프레임 간의 도착 시간 차이 (ms)
const avgJitterBlocks = [];    // 매 10 프레임마다 계산된 평균 지터 값을 저장

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

      socket.on('video-frame', (data) => {
        // 프레임이 도착한 시각 기록
        const receivedTime = performance.now();
        frameReceiveTimes.push(receivedTime);
        
        // 연속 프레임 간 도착 시간 차이를 계산하여 지터 배열에 저장
        if (frameReceiveTimes.length > 1) {
          const lastDiff = receivedTime - frameReceiveTimes[frameReceiveTimes.length - 2];
          frameJitterValues.push(lastDiff);
        }
    
        // 압축 해제(디코딩) 시간 측정
        const decodeStartTime = performance.now();
        
        const chunk = new Uint8Array(data.buffer);
        appendChunk(chunk);
    
        const decodeEndTime = performance.now();
        const decodeTime = decodeEndTime - decodeStartTime;
        frameDecodeTimes.push(decodeTime);
        console.log(`📥 압축 해제 시간: ${decodeTime.toFixed(2)}ms`);
        
        // 매 10 프레임마다 평균 디코딩 시간과 평균 지터 계산 및 출력
        if (frameDecodeTimes.length % 10 === 0) {
          const avgDecodeTime = frameDecodeTimes.reduce((sum, t) => sum + t, 0) / frameDecodeTimes.length;
          const avgJitter = frameJitterValues.reduce((sum, t) => sum + t, 0) / frameJitterValues.length;
          console.log(`평균 압축 해제 시간: ${avgDecodeTime.toFixed(2)}ms`);
          console.log(`평균 지터: ${avgJitter.toFixed(2)}ms`);
          
          // 매 10 프레임의 평균 지터 값을 저장
          avgJitterBlocks.push(avgJitter);
          
          // 전체(누적된 모든 블록)의 평균 지터 계산
          const overallAvgJitter = avgJitterBlocks.reduce((sum, j) => sum + j, 0) / avgJitterBlocks.length;
          console.log(`전체 평균 지터: ${overallAvgJitter.toFixed(2)}ms`);
        }
      });
    });
  } else {
    console.error("MediaSource API가 이 브라우저에서 지원되지 않습니다.");
  }
});
