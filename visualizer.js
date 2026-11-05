export class Visualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyser = null;
        this.rafId = null;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
    }

    // 다시 시작해도 그리기 반복은 하나만 돈다.
    start(analyser) {
        this.stop();
        this.analyser = analyser;
        this.bufferLength = analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        this.draw();
    }

    stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.analyser = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    draw() {
        if (!this.analyser) return;
        this.rafId = requestAnimationFrame(() => this.draw());

        this.analyser.getByteFrequencyData(this.dataArray);

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.ctx.clearRect(0, 0, width, height);

        const barWidth = (width / this.bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < this.bufferLength && x < width; i++) {
            barHeight = (this.dataArray[i] / 255) * height;

            const gradient = this.ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#f97316'); // Orange
            gradient.addColorStop(1, '#fbbf24'); // Yellow

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }
}
