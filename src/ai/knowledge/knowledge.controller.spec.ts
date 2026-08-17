/**
 * Tests de autorización de KnowledgeController — Sprint 5A.
 *
 * ⭐ Test constitucional (Principio I). `/knowledge/search` permite pedir
 * audiencia INTERNO, o sea volcar conocimiento confidencial: quién puede
 * llamarlo es una decisión de seguridad, no de comodidad.
 *
 * Se verifica la metadata de los decoradores y no un request real porque es
 * exactamente eso lo que protege al endpoint: si alguien saca un `@UseGuards`
 * al refactorizar, la ruta queda abierta sin que ningún test de lógica falle.
 *
 * El comportamiento en vivo (401 sin token, 403 con EMPLEADO, 201 con
 * SUPERVISOR) está cubierto por el Escenario 3 de quickstart.md.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../auth/guards/roles.guard';
import { KnowledgeController } from './knowledge.controller';

describe('KnowledgeController — autorización', () => {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, KnowledgeController) ??
    []) as unknown[];

  it('exige sesión válida (JwtAuthGuard)', () => {
    expect(guards).toContain(JwtAuthGuard);
  });

  it('exige rol, no solo autenticación (RolesGuard)', () => {
    expect(guards).toContain(RolesGuard);
  });

  it('el rol exigido es SUPERVISOR, no cualquier empleado', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, KnowledgeController);

    expect(roles).toEqual(['SUPERVISOR']);
  });

  it('ya NO se protege con el secreto compartido', () => {
    // Antes del Sprint 5A iba con WebhookSecretGuard + KNOWLEDGE_ADMIN_SECRET.
    // Un secreto en un header no dice QUIÉN hizo el cambio, y la bitácora de
    // ediciones (FR-048/FR-049) necesita saberlo.
    const names = guards.map((g) => (g as { name?: string })?.name);

    expect(names).not.toContain('WebhookSecretGuard');
  });

  it('no gatea por sector: un supervisor gestiona todas las áreas (FR-045)', () => {
    // El área es filtro de navegación, no permiso. Si alguien agregara un
    // guard de sector, estaría introduciendo una tercera dimensión de
    // autorización que la constitución no contempla.
    const names = guards.map((g) => (g as { name?: string })?.name ?? '');

    expect(names.some((n) => /sector/i.test(n))).toBe(false);
    expect(guards).toHaveLength(2);
  });
});
