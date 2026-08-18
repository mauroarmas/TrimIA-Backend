/**
 * Tests de MessagingSimulateController — spec 004, US3.
 *
 * ⭐ Test constitucional (Principio I). El simulador puede escribir como
 * **cualquier teléfono**, así que es la superficie con más poder del panel: hay que
 * probar que el rol la cierra y que el remitente NO se puede declarar desde el
 * body — quién es lo sigue decidiendo la whitelist.
 */
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Channel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../auth/guards/roles.guard';
import { WebhookSecretGuard } from '../common/guards/webhook-secret.guard';
import { MessagingSimulateController } from './messaging-simulate.controller';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { SimulateMessageDto } from './dto/simulate-message.dto';

const CONV_ID = '88888888-8888-4888-8888-888888888888';

function buildController() {
  const messaging = {
    enqueue: jest.fn().mockResolvedValue({ conversationId: CONV_ID }),
  };
  const controller = new MessagingSimulateController(
    messaging as unknown as MessagingService,
  );
  return { controller, messaging };
}

/** El ValidationPipe global, con las mismas opciones que main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validar = (payload: unknown) =>
  pipe.transform(payload, { type: 'body', metatype: SimulateMessageDto });

/** ExecutionContext mínimo para ejercitar RolesGuard sobre este controller. */
function contextConRol(role: string | undefined): ExecutionContext {
  return {
    getHandler: () => MessagingSimulateController.prototype.simulate,
    getClass: () => MessagingSimulateController,
    switchToHttp: () => ({
      getRequest: () => (role ? { user: { role } } : {}),
    }),
  } as unknown as ExecutionContext;
}

describe('⭐ MessagingSimulateController — cerrado por rol (401/403)', () => {
  it('exige JwtAuthGuard y RolesGuard', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      MessagingSimulateController,
    ) ?? []) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('declara @Roles(SUPERVISOR)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MessagingSimulateController);

    expect(roles).toEqual(['SUPERVISOR']);
  });

  it('rechaza a un empleado autenticado SIN rol supervisor', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextConRol('EMPLEADO'))).toThrow(
      /permisos/i,
    );
  });

  it('deja pasar a un SUPERVISOR', () => {
    const guard = new RolesGuard(new Reflector());

    expect(guard.canActivate(contextConRol('SUPERVISOR'))).toBe(true);
  });

  // Sin sesión no hay `req.user`, así que ni siquiera hay rol que comparar.
  it('sin sesión, no pasa', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextConRol(undefined))).toThrow();
  });
});

describe('MessagingSimulateController.simulate', () => {
  it('encola por el MISMO camino que el webhook y devuelve el conversationId', async () => {
    const { controller, messaging } = buildController();

    const res = await controller.simulate({
      phone: '5493764000000',
      message: 'hola',
    });

    // Reusar enqueue() es lo que hace que el simulador pruebe el sistema real: un
    // camino propio dejaría de probar lo que dice probar.
    expect(messaging.enqueue).toHaveBeenCalledWith({
      phone: '5493764000000',
      message: 'hola',
      channel: Channel.WEB,
    });
    expect(res).toEqual({ queued: true, conversationId: CONV_ID });
  });

  // Si se pudiera pedir WHATSAPP, un teléfono cualquiera escrito en el simulador
  // recibiría un WhatsApp REAL: el corte del sender existe solo para canales
  // distintos de WhatsApp.
  it('fuerza channel WEB, aunque el body pida otra cosa', async () => {
    const { controller, messaging } = buildController();

    await controller.simulate({
      phone: '5493764000000',
      message: 'hola',
      // El campo no existe en el DTO; se fuerza acá para probar que ni así pasa.
      channel: Channel.WHATSAPP,
    } as unknown as SimulateMessageDto);

    expect(messaging.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ channel: Channel.WEB }),
    );
  });
});

describe('⭐ SimulateMessageDto — el remitente no se declara (RF-018, RN-3)', () => {
  it('normaliza el teléfono en el borde', async () => {
    const dto = (await validar({
      phone: '+54 9 3764 00-0000',
      message: 'hola',
    })) as SimulateMessageDto;

    expect(dto.phone).toBe('5493764000000');
  });

  // forbidNonWhitelisted: mandar el campo no se ignora en silencio, se rechaza.
  // Es lo que impide que el simulador se convierta en una vía para declarar quién
  // es el remitente en vez de que lo decida la whitelist.
  it.each(['channel', 'userType', 'role'])(
    'rechaza el campo `%s` en el body',
    async (campo) => {
      await expect(
        validar({ phone: '5493764000000', message: 'hola', [campo]: 'X' }),
      ).rejects.toThrow();
    },
  );

  it('exige teléfono y mensaje', async () => {
    await expect(validar({ message: 'hola' })).rejects.toThrow();
    await expect(validar({ phone: '5493764000000' })).rejects.toThrow();
  });

  it('rechaza un mensaje más largo que el tope de WhatsApp', async () => {
    await expect(
      validar({ phone: '5493764000000', message: 'x'.repeat(4097) }),
    ).rejects.toThrow();
  });
});

/**
 * ⭐ T028 / RF-020 / RN-7 / CA-12 — que el simulador deje de usar el secreto no
 * ablanda la puerta por la que entra WhatsApp. Son dos superficies distintas y
 * tienen que seguir siéndolo.
 *
 * La resolución del `userType` (teléfono fuera de la whitelist ⇒ CLIENTE, con solo
 * SALES/COLLECTIONS y solo audiencia PUBLICO) NO se prueba acá: vive en
 * MessageProcessor y ya está cubierta en su propio spec —"degrada a CLIENTE si el
 * empleado ya no existe en la whitelist"—. Duplicarla acá daría la falsa impresión
 * de que este endpoint participa de esa decisión, y el punto es justamente que no.
 */
describe('⭐ La puerta de n8n no se ablanda (RF-020)', () => {
  it('el webhook sigue protegido por el secreto compartido', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      MessagingController.prototype.webhook,
    ) ?? []) as unknown[];

    expect(guards).toContain(WebhookSecretGuard);
  });

  it('el webhook NO acepta una sesión del panel como sustituto', () => {
    const guards = [
      ...((Reflect.getMetadata(GUARDS_METADATA, MessagingController) ??
        []) as unknown[]),
      ...((Reflect.getMetadata(
        GUARDS_METADATA,
        MessagingController.prototype.webhook,
      ) ?? []) as unknown[]),
    ];

    expect(guards).not.toContain(JwtAuthGuard);
    expect(guards).not.toContain(RolesGuard);
  });
});
