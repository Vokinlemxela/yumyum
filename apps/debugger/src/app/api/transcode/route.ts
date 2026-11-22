import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── GET: List all custom streams currently present on disk ──────────────────
export async function GET() {
  try {
    const streamsDir = path.join(process.cwd(), 'public', 'custom-streams');
    if (!fs.existsSync(streamsDir)) {
      return NextResponse.json({ success: true, streams: [] });
    }

    const subdirs = fs.readdirSync(streamsDir);
    const streams: Array<{ id: string; name: string; url: string; codec: string; desc: string; addedAt: number }> = [];

    for (const subdir of subdirs) {
      const subdirPath = path.join(streamsDir, subdir);
      // Ensure it is a directory
      if (fs.statSync(subdirPath).isDirectory()) {
        const metaPath = path.join(subdirPath, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const metaContent = fs.readFileSync(metaPath, 'utf8');
            const metaData = JSON.parse(metaContent);
            
            // Build absolute stream details
            streams.push({
              id: metaData.id,
              name: metaData.name,
              url: metaData.url,
              codec: metaData.codec,
              desc: 'Локальный HLS-медиаресурс',
              addedAt: metaData.addedAt || 0
            });
          } catch (e) {
            console.error(`[API Transcoder] Failed to parse meta.json in ${subdir}:`, e);
          }
        }
      }
    }

    // Sort streams by addedAt descending (newest first)
    streams.sort((a, b) => b.addedAt - a.addedAt);

    return NextResponse.json({ success: true, streams });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown GET error';
    console.error('[API Transcoder] GET error:', err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// ─── POST: Upload video, transcode to unique HLS folder, write meta.json ─────
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('video') as File;
    const codec = (formData.get('codec') as string) || 'h264';

    const ALLOWED_CODECS = ['h264', 'h265', 'mjpeg'];
    if (!ALLOWED_CODECS.includes(codec)) {
      return NextResponse.json(
        { error: `Неподдерживаемый кодек: ${codec}. Допустимые значения: ${ALLOWED_CODECS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json({ error: 'Файл видео не найден в запросе.' }, { status: 400 });
    }

    console.log(`[API Transcoder] Получен файл "${file.name}" для нарезки в HLS (${codec.toUpperCase()})`);

    // 1. Resolve local FFmpeg path on macOS (Intel/M1/M2 search)
    let ffmpegPath = 'ffmpeg';
    const pathsToSearch = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
    for (const p of pathsToSearch) {
      try {
        if (p === 'ffmpeg' || fs.existsSync(p)) {
          ffmpegPath = p;
          break;
        }
      } catch (e) {}
    }

    // 2. Prepare temp input path
    const tempDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Validate file name and prevent path traversal
    const extension = path.extname(file.name).toLowerCase();
    const allowedExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.ts', '.m4v', '.3gp'];
    const safeExtension = allowedExtensions.includes(extension) ? extension : '.mp4';
    const tempInputPath = path.join(tempDir, `input_${Date.now()}_${crypto.randomUUID()}${safeExtension}`);

    // Enforce maximum upload size (500MB) to prevent OOM
    const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Файл слишком большой. Максимальный размер: 500MB. Размер файла: ${(file.size / 1024 / 1024).toFixed(1)}MB` },
        { status: 413 }
      );
    }

    // Save uploaded file bytes to temp disk storage
    const bytes = await file.arrayBuffer();
    fs.writeFileSync(tempInputPath, Buffer.from(bytes));

    // 3. Generate unique directory name for this custom stream
    const timestamp = Date.now();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const uniqueId = `${timestamp}_${cleanFileName.slice(0, 30)}`;

    const outputDir = path.join(process.cwd(), 'public', 'custom-streams', uniqueId);
    fs.mkdirSync(outputDir, { recursive: true });

    // 4. Run FFmpeg synchronously to slice segments (fast VOD preset)
    const playlistName = 'stream.m3u8';
    const segmentNamePattern = 'seq_%03d.ts';

    // Per-codec video encoding options (MJPEG is all-intra, no x264/x265 presets).
    const videoArgs =
      codec === 'mjpeg'
        ? ['-codec:v', 'mjpeg', '-q:v', '5', '-pix_fmt', 'yuvj420p', '-g', '1']
        : ['-codec:v', codec === 'h265' ? 'libx265' : 'libx264', '-preset', 'ultrafast', '-crf', '24', '-g', '60', '-sc_threshold', '0'];

    const ffmpegArgs = [
      '-i', tempInputPath,
      // Video encoding options
      ...videoArgs,
      // Audio encoding options
      '-codec:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-ar', '44100',
      // HLS slicing parameters
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(outputDir, segmentNamePattern),
      path.join(outputDir, playlistName)
    ];

    console.log(`[API Transcoder] Запуск FFmpeg: ${ffmpegPath} ${ffmpegArgs.join(' ')}`);

    const runFFmpeg = (): Promise<{ status: number | null; stderr: string }> => {
      return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
        let stderr = '';

        // Timeout guard: 90 seconds
        const timeoutId = setTimeout(() => {
          console.error('[API Transcoder] FFmpeg transcode timeout (90s) reached. Killing process.');
          ffmpegProcess.kill('SIGKILL');
          reject(new Error('FFmpeg transcoding timed out after 90 seconds.'));
        }, 90000);

        ffmpegProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpegProcess.on('close', (code) => {
          clearTimeout(timeoutId);
          resolve({ status: code, stderr });
        });

        ffmpegProcess.on('error', (err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
      });
    };

    let resultStatus = -1;
    let resultStderr = '';

    try {
      const result = await runFFmpeg();
      resultStatus = result.status ?? -1;
      resultStderr = result.stderr;
    } catch (ffmpegErr: unknown) {
      const errMsg = ffmpegErr instanceof Error ? ffmpegErr.message : 'Unknown ffmpeg execution error';
      console.error('[API Transcoder] FFmpeg execution error:', ffmpegErr);
      return NextResponse.json({
        error: 'FFmpeg transcoding failed.',
        details: errMsg,
      }, { status: 500 });
    } finally {
      // Clean up temporary uploaded file immediately to save disk space
      try {
        if (fs.existsSync(tempInputPath)) {
          fs.unlinkSync(tempInputPath);
        }
      } catch (e) {}
    }

    if (resultStatus === 0) {
      console.log('[API Transcoder] Видео успешно нарезано.');

      // 5. Write meta.json metadata to the stream folder
      const playlistUrl = `/custom-streams/${uniqueId}/${playlistName}`;
      const metaPath = path.join(outputDir, 'meta.json');
      const metaData = {
        id: uniqueId,
        name: file.name.replace(/[<>"'&]/g, '_'),
        codec: codec,
        url: playlistUrl,
        addedAt: timestamp
      };
      fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2));

      return NextResponse.json({
        success: true,
        url: playlistUrl,
        stream: {
          id: uniqueId,
          name: file.name.replace(/[<>"'&]/g, '_'),
          url: playlistUrl,
          codec: codec,
          desc: 'Локальный HLS-медиаресурс',
          addedAt: timestamp
        }
      });
    } else {
      console.error('[API Transcoder] Сбой FFmpeg:', resultStderr);
      return NextResponse.json({
        error: 'FFmpeg failed to slice segments.',
        details: resultStderr,
      }, { status: 500 });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown system error';
    console.error('[API Transcoder] Системная ошибка:', err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      console.log(`[API Transcoder] Запрос на удаление конкретного потока с диска: ${id}`);
      
      // Prevent path traversal
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return NextResponse.json({ error: 'Некорректный ID потока' }, { status: 400 });
      }

      const streamDir = path.join(process.cwd(), 'public', 'custom-streams', id);
      if (fs.existsSync(streamDir)) {
        fs.rmSync(streamDir, { recursive: true, force: true });
        console.log(`[API Transcoder] Успешно удалена директория потока: ${streamDir}`);
        return NextResponse.json({
          success: true,
          message: `Поток ${id} успешно удален с диска.`
        });
      } else {
        return NextResponse.json({ error: 'Поток не найден на диске' }, { status: 404 });
      }
    }

    console.log('[API Transcoder] Запрос на полную очистку диска от загруженных видео...');
    
    // 1. Wipe custom-streams folder
    const streamsDir = path.join(process.cwd(), 'public', 'custom-streams');
    if (fs.existsSync(streamsDir)) {
      fs.rmSync(streamsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(streamsDir, { recursive: true });

    // 2. Wipe old single custom-stream folder if it exists
    const oldStreamDir = path.join(process.cwd(), 'public', 'custom-stream');
    if (fs.existsSync(oldStreamDir)) {
      fs.rmSync(oldStreamDir, { recursive: true, force: true });
    }

    // 3. Wipe rtsp-stream folder if it exists
    const rtspDir = path.join(process.cwd(), 'public', 'rtsp-stream');
    if (fs.existsSync(rtspDir)) {
      fs.rmSync(rtspDir, { recursive: true, force: true });
    }

    // 3.5 Wipe the new rtsp-streams directory if it exists
    const rtspStreamsDir = path.join(process.cwd(), 'public', 'rtsp-streams');
    if (fs.existsSync(rtspStreamsDir)) {
      fs.rmSync(rtspStreamsDir, { recursive: true, force: true });
    }

    // 4. Wipe temporary transcoder uploads folder
    const tempDir = path.join(process.cwd(), 'tmp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch (e) {}
      }
    }

    // 5. Force termination of any active server-side RTSP transcoder processes
    const g = global as unknown as { rtspRegistry?: Map<string, { process: import('child_process').ChildProcess; rtspUrl: string }> };
    const registry = g.rtspRegistry;
    if (registry instanceof Map) {
      registry.forEach((item, key) => {
        try {
          console.log(`[API Transcoder DELETE] Принудительное завершение FFmpeg процесса для RTSP URL: ${item.rtspUrl}`);
          item.process.kill('SIGKILL');
        } catch (e) {}
        registry.delete(key);
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Все загруженные медиафайлы и временные потоки успешно удалены с диска.'
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown DELETE error';
    console.error('[API Transcoder] DELETE error:', err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
