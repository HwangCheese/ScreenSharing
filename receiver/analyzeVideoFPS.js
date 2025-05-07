const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

function analyzeFrameIntervals(filePath, verbose = false) {
    return new Promise((resolve, reject) => {
        const abs = path.resolve(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));  // ex: i5_high_1

        // ffprobe로 DTS, PTS, best effort PTS 추출
        const cmd = `ffprobe -v error -select_streams v:0 `
            + `-show_entries frame=pkt_dts_time,pkt_pts_time,best_effort_timestamp_time `
            + `-of csv=p=0 "${abs}"`;

        exec(cmd, (err, out) => {
            if (err) return reject(err);

            const ts = out.trim().split("\n").map(line => {
                const [dts, pts, best] = line.split(",");
                return parseFloat(dts) || parseFloat(pts) || parseFloat(best);
            }).filter(Number.isFinite);

            if (ts.length < 2) {
                console.error("유효한 타임스탬프가 부족합니다.");
                return resolve(null);
            }

            const sorted = [...ts].sort((a, b) => a - b);

            const uniq = sorted.filter((t, i) => i === 0 || t !== sorted[i - 1]);

            const intervals = uniq.slice(1).map((t, i) => (t - uniq[i]) * 1000);

            const sum = intervals.reduce((a, b) => a + b, 0);
            const avg = sum / intervals.length;
            const min = Math.min(...intervals);
            const max = Math.max(...intervals);
            const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
            const stdDev = Math.sqrt(variance);

            console.log(`⏱️ 간격 통계 (ms):`);
            console.log(`   평균   : ${avg.toFixed(2)}`);
            console.log(`   최소   : ${min.toFixed(2)}`);
            console.log(`   최대   : ${max.toFixed(2)}`);
            console.log(`   표준편차: ${stdDev.toFixed(2)}`);
            if (verbose) {
                console.log("샘플:", intervals.slice(0, 20).map(v => v.toFixed(2)));
            }

            // ⑥ intervals 저장
            const savePath = `intervals/interval_${baseName}.txt`;
            fs.writeFileSync(savePath, intervals.map(v => v.toFixed(3)).join("\n"));
            console.log(`📄 간격(ms) 파일 저장 완료: ${savePath}`);

            resolve({ intervals, avg, min, max, stdDev });
        });
    });
}

(async () => {
    await analyzeFrameIntervals("./m2_low_5.webm", true);
})();
