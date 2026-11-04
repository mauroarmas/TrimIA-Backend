import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class AudioCodecService {
  private run(
    command: string,
    args: string[],
    input?: Buffer,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error('La conversión de audio excedió el tiempo permitido.'),
        );
      }, 120000);
      child.stdout.on('data', (chunk) => {
        if (output.length < 16384) output += chunk.toString();
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('El conversor de audio no está disponible.'));
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0)
          reject(
            new Error(
              'No se pudo convertir la respuesta de voz a un MP3 válido.',
            ),
          );
        else resolve(output);
      });
      child.stdin.end(input);
    });
  }

  async encode(audio: Buffer, mimeType: string) {
    if (!audio.length || audio.length > 60000000)
      throw new Error(
        'El servicio de voz devolvió un archivo vacío o demasiado grande.',
      );
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'trimia-audio-'));
    try {
      const output = path.join(temp, 'lesson.mp3');
      let inputArgs: string[];
      if (/audio\/(?:l16|pcm)/i.test(mimeType)) {
        const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
        const channels = Number(mimeType.match(/channels=(\d+)/i)?.[1] || 1);
        if (
          ![8000, 16000, 22050, 24000, 44100, 48000].includes(rate) ||
          ![1, 2].includes(channels) ||
          audio.length % 2
        )
          throw new Error('El formato PCM recibido no es válido.');
        inputArgs = [
          '-f',
          's16le',
          '-ar',
          String(rate),
          '-ac',
          String(channels),
          '-i',
          'pipe:0',
        ];
      } else if (/audio\/(?:wav|x-wav|mpeg|mp3)/i.test(mimeType)) {
        inputArgs = ['-i', 'pipe:0'];
      } else
        throw new Error('El servicio de voz devolvió un formato no admitido.');
      await this.run(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          ...inputArgs,
          '-vn',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '64k',
          '-y',
          output,
        ],
        audio,
      );
      const duration = Number(
        (
          await this.run('ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            output,
          ])
        ).trim(),
      );
      if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
        throw new Error(
          'El audio debe durar entre 1 segundo y 5 minutos. Acortá el guion e intentá nuevamente.',
        );
      const audioBuffer = await fs.readFile(output);
      return {
        audioBuffer,
        durationSeconds: duration,
        mimeType: 'audio/mpeg',
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}
