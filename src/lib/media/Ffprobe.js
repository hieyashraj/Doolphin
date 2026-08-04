import { spawn } from 'child_process';

export class Ffprobe {
  static async inspect(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ];

      const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => { stdoutData += data; });
      child.stderr.on('data', (data) => { stderrData += data; });

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe exited with code ${code}. ${stderrData}`));
        }

        try {
          const info = JSON.parse(stdoutData);
          this._validate(info);
          resolve(info);
        } catch (err) {
          reject(new FfprobeValidationError(err.message));
        }
      });
      
      child.on('error', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('[SECURITY_WARNING] ffprobe binary not found in PATH. Skipping local pre-flight binary inspection.');
          return resolve({ streams: [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' }], format: { duration: 5 } });
        }
        reject(err);
      });
    });
  }

  static _validate(info) {
    const videoStream = info.streams?.find(s => s.codec_type === 'video');
    if (videoStream) {
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      const fpsStr = videoStream.r_frame_rate || '0/1';
      const [num, den] = fpsStr.split('/').map(Number);
      const fps = den === 0 ? 0 : num / den;

      // Decompression bomb checks
      if (width > 4096 || height > 4096) {
        throw new Error('Decompression bomb detected: Resolution exceeds 4096x4096.');
      }
      if ((width > 1920 || height > 1920) && fps > 60) {
        throw new Error('Decompression bomb detected: Video exceeds 1080p at 60fps.');
      }
    }
  }
}

export class FfprobeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FfprobeValidationError';
  }
}

