import { INestApplication, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { Readable } from 'stream';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthService } from '../auth/auth.service';

describe('Audio protegido por sesión HTTP', () => {
  let app: INestApplication;
  let token: string;
  let revoked = false;
  let denied = false;
  const service = {
    getPillAudioScript: jest.fn(async () => {
      if (denied) throw new ForbiddenException();
      return { title: 'Guion autorizado' };
    }),
    getAudioStatus: jest.fn(async () => {
      if (denied) throw new ForbiddenException();
      return { status: 'AUDIO_READY' };
    }),
    getAudioStream: jest.fn(async () => {
      if (denied) throw new ForbiddenException();
      return {
        contentType: 'audio/mpeg',
        contentLength: 3,
        stream: Readable.from(Buffer.from('MP3')),
      };
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: 'isolated-audio-test',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [TrainingController],
      providers: [
        JwtStrategy,
        { provide: TrainingService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: () => 'isolated-audio-test' },
        },
        {
          provide: AuthService,
          useValue: {
            isSessionRevoked: async () => revoked,
            currentIdentity: async () => ({ id: 'employee-verified' }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    token = module.get(JwtService).sign({ sub: 'employee-verified' });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    revoked = false;
    denied = false;
    jest.clearAllMocks();
  });
  for (const endpoint of ['script', 'audio/status', 'audio']) {
    it(`${endpoint}: rechaza token ausente o revocado, también por query`, async () => {
      await request(app.getHttpServer())
        .get('/training/pills/pill-1/' + endpoint)
        .expect(401);
      revoked = true;
      await request(app.getHttpServer())
        .get('/training/pills/pill-1/' + endpoint)
        .query({ token })
        .expect(401);
      expect(service.getAudioStream).not.toHaveBeenCalled();
      expect(service.getPillAudioScript).not.toHaveBeenCalled();
      expect(service.getAudioStatus).not.toHaveBeenCalled();
    });
    it(`${endpoint}: pasa la identidad validada y respeta la denegación del servicio`, async () => {
      await request(app.getHttpServer())
        .get('/training/pills/pill-1/' + endpoint)
        .query({ token })
        .expect(200);
      const method =
        endpoint === 'script'
          ? service.getPillAudioScript
          : endpoint === 'audio/status'
            ? service.getAudioStatus
            : service.getAudioStream;
      expect((method.mock.calls as any)[0][0]).toBe('employee-verified');
      denied = true;
      await request(app.getHttpServer())
        .get('/training/pills/pill-1/' + endpoint)
        .auth(token, { type: 'bearer' })
        .expect(403);
    });
  }
});
