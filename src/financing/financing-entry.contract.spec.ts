import { Test } from '@nestjs/testing';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import * as request from 'supertest';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';
import { ClientOnboardingService } from '../sales/client-onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
const id = '00000000-0000-4000-8000-000000000001';
describe('Financing HTTP contract and permissions', () => {
  let app: any;
  const stub = {
    listFinancingRequests: jest.fn().mockResolvedValue([]),
    getFinancingRequest: jest.fn().mockResolvedValue({ request: { id } }),
    getFinancingDraft: jest
      .fn()
      .mockResolvedValue({ conversationId: id, version: 1 }),
    completeFinancingDraft: jest.fn().mockResolvedValue({ version: 2 }),
    reviewFinancingRequest: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    correctFinancingRequest: jest.fn().mockResolvedValue({}),
    cancelFinancingRequest: jest.fn().mockResolvedValue({}),
    retryFinancingNotice: jest.fn().mockResolvedValue({ status: 'PENDING' }),
  };
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: SalesService, useValue: stub },
        { provide: ClientOnboardingService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: any) {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers.authorization;
          if (!who) throw new UnauthorizedException();
          req.user = {
            id,
            role: who === 'staff' ? 'EMPLEADO' : 'SUPERVISOR',
            sectorName: who === 'sales' ? 'Ventas' : 'Administración',
            isGeneralSupervisor: false,
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = m.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  it('sin sesión rechaza listado', () =>
    request(app.getHttpServer()).get('/sales/financing/requests').expect(401));
  it('Ventas no lee detalle reservado', () =>
    request(app.getHttpServer())
      .get(`/sales/financing/requests/${id}`)
      .set('Authorization', 'sales')
      .expect(403));
  it('Administración lee listado', () =>
    request(app.getHttpServer())
      .get('/sales/financing/requests')
      .set('Authorization', 'staff')
      .expect(200, []));
  it('empleado administrativo no decide', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/requests/${id}/review`)
      .set('Authorization', 'staff')
      .send({ expectedVersion: 1, decision: 'APPROVED' })
      .expect(403));
  it('revisión sin versión falla', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/requests/${id}/review`)
      .set('Authorization', 'supervisor')
      .send({ decision: 'APPROVED' })
      .expect(400));
  it('no acepta actor/destino/score del cliente HTTP', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/requests/${id}/review`)
      .set('Authorization', 'supervisor')
      .send({
        expectedVersion: 1,
        decision: 'APPROVED',
        actorId: id,
        phone: '5491111111',
        score: 900,
      })
      .expect(400));
  it('revisión correcta responde 200, no 201', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/requests/${id}/review`)
      .set('Authorization', 'supervisor')
      .send({ expectedVersion: 1, decision: 'APPROVED' })
      .expect(200));
  it.each(['0.00', '-1.00', 'Infinity', '1.000'])(
    'borrador rechaza monto %s',
    (confirmedAmount) =>
      request(app.getHttpServer())
        .post(`/sales/financing/conversations/${id}/draft`)
        .set('Authorization', 'supervisor')
        .send({ expectedVersion: 0, confirmedAmount, note: 'Prueba' })
        .expect(400),
  );
  it('borrador válido responde 200', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/conversations/${id}/draft`)
      .set('Authorization', 'supervisor')
      .send({ expectedVersion: 0, confirmedAmount: '100.00', note: 'Prueba' })
      .expect(200));
  it('UUID inválido rechaza detalle', () =>
    request(app.getHttpServer())
      .get('/sales/financing/requests/no-id')
      .set('Authorization', 'supervisor')
      .expect(400));
  it('cancelación acepta solo versión y nota', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/requests/${id}/cancel`)
      .set('Authorization', 'supervisor')
      .send({ expectedVersion: 1, note: 'Pedido cancelado' })
      .expect(200));
  it('retry no permite cambiar texto', () =>
    request(app.getHttpServer())
      .post(`/sales/financing/notices/${id}/retry`)
      .set('Authorization', 'supervisor')
      .send({ expectedVersion: 1, body: 'Nuevo mensaje' })
      .expect(400));
});
