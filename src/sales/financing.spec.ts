import { SalesService } from './sales.service';
import { financingSelection } from '../financing/financing.service';
describe('Fachada de financiación versionada', () => {
  const finance = {
    list: jest.fn().mockResolvedValue([]),
    review: jest.fn(),
    detail: jest.fn(),
  };
  const service = new SalesService(
    null,
    null,
    null,
    undefined,
    undefined,
    finance as any,
  );
  it('delega listado sin reportes crudos', async () => {
    expect(await service.listFinancingRequests()).toEqual([]);
    expect(financingSelection.creditAssessments.select).not.toHaveProperty(
      'rawPayload',
    );
  });
  it.each(['APPROVED', 'REJECTED'] as const)(
    'delega %s conservando versión y actor humano',
    async (decision) => {
      const dto = { expectedVersion: 2, decision, note: 'Revisión humana' };
      await service.reviewFinancingRequest('request', dto, 'supervisor');
      expect(finance.review).toHaveBeenCalledWith('request', dto, 'supervisor');
    },
  );
});
