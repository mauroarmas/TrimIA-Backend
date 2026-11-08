import {
  classifyIncomingOptOutText,
  ContactPreferenceService,
  phoneVariants,
} from './contact-preference.service';

describe('ContactPreferenceService — 022 US1 (FR-001..FR-004)', () => {
  describe('classifyIncomingOptOutText', () => {
    it('detecta bajas explícitas sin depender de mayúsculas, signos o tildes (FR-002)', () => {
      expect(classifyIncomingOptOutText('BAJA')).toBe('OPT_OUT');
      expect(classifyIncomingOptOutText('  ¡Baja! ')).toBe('OPT_OUT');
      expect(classifyIncomingOptOutText('No me contacten más por favor')).toBe(
        'OPT_OUT',
      );
      expect(
        classifyIncomingOptOutText('no quiero recibir mas mensajes'),
      ).toBe('OPT_OUT');
      expect(classifyIncomingOptOutText('Dejen de escribirme')).toBe('OPT_OUT');
    });

    it('no confunde el rechazo de un producto con una baja general (US1.4, FR-002)', () => {
      expect(classifyIncomingOptOutText('no quiero ese producto')).toBe(
        'PRODUCT_REJECTION',
      );
      expect(classifyIncomingOptOutText('No me interesa esa heladera')).toBe(
        'PRODUCT_REJECTION',
      );
      expect(classifyIncomingOptOutText('rechazo esa oferta')).toBe(
        'PRODUCT_REJECTION',
      );
    });

    it('identifica pedidos ambiguos o con teléfono de terceros para pedir aclaración (US1.4, Edge Cases)', () => {
      expect(classifyIncomingOptOutText('baja eso')).toBe('AMBIGUOUS_OPT_OUT');
      expect(classifyIncomingOptOutText('no quiero saber más nada')).toBe(
        'AMBIGUOUS_OPT_OUT',
      );
      expect(
        classifyIncomingOptOutText(
          'No me contacten más al +5493764999888',
          '+5493764000111',
        ),
      ).toBe('AMBIGUOUS_OPT_OUT');
    });

    it('deja pasar consultas comerciales habituales como NONE', () => {
      expect(
        classifyIncomingOptOutText('Hola, quiero consultar por una amasadora'),
      ).toBe('NONE');
    });
  });

  describe('phoneVariants', () => {
    it('incluye versión con y sin prefijo + para coincidir entre 002, 020 y 021', () => {
      expect(phoneVariants('+5493764000111')).toEqual(
        expect.arrayContaining(['+5493764000111', '5493764000111']),
      );
    });
  });

  describe('recordOptOut y reactivate con historial', () => {
    it('registra baja, bloquea pendientes y conserva historial al reactivar por supervisión general (US1.5, FR-004)', async () => {
      let storedRow: any = null;
      const mockTx = {
        contactPreference: {
          findMany: jest.fn(async () => (storedRow ? [storedRow] : [])),
          upsert: jest.fn(async ({ create, update }: any) => {
            storedRow = storedRow ? { ...storedRow, ...update } : create;
            return storedRow;
          }),
        },
        prospect: {
          findMany: jest.fn(async () => [{ id: 'prospect-1' }]),
        },
        commercialFollowUp: {
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        conversation: {
          findMany: jest.fn(async () => [{ id: 'conv-1' }]),
        },
        outboundCommunication: {
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      };
      const mockPrisma = {
        ...mockTx,
        $transaction: jest.fn(async (cb: any) => cb(mockTx)),
      };

      const service = new ContactPreferenceService(mockPrisma as any);
      const optOutRes = await service.recordOptOut({
        phone: '+5493764000222',
        reason: 'BAJA',
        sourceMessageId: 'msg-baja-1',
        sourceConversationId: 'conv-1',
      });

      expect(optOutRes.optOut).toBe(true);
      expect(optOutRes.history).toHaveLength(1);
      expect(optOutRes.history[0]).toMatchObject({
        action: 'OPT_OUT',
        reason: 'BAJA',
        sourceMessageId: 'msg-baja-1',
        sourceConversationId: 'conv-1',
      });
      expect(mockTx.commercialFollowUp.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'BLOCKED',
            reasonCode: 'CONTACT_OPT_OUT',
          }),
        }),
      );
      expect(mockTx.outboundCommunication.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            lastErrorCode: 'CONTACT_OPT_OUT',
          }),
        }),
      );

      const reactivated = await service.reactivate({
        phone: '+5493764000222',
        reason: 'El cliente pidió por escrito volver a recibir avisos',
        sourceMessageId: 'msg-alta-2',
        sourceConversationId: 'conv-1',
        actorId: 'sup-general-1',
      });

      expect(reactivated.optOut).toBe(false);
      expect(reactivated.updatedById).toBe('sup-general-1');
      expect(reactivated.history).toHaveLength(2);
      expect(reactivated.history[0].action).toBe('OPT_OUT');
      expect(reactivated.history[1]).toMatchObject({
        action: 'REACTIVATED',
        reason: 'El cliente pidió por escrito volver a recibir avisos',
        sourceMessageId: 'msg-alta-2',
        actorId: 'sup-general-1',
      });
    });
  });
});
