const { exec } = require("child_process");
const path = require("path");

// 영상 프레임 수 분석 함수
function analyzeVideoFPS(filePath) {
    const absolutePath = path.resolve(filePath);
    const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${absolutePath}"`;

    exec(ffprobeCmd, (err, stdout, stderr) => {
        if (err) {
            console.error("❌ ffprobe 실행 오류:", err);
            return;
        }

        const totalFrames = parseInt(stdout.trim());
        if (isNaN(totalFrames)) {
            console.error("⚠️ 프레임 수를 파싱하지 못했습니다. 출력값:", stdout);
        } else {
            console.log(`📈 수신된 영상의 실제 프레임 수: ${totalFrames}`);
        }
    });
}

const testVideoPath = "./received_2025-04-08_07-23-45-996Z_1.webm"; 
analyzeVideoFPS(testVideoPath);
