import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioStorageService } from './audio-storage.service';

describe('Audio local: rangos y reemplazo seguro', () => {
  let root: string;
  let storage: AudioStorageService;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trimia-range-test-'));
    storage = Object.assign(Object.create(AudioStorageService.prototype), {
      baseStorageDir: root,
      logger: { log() {}, warn() {}, error() {} },
    });
    await fs.writeFile(path.join(root, 'pill.mp3'), '0123456789');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('mantiene bytes y longitud del archivo abierto si se archiva antes de empezar a leer', async () => {
    const result = await storage.createAudioStream('pill', 'bytes=2-4');
    await storage.deleteAudio('pill');
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('234');
    expect(result.contentLength).toBe(3);
  });

  it.each([
    ['bytes=2-4', '234', 'bytes 2-4/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
  ])('sirve el rango %s', async (range, expected, header) => {
    const result = await storage.createAudioStream('pill', range);
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe(expected);
    expect(result.contentRange).toBe(header);
    expect(result.contentLength).toBe(expected.length);
  });

  it.each(['bytes=50-', 'bytes=-0', 'bytes=4-1', 'bytes=1-2,3-4'])(
    'rechaza el rango no satisfacible %s con 416',
    async (range) => {
      await expect(
        storage.createAudioStream('pill', range),
      ).rejects.toMatchObject({
        status: 416,
        response: expect.objectContaining({ contentRange: 'bytes */10' }),
      });
    },
  );

  it('conserva el archivo anterior si falla el reemplazo', async () => {
    jest
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('Disco no disponible'));
    await expect(
      storage.saveAudio('pill', Buffer.from('nuevo')),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'pill.mp3'), 'utf8')).toBe(
      '0123456789',
    );
    expect(await fs.readdir(root)).toEqual(['pill.mp3']);
  });
});
