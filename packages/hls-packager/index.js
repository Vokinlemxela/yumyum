import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const videoPath = args.find(arg => !arg.startsWith('--'));
const isHEVC = args.includes('--hevc');

// Clear/determine directories
const currentDir = process.cwd();
const publicDir = path.join(currentDir, 'apps', 'web', 'public');
const outputDir = path.join(publicDir, 'custom-stream');

console.log('\n=== HLS STREAM PACKAGER TOOL ===\n');

// 1. Verify arguments
if (!videoPath) {
  console.error('\x1b[31mОшибка: Укажите путь к видеофайлу.\x1b[0m');
  console.log('Использование: npm run package -- <путь_к_видео> [--hevc]\n');
  process.exit(1);
}

const absoluteVideoPath = path.isAbsolute(videoPath)
  ? videoPath
  : path.join(currentDir, videoPath);

try {
  const stats = fs.lstatSync(absoluteVideoPath);
  if (!stats.isFile()) {
    console.error(`\x1b[31mОшибка: Путь "${absoluteVideoPath}" не является обычным файлом.\x1b[0m\n`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\x1b[31mОшибка: Файл "${absoluteVideoPath}" не существует или недоступен для чтения.\x1b[0m\n`);
  process.exit(1);
}

// 2. Check for FFmpeg installation
let ffmpegPath = 'ffmpeg';
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch (e) {
  // If not found in default PATH, try standard mac/homebrew paths
  const commonPaths = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  let found = false;
  for (const p of commonPaths) {
    try {
      if (fs.existsSync(p)) {
        ffmpegPath = p;
        found = true;
        break;
      }
    } catch (err) {}
  }
  if (!found) {
    console.warn('\x1b[33mПредупреждение: FFmpeg не обнаружен в вашей системе.\x1b[0m');
    console.log('Для работы утилиты необходимо установить FFmpeg.');
    console.log('Пожалуйста, выполните команду установки на вашем Mac:\n');
    console.log('    \x1b[32mbrew install ffmpeg\x1b[0m\n');
    console.log('После завершения установки перезапустите этот скрипт.\n');
    process.exit(1);
  }
}

// 3. Clear/create target public output folder
if (fs.existsSync(outputDir)) {
  console.log('Очистка старого потока в custom-stream...');
  fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

// 4. Configure optimized packaging flags
const playlistName = 'stream.m3u8';
const segmentNamePattern = 'seq_%03d.ts';

const ffmpegArgs = [
  '-i', absoluteVideoPath,
  // Video options
  '-codec:v', isHEVC ? 'libx265' : 'libx264',
  '-preset', 'fast',
  '-crf', '22',
  '-g', '60', // Keyframe spacing (2 seconds at 30fps)
  '-sc_threshold', '0',
  // Audio options
  '-codec:a', 'aac',
  '-b:a', '128k',
  '-ac', '2',
  '-ar', '44100',
  // HLS Packaging options
  '-f', 'hls',
  '-hls_time', '2', // Segment duration 2 seconds
  '-hls_playlist_type', 'vod',
  '-hls_segment_filename', path.join(outputDir, segmentNamePattern),
  path.join(outputDir, playlistName)
];

console.log(`Начало кодирования ${isHEVC ? 'H.265 (HEVC)' : 'H.264 (AVC)'} + AAC...`);
console.log(`Команда: ffmpeg ${ffmpegArgs.join(' ')}\n`);

const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

ffmpegProcess.on('error', (err) => {
  console.error(`\x1b[31mОшибка при запуске процесса FFmpeg: ${err.message}\x1b[0m\n`);
  process.exit(1);
});

ffmpegProcess.stderr.on('data', (data) => {
  const line = data.toString();
  // Filter and show progress time lines
  if (line.includes('time=')) {
    const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
    if (timeMatch) {
      process.stdout.write(`\rПрогресс кодирования: \x1b[36m${timeMatch[1]}\x1b[0m`);
    }
  }
});

ffmpegProcess.on('close', (code) => {
  console.log('\n');
  if (code === 0) {
    console.log('\x1b[32m=== УСПЕШНО ЗАВЕРШЕНО ===\x1b[0m');
    console.log('Поток нарезан на 2-секундные сегменты и сохранен в public каталог Next.js.\n');
    console.log('Ссылка для вставки в плеер:');
    
    // Suggest port 3001 or 3000 depending on active listener
    console.log('👉 \x1b[32mhttp://localhost:3001/custom-stream/stream.m3u8\x1b[0m');
    console.log('👉 \x1b[32mhttp://localhost:3000/custom-stream/stream.m3u8\x1b[0m\n');
  } else {
    console.error(`\x1b[31mОшибка: Процесс FFmpeg завершился с кодом: ${code}\x1b[0m\n`);
    process.exit(code || 1);
  }
});
