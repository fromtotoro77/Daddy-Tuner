import { Visualizer } from './visualizer.js';

// 소리가 끊긴 뒤 화면을 "-" 로 되돌리기까지 기다리는 시간(ms)
const SILENCE_RESET_MS = 1500;
// 찾는 가장 낮은 음(Hz). 기타 6번줄 E2(82.41Hz)보다 조금 낮게(드롭 D 73Hz 포함), 전기 웅웅거림 60Hz 는 빠지게 잡는다.
const MIN_FREQ = 65;
// 찾는 가장 높은 음(Hz). 1번줄 12프렛 E5(659Hz)의 배 정도.
const MAX_FREQ = 1400;
// 이보다 작은 소리는 계산하지 않는다(자동 음량을 껐으므로 낮게 잡고, 잡음은 MIN_CLARITY 로 거른다).
const MIN_RMS = 0.002;
// 주기의 뚜렷함(NSDF 꼭짓점 0~1) 하한. 낮으면 잡음으로 본다.
const MIN_CLARITY = 0.6;
// 가장 높은 꼭짓점 대비 이 비율을 넘는 첫 꼭짓점을 주기로 고른다.
const PEAK_RATIO = 0.9;

// 오디오 다시 켜기를 기다리는 최대 시간(ms)
const RESUME_WAIT_MS = 500;

function waitAtMost(promise, ms) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

class DaddyTuner {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.stream = null;
        this.source = null;
        this.visualizer = null;
        this.isTuning = false;
        this.isStarting = false;
        this.rafId = null;
        this.lastHeard = 0;

        this.notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        this.standardTuning = [
            { note: 'E', frequency: 82.41 },
            { note: 'A', frequency: 110.00 },
            { note: 'D', frequency: 146.83 },
            { note: 'G', frequency: 196.00 },
            { note: 'B', frequency: 246.94 },
            { note: 'E', frequency: 329.63 }
        ];

        this.initUI();
    }

    initUI() {
        this.startButton = document.querySelector('#start-btn');
        this.noteDisplay = document.querySelector('#note-display');
        this.frequencyDisplay = document.querySelector('#freq-display');
        this.meter = document.querySelector('#meter-pointer');
        this.canvas = document.querySelector('#viz-canvas');

        this.startButton.addEventListener('click', () => this.toggleTuning());

        // iOS 는 권한 창·화면 잠금·전화 등으로 오디오를 멈춤(suspended/interrupted)으로 바꾼다.
        // 다음 터치 때 다시 켠다(터치 안에서만 resume 이 허용된다).
        document.addEventListener('pointerdown', () => this.ensureRunning(), true);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.ensureRunning();
        });
    }

    async toggleTuning() {
        if (this.isStarting) return;
        if (this.isTuning) {
            this.stopTuning();
        } else {
            await this.startTuning();
        }
    }

    // 오디오는 앱에서 하나만 만들어 계속 쓴다. 반드시 터치(클릭) 처리 안에서, await 전에 불러야 한다.
    getAudioContext() {
        if (!this.audioContext || this.audioContext.state === 'closed') {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new Ctx();
            this.audioContext.addEventListener('statechange', () => {
                if (this.isTuning && this.audioContext.state !== 'running') this.ensureRunning();
            });
        }
        return this.audioContext;
    }

    ensureRunning() {
        const ctx = this.audioContext;
        if (!ctx || !this.isTuning) return;
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            ctx.resume().catch(() => {});
        }
    }

    async startTuning() {
        this.isStarting = true;
        try {
            // 1) 터치 처리 안에서 오디오를 만들고 켠다(아이폰은 await 뒤엔 resume 이 막힐 수 있다).
            const ctx = this.getAudioContext();
            const resumeInGesture = ctx.resume().catch(() => {});

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw Object.assign(new Error('getUserMedia unsupported'), { name: 'Unsupported' });
            }

            // 2) 마이크. 잡음 제거·에코 제거·자동 음량은 길게 이어지는 악기 소리를 깎으므로 끈다.
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // 3) 권한 창이 떠 있던 동안 멈춤으로 바뀌었을 수 있으니 다시 켠다.
            //    사파리는 터치 밖 resume 약속을 끝없이 미뤄 둘 수 있어 잠깐만 기다린다(멈춤이면 아래 안내 → 터치로 켬).
            await waitAtMost(resumeInGesture, RESUME_WAIT_MS);
            if (ctx.state !== 'running') {
                await waitAtMost(ctx.resume().catch(() => {}), RESUME_WAIT_MS);
            }

            // 아이폰은 화면 잠금·전화·다른 앱의 녹음으로 마이크를 끊는다. 켜진 척 남지 않게 멈춘다.
            const stream = this.stream;
            stream.getAudioTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                    if (this.isTuning && this.stream === stream) {
                        this.stopTuning();
                        this.frequencyDisplay.textContent = '마이크가 끊겼어요. 다시 눌러 주세요';
                    }
                });
            });

            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.buffer = new Float32Array(this.analyser.fftSize);

            this.source = ctx.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);

            if (!this.visualizer) {
                this.visualizer = new Visualizer(this.canvas);
            }
            this.visualizer.start(this.analyser);

            this.isTuning = true;
            this.lastHeard = performance.now();
            this.startButton.textContent = 'STOP TUNING';
            this.startButton.classList.add('active');

            // 그래도 멈춤이면 화면을 한 번 더 누르면 켜진다(pointerdown 에서 resume).
            if (ctx.state !== 'running') {
                this.frequencyDisplay.textContent = '화면을 한 번 눌러 주세요';
            }

            this.update();
        } catch (err) {
            console.error('Error accessing microphone:', err);
            this.releaseMic();
            alert(this.micErrorMessage(err));
        } finally {
            this.isStarting = false;
        }
    }

    // 오류 종류마다 해결 방법이 다르므로 나눠서 알려 준다.
    micErrorMessage(err) {
        switch (err && err.name) {
            case 'Unsupported':
                return '이 브라우저에서는 마이크를 쓸 수 없어요.\n카카오톡 등 앱 안에서 열었다면 사파리나 크롬으로 열어 주세요.';
            case 'NotAllowedError':
            case 'SecurityError':
                return '마이크 권한이 꺼져 있어요.\n브라우저 설정에서 이 사이트의 마이크를 허용한 뒤 다시 눌러 주세요.';
            case 'NotFoundError':
            case 'OverconstrainedError':
                return '마이크를 찾지 못했어요.';
            case 'NotReadableError':
            case 'AbortError':
                return '다른 앱이 마이크를 쓰고 있어요.\n통화·녹음 앱을 닫고 다시 눌러 주세요.';
            default:
                return '마이크를 켜지 못했어요. (' + ((err && err.name) || '알 수 없는 오류') + ')';
        }
    }

    releaseMic() {
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
        }
    }

    stopTuning() {
        this.isTuning = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.visualizer) this.visualizer.stop();
        this.releaseMic();
        // 오디오는 닫지 않고 멈추기만 한다(다시 켤 때 새로 만들면 아이폰에서 또 멈춤 문제가 난다).
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioContext.suspend().catch(() => {});
        }
        this.resetDisplay();
        this.startButton.textContent = 'START TUNING';
        this.startButton.classList.remove('active');
    }

    resetDisplay() {
        this.noteDisplay.textContent = '-';
        this.noteDisplay.classList.remove('in-tune');
        this.frequencyDisplay.textContent = '0.00 Hz';
        this.meter.style.transform = 'translateX(-50%) rotate(0deg)';
    }

    update() {
        if (!this.isTuning) return;

        this.analyser.getFloatTimeDomainData(this.buffer);
        const frequency = this.autocorrelate(this.buffer, this.audioContext.sampleRate);
        const now = performance.now();

        if (frequency !== -1) {
            this.lastHeard = now;
            const noteData = this.getNoteFromFrequency(frequency);
            this.updateUI(noteData, frequency);
        } else if (now - this.lastHeard > SILENCE_RESET_MS && this.noteDisplay.textContent !== '-') {
            this.resetDisplay();
        }

        this.rafId = requestAnimationFrame(() => this.update());
    }

    // 맥러드 방식(NSDF) 음높이 찾기.
    // 지연마다 겹치는 구간의 에너지로 나눠 0~1 로 맞춘다. 나누지 않으면 겹침이 짧은
    // 긴 지연이 불리해져 음이 높게(저음 줄 +5~9센트) 나온다.
    autocorrelate(buffer, sampleRate) {
        const size = buffer.length;

        let mean = 0;
        for (let i = 0; i < size; i++) mean += buffer[i];
        mean /= size;

        const x = this.work && this.work.length === size ? this.work : (this.work = new Float32Array(size));
        let energy = 0;
        for (let i = 0; i < size; i++) {
            x[i] = buffer[i] - mean;
            energy += x[i] * x[i];
        }
        if (Math.sqrt(energy / size) < MIN_RMS) return -1;

        const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
        const maxLag = Math.min(size - 1, Math.ceil(sampleRate / MIN_FREQ) + 2);
        if (maxLag <= minLag + 2) return -1;

        const nsdf = this.nsdf && this.nsdf.length === maxLag + 1 ? this.nsdf : (this.nsdf = new Float32Array(maxLag + 1));
        // m(τ) = Σ (x[j]² + x[j+τ]²), j = 0..size-1-τ. τ 가 1 늘 때마다 양 끝 한 칸씩 빠진다.
        let m = 2 * energy;
        for (let tau = 0; tau <= maxLag; tau++) {
            if (tau > 0) m -= x[size - tau] * x[size - tau] + x[tau - 1] * x[tau - 1];
            let r = 0;
            for (let j = 0, n = size - tau; j < n; j++) r += x[j] * x[j + tau];
            nsdf[tau] = m > 0 ? (2 * r) / m : 0;
        }

        // 0 아래로 내려갔다 다시 올라온 구간마다 꼭짓점을 하나씩 모은다.
        const peaks = [];
        let tau = 1;
        while (tau < maxLag && nsdf[tau] > 0) tau++;      // 첫 번째 양수 구간(지연 0 근처)은 건너뛴다
        let best = -1, bestTau = -1;
        for (; tau < maxLag; tau++) {
            if (nsdf[tau] > 0) {
                if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
            } else if (bestTau !== -1) {
                peaks.push(bestTau);
                best = -1; bestTau = -1;
            }
        }
        if (bestTau !== -1 && bestTau < maxLag - 1) peaks.push(bestTau);
        if (!peaks.length) return -1;

        // 가장 높은 꼭짓점의 PEAK_RATIO 배를 넘는 첫 꼭짓점을 주기로 본다(한 옥타브 낮게 잡는 실수 방지).
        let highest = 0;
        for (const p of peaks) if (nsdf[p] > highest) highest = nsdf[p];
        if (highest < MIN_CLARITY) return -1;   // 주기가 뚜렷하지 않음(잡음, 소리가 끊기는 순간)
        let period = peaks[0];
        for (const p of peaks) {
            if (nsdf[p] >= highest * PEAK_RATIO) { period = p; break; }
        }
        if (period < minLag || period >= maxLag) return -1;

        // 꼭짓점 앞뒤 세 점으로 주기를 소수점까지 보정한다.
        const y1 = nsdf[period - 1], y2 = nsdf[period], y3 = nsdf[period + 1];
        const a = (y1 + y3 - 2 * y2) / 2;
        const b = (y3 - y1) / 2;
        const T0 = a < 0 ? period - b / (2 * a) : period;

        return sampleRate / T0;
    }

    getNoteFromFrequency(frequency) {
        const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
        const rolledNote = Math.round(noteNum) + 69;
        const noteName = this.notes[((rolledNote % 12) + 12) % 12];
        const octave = Math.floor(rolledNote / 12) - 1;

        const idealFrequency = 440 * Math.pow(2, (rolledNote - 69) / 12);
        const cents = Math.round(1200 * Math.log(frequency / idealFrequency) / Math.log(2));

        return { name: noteName, octave, cents };
    }

    updateUI(noteData, frequency) {
        this.noteDisplay.textContent = noteData.name;
        this.frequencyDisplay.textContent = `${frequency.toFixed(2)} Hz`;

        const rotation = Math.max(-45, Math.min(45, noteData.cents));
        this.meter.style.transform = `translateX(-50%) rotate(${rotation}deg)`;

        if (Math.abs(noteData.cents) < 5) {
            this.noteDisplay.classList.add('in-tune');
        } else {
            this.noteDisplay.classList.remove('in-tune');
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new DaddyTuner();
});
