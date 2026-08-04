const FfmpegRunner = require('./FfmpegRunner');
const sharp = require('sharp');

class AppStudioComposer {
  static async composeFullScreenWithVoiceover(appVideoPath, voiceoverPath, outputPath) {
    const args = [
      '-y',
      '-i', appVideoPath,
      '-i', voiceoverPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-shortest',
      outputPath
    ];
    await FfmpegRunner.run(args, 'simple');
    return outputPath;
  }

  static async composePictureInPicture(appVideoPath, presenterVideoPath, outputPath) {
    const args = [
      '-y',
      '-i', appVideoPath,
      '-i', presenterVideoPath,
      '-filter_complex', '[1:v]scale=w=iw/4:h=ih/4[pip];[0:v][pip]overlay=main_w-overlay_w-20:main_h-overlay_h-20',
      '-c:a', 'aac',
      '-shortest',
      outputPath
    ];
    await FfmpegRunner.run(args, 'complex');
    return outputPath;
  }

  static async composeSplitScreen(appVideoPath, presenterVideoPath, outputPath) {
    const args = [
      '-y',
      '-i', presenterVideoPath,
      '-i', appVideoPath,
      '-filter_complex', '[0:v]scale=iw/2:ih[l];[1:v]scale=iw/2:ih[r];[l][r]hstack',
      '-c:a', 'aac',
      '-shortest',
      outputPath
    ];
    await FfmpegRunner.run(args, 'complex');
    return outputPath;
  }

  static async composeStaticDeviceFrame(appScreenshotPath, deviceFramePath, outputPath) {
    // Uses Sharp C++ canvas compositing for 9:16 iPhone 16 Pro frame
    await sharp(deviceFramePath)
      .composite([
        { input: appScreenshotPath, top: 100, left: 50 } // Example coordinates
      ])
      .toFile(outputPath);
    return outputPath;
  }
}

module.exports = AppStudioComposer;
