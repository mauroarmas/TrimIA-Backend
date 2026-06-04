import { SpecializedAgent } from './agents.service';

/**
 * Descripción del dominio de cada agente especializado.
 *
 * Fuente ÚNICA de verdad: la usan el clasificador de intención y el
 * sub-clasificador de scope del orquestador, y (Fase 4 Inc. 2) los prompts
 * de cada agente. Si cambia el alcance de un agente, se edita acá.
 */
export const AGENT_DOMAINS: Record<SpecializedAgent, string> = {
  SALES:
    'productos, precios de lista, promociones, intención de compra, qué planes de financiación existen',
  ADMIN:
    'verificación crediticia, aprobación de financiación, si un cliente puntual califica para un crédito, validación de documentación, cotización fuera de lista',
  COLLECTIONS:
    'pagos de cuotas, vencimientos, deudas, envío de comprobantes de pago, cuentas corrientes',
  LOGISTICS:
    'envíos, entregas, tiempos de entrega, transporte, despacho de mercadería',
  DEPOSITS:
    'stock, disponibilidad de productos, pedido de fotos o videos de un producto',
};
