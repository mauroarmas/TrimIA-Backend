import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';
import { ClientOnboardingService } from '../sales/client-onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CommercialFlowService } from './commercial-flow.service';
const id = '11111111-1111-4111-8111-111111111111';
describe('permisos de revisión y cierre comercial', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const stub = {
      list: jest.fn().mockResolvedValue([]),
      commercial: jest.fn().mockResolvedValue({ id }),
      catalog: jest.fn().mockResolvedValue([]),
      review: jest.fn().mockResolvedValue({ id }),
      renew: jest.fn().mockResolvedValue({ id }),
      edit: jest.fn().mockResolvedValue({ id }),
      close: jest.fn().mockResolvedValue({ id }),
    };
    const module = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: ClientOnboardingService, useValue: {} },
        { provide: SalesService, useValue: {} },
        { provide: CommercialFlowService, useValue: stub },
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
            role: 'EMPLEADO',
            sectorName: (
              {
                admin: 'Administración',
                sales: 'Ventas',
                logistics: 'Logística',
              } as any
            )[who],
            isGeneralSupervisor: who === 'general',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
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
  const review = {
    expectedVersion: 1,
    decision: 'APPROVED',
    offerIds: ['cash'],
    note: 'Verificado',
  };
  it('personal administrativo puede revisar', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/review`)
      .set('Authorization', 'admin')
      .send(review)
      .expect(200));
  it('supervisión general puede revisar', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/review`)
      .set('Authorization', 'general')
      .send(review)
      .expect(200));
  it('Ventas no puede habilitar ofertas', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/review`)
      .set('Authorization', 'sales')
      .send(review)
      .expect(403));
  it('Ventas puede confirmar cierre', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/close`)
      .set('Authorization', 'sales')
      .send({ expectedVersion: 1, reference: 'Venta QA' })
      .expect(200));
  it('Administración no puede confirmar cierre', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/close`)
      .set('Authorization', 'admin')
      .send({ expectedVersion: 1, reference: 'Venta QA' })
      .expect(403));
  it('Logística no accede a la ficha comercial', () =>
    request(app.getHttpServer())
      .get(`/sales/commercial/orders/${id}`)
      .set('Authorization', 'logistics')
      .expect(403));
  it('no acepta importe, cantidad o actor arbitrarios en el cierre', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/close`)
      .set('Authorization', 'sales')
      .send({
        expectedVersion: 1,
        reference: 'QA',
        amount: 1,
        quotaCount: 1,
        actorId: id,
      })
      .expect(400));
  it('no admite planes ajenos al catálogo', () =>
    request(app.getHttpServer())
      .post(`/sales/commercial/orders/${id}/review`)
      .set('Authorization', 'admin')
      .send({ ...review, offerIds: ['weekly-999'] })
      .expect(400));
});
