// Sender-side (client)
const { ipcRenderer } = require("electron");
const io = require('socket.io-client');
//const socket = io('http://223.194.152.78:3000');
const socket = io('http://localhost:3000');
const fs = require('fs');
const path = require('path');
const os = require('os');

let userClickTime = null;      // 사용자 클릭 시각
let firstFrameSentTime = null; // 첫 프레임 전송 시각
let isFirst = true;  // 첫 프레임인지 여부 체크

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
const experimentNumber = 1;

const logFileName = `log_${timestamp}_${experimentNumber}.txt`;
const logStream = fs.createWriteStream(logFileName, { flags: 'a' });

const originalLog = console.log;
console.log = function (...args) {
    const timeStr = new Date().toLocaleString();
    const msg = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
    const fullMsg = `[${timeStr}] ${msg}`;

    originalLog(fullMsg);
    logStream.write(fullMsg + '\n');
};

const MAX = 100000000;
let mediaRecorder;
const chunks = new Array(MAX);
let chunkIdx = 0;
// chunk 간격 측정을 위한 변수
let startTime = null;      // 녹화 시작 시각
let lastChunkTime = null;  // 바로 이전 chunk가 발생한 시각
const MILESTONES = [60000, 300000, 1800000];

async function startScreenShare() {
    userClickTime = Date.now();
    try {
        const sources = await ipcRenderer.invoke('get-sources');
        const screenSource = sources[0];

        // 15fps 제한 (chromeMediaSource)
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 15
                }
            }
        });

        const video = document.getElementById('video');
        video.srcObject = stream;
        video.play();

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm; codecs=vp8',
            videoBitsPerSecond: 2000000,
            //videoKeyFrameIntervalDuration:150
        });

        // 녹화 종료 시 처리
        mediaRecorder.onstop = () => {
            if (chunkIdx === 0) {
                console.error("녹화된 chunk 없음");
                return;
            }

            const totalChunks = Math.min(chunkIdx, MAX);
            const startIdx = chunkIdx >= MAX ? (chunkIdx % MAX) : 0;

            const orderedChunks = [];
            for (let i = 0; i < totalChunks; i++) {
                const chunk = chunks[(startIdx + i) % MAX];
                if (chunk) {  // null 아닌 것만 push
                    orderedChunks.push(chunk);
                }
            }

            const blob = new Blob(orderedChunks, { type: 'video/webm' });
            const filePath = `recorded_${timestamp}_${experimentNumber}.webm`;
            const reader = new FileReader();

            reader.onload = () => {
                const buffer = Buffer.from(reader.result);
                fs.writeFile(filePath, buffer, (err) => {
                    if (err) {
                        console.error("웹엠 저장 실패:", err);
                    } else {
                        console.log(`녹화 파일 저장 완료: ${filePath}`);
                        analyzeVideoFPS(filePath);
                    }
                });
            };
            reader.readAsArrayBuffer(blob);
        };

        // 실제 chunk가 만들어졌을 때(ondataavailable)
        mediaRecorder.ondataavailable = async (event) => {
            const nowTime = performance.now();
            const sliceDurMs  = lastChunkTime ? nowTime - lastChunkTime : 0;


            // if (!lastChunkTime) {
            //     const diffFromStart = nowTime - startTime;
            //     console.log(`\n[첫 chunk 발생] 녹화 시작 후 ${diffFromStart}ms 만에 chunk가 만들어짐`);
            //     lastChunkTime = nowTime;
            // }


            // if (lastChunkTime !== null) {
            //     const diff = nowTime - lastChunkTime;
            //     console.log(`🧩 chunk #${++chunkIdx}  간격: ${diff.toFixed(1)} ms`);
            // } else {
            //     console.log(`🧩 chunk #${++chunkIdx}  (first)`);
            // }
            lastChunkTime = nowTime;

            if (event.data.size > 0) {
                chunks[chunkIdx++ % MAX] = event.data;

                const buffer = await event.data.arrayBuffer();

                // 첫 프레임이면 시간 측정
                // if (!firstFrameSentTime) {
                //     firstFrameSentTime = Date.now();
                //     const latency = firstFrameSentTime - userClickTime;
                //     console.log(`\n🚀 버튼 클릭 후 첫 프레임 서버 전송까지 걸린 시간: ${latency}ms`);
                // }

                socket.emit('video-frame', {
                    buffer,
                    idx:  chunkIdx,          // 청크 번호
                    dur:  sliceDurMs,          // 이번 청크 길이(ms)isFirst });
                    tSend: nowTime, 
                    isFirst: false
                });
                //analyzeChunkFrames(event.data, nowTime);
            }
        };

        // 녹화 시작 시각 기록
        startTime = Date.now();

        // 150ms 간격으로 chunk 발생
        mediaRecorder.start(150);
        console.log("화면 공유 시작");

        MILESTONES.forEach((ms) => {
            setTimeout(() => {
                socket.emit("milestone", {
                    mark: ms,          
                    senderTime: Date.now(),
                });
            }, ms);
        });
        // ---- auto‑stop after 30 min ----
        setTimeout(stopScreenShare, 60000);

    } catch (err) {
        console.error('화면 캡처 오류:', err);
    }
}

function analyzeChunkFrames(blob, timestamp) {
    const reader = new FileReader();

    reader.onload = () => {
        const buffer = Buffer.from(reader.result);
        const tempFilePath = path.join(os.tmpdir(), `chunk_${timestamp}.webm`);

        fs.writeFile(tempFilePath, buffer, (err) => {
            if (err) {
                console.error("임시 chunk 저장 실패:", err);
                return;
            }

            const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${tempFilePath}"`;

            exec(ffprobeCmd, (err, stdout, stderr) => {
                if (err) {
                    console.error("❌ ffprobe chunk 분석 오류:", err);
                    return;
                }

                const totalFrames = parseInt(stdout.trim());
                console.log(`✅ 현재 chunk 프레임 수: ${totalFrames}`);

                // 분석 후 임시 파일 삭제 (선택)
                fs.unlink(tempFilePath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error("임시 파일 삭제 실패:", unlinkErr);
                    }
                });
            });
        });
    };

    reader.readAsArrayBuffer(blob);
}

socket.on('first-frame-ack', ({ receiveTime }) => {
    const ackReceiveTime = Date.now(); // 클라이언트가 ACK 받은 시각
    const rtt = ackReceiveTime - firstFrameSentTime;
    const oneWayLatency = rtt / 2;

    console.log(`📨 서버로부터 첫 프레임 ACK 수신!`);
    console.log(`🔁 RTT (왕복 지연 시간): ${rtt}ms`);
    console.log(`➡️ 추정 단방향 지연 시간: ${oneWayLatency.toFixed(2)}ms`);
});

function stopScreenShare() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        console.log("⏹️ 화면 공유 중지!");

        setTimeout(() => {
            socket.emit('screen-share-ended');
            console.log("서버로 'screen-share-ended' 전송 완료");
        }, 5000);

        // 측정 변수 초기화
        startTime = null;
        lastChunkTime = null;
    }
}

document.getElementById('start').addEventListener('click', startScreenShare);
document.getElementById('stop').addEventListener('click', stopScreenShare);

socket.on('frame', (dataUrl) => {
    document.getElementById('screen').src = dataUrl;
});

// ffprobe 분석
const { exec } = require("child_process");
function analyzeVideoFPS(filePath) {
    const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 \
        -show_entries stream=nb_read_frames -of csv=p=0 "${filePath}"`;

    exec(ffprobeCmd, (err, stdout, stderr) => {
        if (err) {
            console.error("❌ ffprobe 실행 오류:", err);
            return;
        }
        const totalFrames = parseInt(stdout.trim());
        const durationSec = 60;
        const fps = totalFrames / durationSec;

        console.log(`\n📈 총 프레임 수: ${totalFrames}`);
        console.log(`⏱️ 실제 FPS: ${fps.toFixed(2)}`);
    });
}
