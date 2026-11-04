import type { CrmSheetRow } from '../crm-sheet.mapper';
export enum ProspectStatus {
  NUEVO = 'NUEVO',
  EN_CONTACTO = 'EN_CONTACTO',
  CALIFICA = 'CALIFICA',
  NO_CALIFICA = 'NO_CALIFICA',
  VENTA_CERRADA = 'VENTA_CERRADA',
  PERDIDO = 'PERDIDO',
}

/**
 * Registro interno. `sheet` contiene las 17 columnas canónicas de la hoja CRM.
 * El resto es metadata local y no debe exportarse a Sheets.
 */
export interface CrmProspectRecord {
  localId?: string;
  sheet?: CrmSheetRow;
  fechaContacto: string; // DD/MM/YYYY
  nombreApellido: string;
  telefono: string; // Normalizado
  dni?: string;
  comercio?: string;
  rubro?: string;
  localidad?: string;
  productoInteres: string;
  modalidad: 'CONTADO' | 'CUOTAS_SEMANALES';
  montoEstimado?: number;
  estado: ProspectStatus;
  dictamenCrediticio?: string;
  vendedorAsignado?: string;
  canalOrigen: 'WHATSAPP' | 'WEB' | 'LOCAL';
  ultimaInteraccion: string;
  notasSeguimiento: string;
  conversationId?: string;
}

export const CRM_PORT = Symbol('CRM_PORT');

export interface CrmPort {
  /** Crea un nuevo prospecto en Google Sheets vía webhook n8n */
  createProspect(
    prospect: CrmProspectRecord,
  ): Promise<{ success: boolean; id?: string; remoteSynced?: boolean }>;

  /** Busca prospectos previos por teléfono para contextualizar conversaciones */
  searchProspect(phone: string): Promise<CrmProspectRecord | null>;

  /** Asienta notas de seguimiento y actualiza estado en el CRM */
  addFollowUp(
    phone: string,
    note: string,
    newStatus?: ProspectStatus,
    localId?: string,
  ): Promise<void>;
}
