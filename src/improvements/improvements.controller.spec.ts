import { ImprovementsController } from './improvements.controller';

/**
 * El controller solo orquesta (Principio V): lo que se prueba es que el
 * empleado sale del **token** y no del body, y que cada endpoint delega en su
 * servicio. La autorización de fondo vive en los servicios y se prueba allá.
 */
function buildController() {
  const improvements = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    refresh: jest.fn().mockResolvedValue({ sectorId: 's1' }),
  };
  const dismissals = {
    dismiss: jest.fn().mockResolvedValue({ dismissed: true }),
  };
  return {
    controller: new ImprovementsController(
      improvements as any,
      dismissals as any,
    ),
    improvements,
    dismissals,
  };
}

const req = { user: { id: 'emp-1', role: 'SUPERVISOR' } };

describe('ImprovementsController — delegación', () => {
  it('GET /improvements usa el empleado del token, no uno del query', async () => {
    const { controller, improvements } = buildController();
    await controller.list({ sectorId: 's1' } as any, req as any);
    expect(improvements.list).toHaveBeenCalledWith('s1', 'emp-1');
  });

  it('POST /improvements/refresh delega con el sector y el empleado del token', async () => {
    const { controller, improvements } = buildController();
    await controller.refresh({ sectorId: 's1' } as any, req as any);
    expect(improvements.refresh).toHaveBeenCalledWith('s1', 'emp-1');
  });

  it('POST /improvements/dismiss pasa el itemId con su prefijo tal cual', async () => {
    const { controller, dismissals } = buildController();
    await controller.dismiss(
      { itemId: 'doc:D1', note: 'está bien así' } as any,
      req as any,
    );
    expect(dismissals.dismiss).toHaveBeenCalledWith(
      'doc:D1',
      'emp-1',
      'está bien así',
    );
  });
});

describe('ImprovementsController — los dos gates (Principio I)', () => {
  // El rol abre la pantalla, el área decide el contenido. Que el rol esté en
  // el controller y no en el servicio es deliberado: son dimensiones
  // distintas y viven en lugares distintos.
  it('el controller exige SUPERVISOR', () => {
    expect(Reflect.getMetadata('roles', ImprovementsController)).toEqual([
      'SUPERVISOR',
    ]);
  });
});
