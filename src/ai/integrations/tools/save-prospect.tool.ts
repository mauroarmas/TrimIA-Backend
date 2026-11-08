import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CrmPort, ProspectStatus } from '../ports/crm.port';

export function createSaveProspectTool(crm: CrmPort) {
  return tool(
    async ({ name, product, modality, notes }, config) => {
      const contact = config?.configurable?.contact;
      if (!contact?.phone || !contact?.conversationId)
        return JSON.stringify({
          exito: false,
          mensaje: 'No hay un contacto verificado en esta conversación.',
        });
      try {
        const existing =
          config?.configurable?.prospect ??
          (await crm.searchProspect(contact.phone));
        if (
          existing?.localId &&
          existing.productoInteres === product &&
          existing.estado !== ProspectStatus.VENTA_CERRADA &&
          existing.estado !== ProspectStatus.PERDIDO
        ) {
          // Reusar el contacto del mismo interés, manteniendo repeticiones deliberadas de otras oportunidades.
          await crm.addFollowUp(
            contact.phone,
            notes || 'Continúa la consulta por ' + product,
            undefined,
            existing.localId,
          );
          return JSON.stringify({
            exito: true,
            id: existing.localId,
            mensaje: 'Contacto existente actualizado.',
          });
        }
        const result = await crm.createProspect({
          fechaContacto: new Date().toISOString().slice(0, 10),
          nombreApellido: name,
          telefono: contact.phone,
          productoInteres: product,
          modalidad: modality === 'FINANCED' ? 'CUOTAS_SEMANALES' : 'CONTADO',
          estado: ProspectStatus.NUEVO,
          canalOrigen: 'WHATSAPP',
          ultimaInteraccion: new Date().toISOString(),
          notasSeguimiento: notes ?? '',
          conversationId: contact.conversationId,
          comercio: existing?.comercio,
          rubro: existing?.rubro,
          localidad: existing?.localidad,
        });
        return JSON.stringify({
          exito: result.success,
          id: result.id,
          pendienteSincronizacion: !result.remoteSynced,
          mensaje: 'Contacto guardado en TrimIA.',
        });
      } catch {
        return JSON.stringify({
          exito: false,
          mensaje: 'No se pudo guardar el contacto. Requiere revisión manual.',
        });
      }
    },
    {
      name: 'save_prospect',
      description:
        'Guarda un interés comercial con el contacto verificado del hilo. No inventes nombre, producto ni modalidad; usá solo los relevados.',
      schema: z.object({
        name: z.string().trim().min(1),
        product: z.string().trim().min(1),
        modality: z.enum(['CASH', 'FINANCED']),
        notes: z.string().optional(),
      }),
    },
  );
}
