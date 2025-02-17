const io = require('socket.io-client');
const socket = io('http://localhost:3000');

// 스레드를 2개
// 하나는 decording 스레드, 하나는

document.addEventListener('DOMContentLoaded', () => {
  const videoElement = document.getElementById('videoReceiver');
  if (!videoElement) {
    console.error("비디오 요소를 찾을 수 없습니다.");
    return;
  }
  
  if ('MediaSource' in window) {
    // MediaSource 객체 생성
    const mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      const mime = 'video/webm; codecs="vp8"'; // 전송 측에서 사용한 mimeType과 일치해야 함
      const sourceBuffer = mediaSource.addSourceBuffer(mime);
      
      // 청크를 순차적으로 추가하기 위한 큐 (간단한 예시)
      const queue = [];
      let isUpdating = false;
      
      // SourceBuffer에 청크를 추가하는 함수
      const appendChunk = (chunk) => {
        if (sourceBuffer.updating || isUpdating) {
          // 업데이트 중이면 큐에 저장
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

      // 업데이트가 완료되면 큐에 있는 청크들을 추가
      sourceBuffer.addEventListener('updateend', () => {
        isUpdating = false;
        if (queue.length > 0) {
          const nextChunk = queue.shift();
          appendChunk(nextChunk);
        }
      });

      // Socket.IO로부터 'video-frame' 이벤트 수신
      socket.on('video-frame', (data) => {
        // data는 ArrayBuffer로 전송된 청크여야 합니다.
        const chunk = new Uint8Array(data);
        appendChunk(chunk);
      });
    });
  } else {
    console.error("MediaSource API가 이 브라우저에서 지원되지 않습니다.");
  }
});
