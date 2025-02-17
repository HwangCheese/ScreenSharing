const { ipcRenderer } = require("electron");
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

// 화면 캡처 및 스트리밍 시작
async function startScreenShare() {
    try {
        // 메인 프로세스에 화면 소스 요청
        const sources = await ipcRenderer.invoke('get-sources');
        const screenSource = sources[0];  // 첫 번째 화면 소스를 선택

        // 화면 캡처 스트림 요청
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id,
                    maxWidth: 1920,
                    maxHeight: 1080
                }
            }
        });

        const video = document.getElementById('video');
        video.srcObject = stream;
        video.play();

        // MediaRecorder로 비디오 캡처
        const mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm; codecs=vp8', // 비디오 압축 코덱 (vp8, vp9 등)
            videoBitsPerSecond: 3000000, // 비디오 비트 전송률 설정 (3Mbps)
        });

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0) {
              try {
                  const startTime = performance.now(); // 시작 시간 기록
                  const buffer = await event.data.arrayBuffer();
                  const endTime = performance.now(); // 종료 시간 기록
      
                  // 압축된 데이터 크기 (바이트 → KB 변환)
                  const compressedSizeKB = buffer.byteLength / 1024;
      
                  // 예상 원본 데이터 크기 계산 (비트 전송률 기반)
                  const bitrate = 3000000; // 3Mbps (MediaRecorder 설정값)
                  const captureInterval = 100 / 1000; // 100ms → 초 단위 변환
                  const estimatedOriginalSize = (bitrate * captureInterval) / 8 / 1024; // KB 단위 변환
      
                  // 압축률 계산
                  const compressionRatio = (compressedSizeKB / estimatedOriginalSize) * 100;
      
                  console.log(`🔹 압축 시간: ${endTime - startTime}ms`);
                  console.log(`📏 압축된 데이터 크기: ${compressedSizeKB.toFixed(2)} KB`);
                  console.log(`📉 압축 비율: ${compressionRatio.toFixed(2)}%`);
      
                  socket.emit('video-frame', buffer);
              } catch (e) {
                  console.error('ArrayBuffer 변환 오류:', e);
              }
          }
        };          
          
        mediaRecorder.start(100);  // 100ms마다 비디오 캡처

    } catch (err) {
        console.error('화면 캡처 오류:', err);
    }
}

document.getElementById('start').addEventListener('click', startScreenShare);

// 'frame' 이벤트로 전송된 이미지 데이터를 화면에 표시
socket.on('frame', (dataUrl) => {
  document.getElementById('screen').src = dataUrl;
});
