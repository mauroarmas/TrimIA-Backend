import { CollectionsController } from './collections.controller';
describe('lectura de cartera de supervisión general', () => {
  it.each([
    [{ id: 'diego', isGeneralSupervisor: true, isController: false }, true],
    [{ id: 'controller', isController: true }, true],
    [{ id: 'collector', isController: false }, false],
  ])('mantiene alcance de lectura para %p', (user, expected) => {
    const collections = {
      getKpis: jest.fn(),
      listClients: jest.fn(),
      getClientHistory: jest.fn(),
    };
    const controller = new CollectionsController(
      null,
      collections as any,
      null,
      null,
      null,
      null,
    );
    controller.getKpis({ user });
    controller.listClients({ user });
    controller.getClientHistory('client', { user });
    expect(collections.getKpis).toHaveBeenCalledWith(user.id, expected);
    expect(collections.listClients).toHaveBeenCalledWith(user.id, expected);
    expect(collections.getClientHistory).toHaveBeenCalledWith(
      'client',
      user.id,
      expected,
    );
  });
});
