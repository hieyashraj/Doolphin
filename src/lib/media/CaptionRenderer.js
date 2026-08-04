const FfmpegRunner = require('./FfmpegRunner');

class CaptionRenderer {
  static async render(inputVideoPath, captionsFile, ctaImagePath, outputPath) {
    // Renders subtitles and a CTA overlay at the bottom
    const args = [
      '-y',
      '-i', inputVideoPath,
      '-i', ctaImagePath,
      '-filter_complex', `[0:v]subtitles=${captionsFile}[v_sub];[v_sub][1:v]overlay=(main_w-overlay_w)/2:main_h-overlay_h-50`,
      '-c:a', 'copy',
      outputPath
    ];
    await FfmpegRunner.run(args, 'complex');
    return outputPath;
  }
}

module.exports = CaptionRenderer;
