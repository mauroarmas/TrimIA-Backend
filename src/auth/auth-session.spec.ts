import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('Sesiones HTTP — regresión RNF02-04 y RF12-04', () => {
  let app: INestApplication;
  let employee: any;
  const revoked = new Map<string, string>();
  const redis = {
    exists: jest.fn(async (key: string) => (revoked.has(key) ? 1 : 0)),
    set: jest.fn(async (key: string, value: string) => {
      revoked.set(key, value);
      return 'OK';
    }),
  };
  const prisma = {
    employee: { findUnique: jest.fn(async () => employee) },
    sector: { count: jest.fn(async () => 5) },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: 'test-secret-session-regression',
          signOptions: { expiresIn: '8h' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: () => 'test-secret-session-regression' },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  beforeEach(async () => {
    revoked.clear();
    employee = {
      id: 'employee-1',
      email: 'test.supervisor2@credimision.com',
      name: 'Prueba',
      password: await bcrypt.hash('test-password', 4),
      isActive: true,
      role: 'SUPERVISOR',
      sectorId: 'sector-1',
      sector: { name: 'Ventas' },
      isController: false,
      areasSupervisadas: [],
    };
  });
  afterAll(async () => {
    await app.close();
  });

  async function login() {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: employee.email, password: 'test-password' })
      .expect(200);
    return response.body.accessToken as string;
  }

  it('rechaza el login del usuario de baja aun con contraseña correcta', async () => {
    employee.isActive = false;
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: employee.email, password: 'test-password' })
      .expect(401);
  });

  it('el mismo token deja de funcionar tras cerrar sesión; una sesión distinta sigue vigente', async () => {
    const first = await login();
    const second = await login();
    expect(first).not.toEqual(second);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(first, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .auth(first, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(first, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .query({ token: first })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(second, { type: 'bearer' })
      .expect(200);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:revoked:/),
      '1',
      'EX',
      expect.any(Number),
    );
  });

  it('una baja invalida una sesión ya abierta en el próximo pedido', async () => {
    const token = await login();
    employee.isActive = false;
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });

  it('los permisos nuevos prevalecen sobre el rol firmado al iniciar sesión', async () => {
    const token = await login();
    employee.role = 'EMPLEADO';
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body.role).toBe('EMPLEADO');
    expect(response.body).not.toHaveProperty('password');
  });
});
