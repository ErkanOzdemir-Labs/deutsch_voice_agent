// ============================================
// DeutschVoice Agent — Waveform Visualizer
// Real-time audio frequency visualization
// ============================================

export class WaveformVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.analyser = null;
    this.animationId = null;
    this.isActive = false;

    // Responsive canvas sizing
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  /**
   * Start visualizing audio from an AnalyserNode
   * @param {AnalyserNode} analyser
   */
  start(analyser) {
    this.analyser = analyser;
    this.isActive = true;
    this._animate();
  }

  /**
   * Stop visualization
   */
  stop() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    // Fade out
    this._clear();
  }

  _animate() {
    if (!this.isActive) return;

    this._draw();
    this.animationId = requestAnimationFrame(() => this._animate());
  }

  _draw() {
    const { ctx, analyser, width, height } = this;
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw bars
    const barCount = 40;
    const barWidth = (width / barCount) * 0.6;
    const gap = (width / barCount) * 0.4;
    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      // Map bar index to frequency data index
      const dataIdx = Math.floor((i / barCount) * bufferLength);
      const value = dataArray[dataIdx] / 255;

      const barHeight = Math.max(2, value * (height * 0.8));
      const x = i * (barWidth + gap) + gap / 2;

      // Create gradient for each bar
      const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);

      // Color based on amplitude (blue → gold → red)
      if (value > 0.7) {
        gradient.addColorStop(0, 'hsla(0, 85%, 58%, 0.9)');
        gradient.addColorStop(1, 'hsla(0, 85%, 58%, 0.3)');
      } else if (value > 0.4) {
        gradient.addColorStop(0, 'hsla(45, 100%, 55%, 0.9)');
        gradient.addColorStop(1, 'hsla(45, 100%, 55%, 0.3)');
      } else {
        gradient.addColorStop(0, 'hsla(210, 100%, 60%, 0.8)');
        gradient.addColorStop(1, 'hsla(210, 100%, 60%, 0.2)');
      }

      ctx.fillStyle = gradient;

      // Draw rounded bar (symmetric around center)
      const radius = Math.min(barWidth / 2, 3);
      const y = centerY - barHeight / 2;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();
    }
  }

  _clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }
}
