import { CrmProspectRecord, ProspectStatus } from './ports/crm.port';

export const CRM_COLUMNS = [
  'Fecha primer contacto',
  'Nombre',
  'Teléfono',
  'Comercio',
  'Rubro',
  'Localidad',
  'Canal origen',
  'Producto/s',
  'Consulta/Venta',
  'Medio de pago',
  'Planes',
  'Objeciones',
  'Observaciones',
  'Rebatir Objeción',
  'Seguimiento',
  'Fecha último contacto',
  'Fecha próximo contacto',
] as const;
export type CrmSheetRow = Record<(typeof CRM_COLUMNS)[number], string>;

/** Transporte exclusivo de las 17 columnas; DNI, scoring y notas internas no salen. */
export function toCrmSheet(record: CrmProspectRecord): CrmSheetRow {
  const base: CrmSheetRow = {
    'Fecha primer contacto': record.fechaContacto ?? '',
    Nombre: record.nombreApellido ?? '',
    Teléfono: record.telefono ?? '',
    Comercio: record.comercio ?? '',
    Rubro: record.rubro ?? '',
    Localidad: record.localidad ?? '',
    'Canal origen': record.canalOrigen ?? '',
    'Producto/s': record.productoInteres ?? '',
    'Consulta/Venta':
      record.estado === ProspectStatus.VENTA_CERRADA ? 'Venta' : 'Consulta',
    'Medio de pago': '',
    Planes: record.modalidad === 'CUOTAS_SEMANALES' ? 'Cuotas semanales' : '',
    Objeciones: '',
    Observaciones: '',
    'Rebatir Objeción': '',
    Seguimiento: record.notasSeguimiento ?? '',
    'Fecha último contacto': record.ultimaInteraccion ?? '',
    'Fecha próximo contacto': '',
  };

  if (record.sheet && typeof record.sheet === 'object') {
    for (const column of CRM_COLUMNS) {
      const val = record.sheet[column];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        base[column] = String(val);
      }
    }
  }

  return base;
}
export function fromCrmSheet(
  input: Record<string, unknown>,
): CrmProspectRecord {
  const sheet = Object.fromEntries(
    CRM_COLUMNS.map((column) => [
      column,
      typeof input[column] === 'string'
        ? input[column]
        : input[column] == null
          ? ''
          : String(input[column]),
    ]),
  ) as CrmSheetRow;
  return {
    fechaContacto: sheet['Fecha primer contacto'],
    nombreApellido: sheet.Nombre,
    telefono: sheet.Teléfono,
    comercio: sheet.Comercio,
    rubro: sheet.Rubro,
    localidad: sheet.Localidad,
    productoInteres: sheet['Producto/s'],
    modalidad: /cuotas/i.test(sheet.Planes) ? 'CUOTAS_SEMANALES' : 'CONTADO',
    estado:
      sheet['Consulta/Venta'] === 'Venta'
        ? ProspectStatus.VENTA_CERRADA
        : ProspectStatus.NUEVO,
    canalOrigen: sheet['Canal origen'] as any,
    ultimaInteraccion: sheet['Fecha último contacto'],
    notasSeguimiento: sheet.Seguimiento,
    sheet,
  };
}
export function localCrmRecord(local: any): CrmProspectRecord {
  const stored =
    local.crmData && typeof local.crmData === 'object' ? local.crmData : {};
  const record: CrmProspectRecord = {
    ...stored,
    ...(stored.sheet
      ? {
          sheet: {
            ...stored.sheet,
            'Producto/s': local.productInterest,
            Planes: local.modality === 'FINANCED' ? 'Cuotas semanales' : '',
            Seguimiento: local.notes ?? stored.sheet.Seguimiento ?? '',
          },
        }
      : {}),
    localId: local.id,
    fechaContacto:
      stored.fechaContacto ?? local.createdAt.toISOString().slice(0, 10),
    nombreApellido: local.name,
    telefono: local.phone,
    comercio: local.comercio ?? undefined,
    rubro: local.rubro ?? undefined,
    localidad: local.localidad ?? undefined,
    productoInteres: local.productInterest,
    modalidad: local.modality === 'FINANCED' ? 'CUOTAS_SEMANALES' : 'CONTADO',
    estado: local.status,
    canalOrigen: local.originChannel ?? 'WHATSAPP',
    ultimaInteraccion: local.updatedAt.toISOString(),
    notasSeguimiento: local.notes ?? '',
    conversationId: local.conversationId ?? undefined,
  };
  return record;
}
