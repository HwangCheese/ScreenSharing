const { ipcRenderer } = require("electron");
const io = require('socket.io-client');
//const socket = io('http://192.168.137.1:3000'); 
const socket = io('http://localhost:3000'); 
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require("child_process");

let userClickTime = null; 
let frameSentTime = null; 
let startTime = null; 

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
const experimentNumber = 1;
const logFileName = `sender_log_${timestamp}_${experimentNumber}.txt`;
const logStream = fs.createWriteStream(logFileName, { flags: 'a' });

// Setup logging to both console and file
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

let lastChunkTime = null;  
const chunkTimes = new Array(MAX);  
const chunkDurations = new Array(MAX); 
const chunkSizes = new Array(MAX);
let sumSize = 0;
let minSize = Infinity;
let maxSize = -Infinity;

const MILESTONES = [60000, 300000, 1800000]; 

async function startScreenShare() {
    userClickTime = Date.now();
    try {
        const sources = await ipcRenderer.invoke('get-sources');
        const screenSource = sources[0];

        // Set up 15fps limit
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
        });

        // Handle recording stop
        mediaRecorder.onstop = () => {
            if (chunkIdx === 0) {
                console.error("No chunks recorded");
                return;
            }

            // Save recorded chunks to WebM file
            const totalChunks = Math.min(chunkIdx, MAX);
            const startIdx = chunkIdx >= MAX ? (chunkIdx % MAX) : 0;

            const orderedChunks = [];
            for (let i = 0; i < totalChunks; i++) {
                const chunk = chunks[(startIdx + i) % MAX];
                if (chunk) {
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
                        console.error("Failed to save WebM:", err);
                    } else {
                        console.log(`Recording saved: ${filePath}`);
                        analyzeVideoFPS(filePath);
                    }
                });
            };
            reader.readAsArrayBuffer(blob);

            const avgSizeNow = chunkIdx ? (sumSize / chunkIdx) / (1024 * 1024) : 0;
            
            const timingData = {
                chunkDurations: chunkDurations.slice(0, chunkIdx-1),
                chunkSizes: chunkSizes.slice(0, chunkIdx),
                averageDuration: chunkDurations.reduce((a, b) => a + b, 0) / (chunkIdx - 1),
                sizeStats: { avg: avgSizeNow, min: minSize / (1024 * 1024), max: maxSize / (1024 * 1024) }
            };
            fs.writeFileSync(`chunk_timing_${timestamp}.json`, JSON.stringify(timingData));
            console.log(`Chunk timing data saved to chunk_timing_${timestamp}.json`);
        };

        mediaRecorder.ondataavailable = async (event) => {
            frameSentTime = performance.now();
            const sliceDurMs = lastChunkTime ? frameSentTime - lastChunkTime : 0;
            
            chunkTimes[chunkIdx] = frameSentTime;
            if (lastChunkTime) {
                chunkDurations[chunkIdx-1] = sliceDurMs;
            }
            
            lastChunkTime = frameSentTime;

            if (event.data.size > 0) {
                chunks[chunkIdx % MAX] = event.data;
                chunkSizes[chunkIdx] = event.data.size;
                const buffer = await event.data.arrayBuffer();
            
                sumSize += event.data.size;
    if (event.data.size < minSize) minSize = event.data.size;
    if (event.data.size > maxSize) maxSize = event.data.size;

                // Send frame to server with timing metadata
                socket.emit('video-frame', {
                    buffer,
                    idx: chunkIdx,
                    dur: sliceDurMs,
                    tAbs: Date.now(),
                });
            
                //console.log(`Chunk #${chunkIdx} generated, interval = ${sliceDurMs.toFixed(2)}ms`);  // ⬅️ 추가
            
                chunkIdx++;
            }
            
        };

        // Record start time and begin recording
        startTime = performance.now();
        lastChunkTime = startTime;
        
        // Start recording with timeslice of 150ms
        mediaRecorder.start(150);
        console.log("Screen sharing started");

        // Set up milestone emissions
        MILESTONES.forEach((ms) => {
            setTimeout(() => {
                // Calculate average chunk duration at this point
                const durations = chunkDurations.slice(0, chunkIdx);
                const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
                const avgSizeNow = chunkIdx ? (sumSize / chunkIdx) / (1024 * 1024) : 0;

                socket.emit("milestone", {
                    mark: ms,
                    senderTime: Date.now(),
                    avgChunkDuration: avgDuration,
                    totalChunks: chunkIdx,
                    minLate: minLate,
                    maxLate: maxLate,
                    avgLate: sumLate / latencyIdx,
                    minSize: minSize / (1024 * 1024),
                    maxSize: maxSize / (1024 * 1024),
                    avgSize: avgSizeNow
                });
                
                console.log(`Milestone ${ms}ms: Average chunk duration = ${avgDuration.toFixed(2)}ms`);
            }, ms);
        });
        
        // Auto-stop after 30 min
        setTimeout(stopScreenShare, 1800000);

    } catch (err) {
        console.error('Screen capture error:', err);
    }
}

function stopScreenShare() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        console.log("Screen sharing stopped!");

        setTimeout(() => {
            socket.emit('screen-share-ended');
            console.log("'screen-share-ended' sent to server");
        }, 5000);

        // Reset timing variables
        startTime = null;
        lastChunkTime = null;
    }
}

const MAX_FRAME_LOG = 10000000;
const oneWayLatencies = new Array(MAX_FRAME_LOG).fill(null);
let sumLate = 0;
let latencyIdx = 0;
let minLate = Infinity;
let maxLate = -Infinity;

socket.on('ack-frame', () => {
    const ackReceiveTime = performance.now();
    const rtt = ackReceiveTime - frameSentTime;
    const oneWayLatency = rtt / 2;
    oneWayLatencies[latencyIdx % MAX_FRAME_LOG] = oneWayLatency;
    sumLate += oneWayLatency;
    if (oneWayLatency < minLate) minLate = oneWayLatency;
    if (oneWayLatency > maxLate) maxLate = oneWayLatency;
    latencyIdx++;
});

// Handle first frame acknowledgment from server
// socket.on('first-frame-ack', ({ receiveTime, serverTime }) => {
//     const ackReceiveTime = Date.now(); // Time client received ACK
//     const rtt = ackReceiveTime - frameSentTime;
//     const oneWayLatency = rtt / 2;
    
//     // Calculate time offset between client and server
//     const timeOffset = serverTime - ackReceiveTime;

//     console.log(`Received first frame ACK from server!`);
//     console.log(`RTT (round-trip time): ${rtt}ms`);
//     console.log(`Estimated one-way latency: ${oneWayLatency.toFixed(2)}ms`);
//     console.log(`Time offset between client and server: ${timeOffset}ms`);
    
//     // Save sync data
//     fs.writeFileSync(`time_sync_${timestamp}.json`, JSON.stringify({
//         clientSendTime: frameSentTime,
//         serverReceiveTime: serverTime,
//         clientAckTime: ackReceiveTime,
//         rtt,
//         estimatedOneWayLatency: oneWayLatency,
//         timeOffset
//     }));
// });

// Set up UI handlers
document.getElementById('start').addEventListener('click', startScreenShare);
document.getElementById('stop').addEventListener('click', stopScreenShare);

// FFprobe video analysis
function analyzeVideoFPS(filePath) {
    const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 \
        -show_entries stream=nb_read_frames -of csv=p=0 "${filePath}"`;

    exec(ffprobeCmd, (err, stdout, stderr) => {
        if (err) {
            console.error("FFprobe error:", err);
            return;
        }
        const totalFrames = parseInt(stdout.trim());
        const durationSec = 60; // Assuming 1-minute recording
        const fps = totalFrames / durationSec;

        console.log(`Total frames: ${totalFrames}`);
        console.log(`Actual FPS: ${fps.toFixed(2)}`);
    });
}
