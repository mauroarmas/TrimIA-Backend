/**
 * Puerto hacia el CRM de la empresa (hoy una planilla de Google Sheets).
 *
 * La constitución (Principio V) exige que las integraciones externas se
 * consuman detrás de un puerto con su mock, no acopladas al servicio que las
 * usa. El alta de un cliente escribe hacia el CRM pero NO depende de que esa
 * escritura funcione: Postgres es la fuente de verdad de TrimIA y el Sheets es
 * una copia de ida (ver Assumptions de specs/002-collections-payments/spec.md).
 */
export const CRM_PORT = Symbol('CRM_PORT');

export interface CrmClientRecord {
  name: string;
  phone: string;
  dni?: string | null;
  quotaCount: number;
}

export interface CrmPort {
  /**
   * Alta/actualización del cliente en el CRM. Puede lanzar (mismo criterio que
   * `WhatsappSenderService.send`): es responsabilidad del llamador
   * (`ClientsService.createWithQuotas`) decidir qué hacer con el fallo — hoy lo
   * atrapa con `.catch()` porque el alta local en Postgres ya ocurrió y no
   * debe revertirse por un problema del CRM.
   */
  upsertClient(record: CrmClientRecord): Promise<void>;
}
