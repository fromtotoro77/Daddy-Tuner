import { Visualizer } from './visualizer.js';

class DaddyTuner {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.source = null;
        this.isTuning = false;

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
    }

    async toggleTuning() {
        if (this.isTuning) {
            this.stopTuning();
        } else {
            await this.startTuning();
        }
    }

    async startTuning() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            
            this.source = this.audioContext.createMediaStreamSource(stream);
            this.source.connect(this.analyser);

            this.visualizer = new Visualizer(this.canvas, this.analyser);
            this.visualizer.draw();

            this.isTuning = true;
            this.startButton.textContent = 'STOP TUNING';
            this.startButton.classList.add('active');
            
            this.update();
        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Microphone access is required for tuning.');
        }
    }

    stopTuning() {
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.isTuning = false;
        this.startButton.textContent = 'START TUNING';
        this.startButton.classList.remove('active');
    }

    update() {
        if (!this.isTuning) return;

        const buffer = new Float32Array(this.analyser.fftSize);
        this.analyser.getFloatTimeDomainData(buffer);

        const frequency = this.autocorrelate(buffer, this.audioContext.sampleRate);

        if (frequency !== -1) {
            const noteData = this.getNoteFromFrequency(frequency);
            this.updateUI(noteData, frequency);
        }

        requestAnimationFrame(() => this.update());
    }

    autocorrelate(buffer, sampleRate) {
        let size = buffer.length;
        let rms = 0;

        for (let i = 0; i < size; i++) {
            rms += buffer[i] * buffer[i];
        }
        rms = Math.sqrt(rms / size);
        if (rms < 0.01) return -1;

        let r1 = 0, r2 = size - 1, thres = 0.2;
        for (let i = 0; i < size / 2; i++) {
            if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
        }
        for (let i = 1; i < size / 2; i++) {
            if (Math.abs(buffer[size - i]) < thres) { r2 = size - i; break; }
        }

        buffer = buffer.slice(r1, r2);
        size = buffer.length;

        let c = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size - i; j++) {
                c[i] = c[i] + buffer[j] * buffer[j + i];
            }
        }

        let d = 0;
        while (c[d] > c[d + 1]) d++;
        let maxval = -1, maxpos = -1;
        for (let i = d; i < size; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        let T0 = maxpos;

        return sampleRate / T0;
    }

    getNoteFromFrequency(frequency) {
        const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
        const rolledNote = Math.round(noteNum) + 69;
        const noteName = this.notes[rolledNote % 12];
        const octave = Math.floor(rolledNote / 12) - 1;
        
        const idealFrequency = 440 * Math.pow(2, (rolledNote - 69) / 12);
        const cents = Math.floor(1200 * Math.log(frequency / idealFrequency) / Math.log(2));

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
