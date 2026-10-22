import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CrmPort, ProspectStatus } from '../ports/crm.port';

export function createSaveProspectTool(crmPort: CrmPort) {
  return tool(
    async ({ name, phone, product, modality, notes, conversationId }) => {
      try {
        const result = await crmPort.createProspect({
          fechaContacto: new Date().toLocaleDateString('es-AR'),
          nombreApellido: name,
          telefono: phone,
          productoInteres: product,
          modalidad: modality === 'FINANCED' ? 'CUOTAS_SEMANALES' : 'CONTADO',
          estado: ProspectStatus.NUEVO,
          canalOrigen: 'WHATSAPP',
          ultimaInteraccion: new Date().toISOString(),
          notasSeguimiento: notes || 'Captado automáticamente por asistente conversacional TrimIA',
          conversationId,
        });

        return JSON.stringify({
          exito: true,
          mensaje: `Prospecto "${name}" registrado correctamente en el CRM`,
          id: result.id,
        });
      } catch (err: any) {
        return JSON.stringify({
          exito: false,
          mensaje: `Error al registrar prospecto en CRM: ${err.message}`,
        });
      }
    },
    {
      name: 'save_prospect',
      description:
        'Registra los datos de contacto y requerimientos de un cliente o prospecto interesado en el CRM de la empresa.',
      schema: z.object({
        name: z.string().describe('Nombre y apellido del cliente o persona de contacto'),
        phone: z.string().describe('Número de teléfono o WhatsApp normalizado del cliente'),
        product: z.string().describe('Producto, maquinaria o tipo de equipo que le interesa'),
        modality: z.enum(['CASH', 'FINANCED']).describe('Modalidad de pago pretendida (CASH contado o FINANCED cuotas)'),
        notes: z.string().optional().describe('Observaciones adicionales del comercio, rubro o localidad'),
        conversationId: z.string().optional().describe('ID de la conversación de TrimIA'),
      }),
    },
  );
}

