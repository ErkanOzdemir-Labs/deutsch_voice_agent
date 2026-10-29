/**
 * AudioWorkletProcessor for playback of 24kHz PCM audio from Gemini Live API.
 * Receives Float32 arrays from the main thread and queues them for playback.
 */
class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.currentBuffer = null;
    this.currentIndex = 0;

    this.port.onmessage = (event) => {
      this.queue.push(event.data);
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    
    for (let i = 0; i < output[0].length; i++) {
      if (!this.currentBuffer || this.currentIndex >= this.currentBuffer.length) {
        if (this.queue.length > 0) {
          this.currentBuffer = this.queue.shift();
          this.currentIndex = 0;
        } else {
          this.currentBuffer = null;
        }
      }

      let sample = 0;
      if (this.currentBuffer) {
        sample = this.currentBuffer[this.currentIndex++];
      }

      for (let channel = 0; channel < output.length; channel++) {
        output[channel][i] = sample;
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor);
