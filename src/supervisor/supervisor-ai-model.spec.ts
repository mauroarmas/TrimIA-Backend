import { SupervisorController } from './supervisor.controller';
describe('permisos del selector global de IA', () => {
  const llm = { getSettings: jest.fn(), selectModel: jest.fn() };
  const controller = new SupervisorController(
    null!,
    null!,
    null!,
    null!,
    null!,
    null!,
    llm as any,
  );
  beforeEach(() => jest.clearAllMocks());
  it('rechaza supervisión de área', () => {
    const req: any = {
      user: {
        id: 'area',
        email: 'area@example.invalid',
        isGeneralSupervisor: false,
      },
    };
    expect(() => controller.getModel(req)).toThrow('Solo supervisión general');
    expect(() =>
      controller.setModel(req, {
        model: 'gemini-3.8-flash',
        expectedModel: 'gemini-3.5-flash-lite',
      }),
    ).toThrow('Solo supervisión general');
    expect(llm.selectModel).not.toHaveBeenCalled();
  });
  it.each([
    { email: 'diego.bazan@credimision.com' },
    { isGeneralSupervisor: true },
  ])('permite administración global: %p', (user) => {
    const body = {
      model: 'gemini-3.8-flash',
      expectedModel: 'gemini-3.5-flash-lite',
    };
    controller.setModel({ user: { id: 'actor', ...user } } as any, body);
    expect(llm.selectModel).toHaveBeenCalledWith(
      body.model,
      body.expectedModel,
      'actor',
    );
  });
});
