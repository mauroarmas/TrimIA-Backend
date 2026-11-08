import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrainingService } from './training.service';
import { AudioStorageService } from './services/audio-storage.service';

describe('Archivo de píldora y almacenamiento local', () => {
  it('retira el archivo y sus referencias preservando el historial', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'trimia-archive-'),
    );
    const storage = new AudioStorageService();
    (storage as any).baseStorageDir = directory;
    const pill: any = {
      id: 'pill-test',
      title: 'Prueba',
      objective: 'Objetivo',
      content: 'Contenido',
      quiz: [],
      status: 'PUBLISHED',
      version: 1,
      audioStatus: 'AUDIO_READY',
      audioUrl: '/audio',
      audioGenerationId: 'old-job',
      audioDurationSeconds: 30,
      module: { sector: { agentType: 'SALES' } },
    };
    const db: any = {
      pill: {
        findUnique: async () => pill,
        update: async ({ data }) => ({ ...pill, ...data, version: 2 }),
      },
      pillAudit: { create: jest.fn() },
      employeeProgress: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    db.$transaction = async (fn) => fn(db);
    const service = new TrainingService(
      db,
      { assertPuedeEscribir: async () => {} } as any,
      {} as any,
      storage,
      {} as any,
    );
    try {
      await storage.saveAudio(
        pill.id,
        Buffer.from('archivo vigente de prueba'),
      );
      expect((await storage.getAudioMetadata(pill.id)).exists).toBe(true);
      const archived = await service.archivePill('supervisor', pill.id);
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.audioUrl).toBeNull();
      expect(archived.audioGenerationId).toBeNull();
      expect((await storage.getAudioMetadata(pill.id)).exists).toBe(false);
      expect(db.employeeProgress.deleteMany).not.toHaveBeenCalled();
      expect(db.employeeProgress.updateMany).not.toHaveBeenCalled();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
