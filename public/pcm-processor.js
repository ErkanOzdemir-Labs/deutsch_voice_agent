/**
 * AudioWorkletProcessor for recording audio.
 * Converts 32-bit Float PCM to 16-bit Int PCM and batches it.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Int16Array(this.bufferSize);
    this.offset = 0;
    
    // VAD (Voice Activity Detection) Settings
    // Threshold out of 32768. Lowered to 30 to support quiet microphones.
    this.vadThreshold = 30; 
    // Keep sending audio for ~1 second after speech stops (8 buffers * 2048 samples = 16384 samples)
    // This allows the Gemini server to detect the silence and trigger its own end-of-turn.
    this.hangoverFrames = 8; 
    this.currentHangover = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        // Clamp and convert Float32 to Int16
        let sample = Math.max(-1, Math.min(1, channelData[i]));
        sample = sample < 0 ? sample * 32768 : sample * 32767;
        
        this.buffer[this.offset] = sample;
        this.offset++;

        // When buffer is full, process VAD and send
        if (this.offset >= this.bufferSize) {
          
          // 1. Calculate RMS of the buffer
          let sumSquares = 0;
          for (let j = 0; j < this.bufferSize; j++) {
            sumSquares += this.buffer[j] * this.buffer[j];
          }
          const rms = Math.sqrt(sumSquares / this.bufferSize);
          const isSpeech = rms > this.vadThreshold;
          
          // 2. Manage hangover frames
          if (isSpeech) {
            this.currentHangover = this.hangoverFrames; // Reset hangover
          }
          
          // 3. Send audio if it's speech OR we are in the hangover period
          if (isSpeech || this.currentHangover > 0) {
            this.port.postMessage(this.buffer.slice(0));
            
            if (!isSpeech) {
              this.currentHangover--;
            }
          }

          this.offset = 0;
        }
      }
    }
    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
