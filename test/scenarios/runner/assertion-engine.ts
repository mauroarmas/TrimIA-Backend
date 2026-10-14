import { AssertionViolation, ScenarioAssertions } from '../types';

export class AssertionEngine {
  /**
   * Evalúa la respuesta de una corrida frente a las aserciones del escenario.
   */
  static evaluate(
    response: {
      text: string;
      routedAgent?: string;
      escalated?: boolean;
    },
    assertions: ScenarioAssertions,
  ): AssertionViolation[] {
    const violations: AssertionViolation[] = [];
    const text = response.text || '';

    // 1. Patrones obligatorios (mustContain)
    if (assertions.mustContain) {
      for (const pattern of assertions.mustContain) {
        const matches = pattern instanceof RegExp
          ? pattern.test(text)
          : text.toLowerCase().includes(pattern.toLowerCase());

        if (!matches) {
          violations.push({
            rule: 'mustContain',
            expected: pattern.toString(),
            actual: text.slice(0, 140) + (text.length > 140 ? '...' : ''),
            reason: `El texto generado no contiene el patrón obligatorio: ${pattern}`,
          });
        }
      }
    }

    // 2. Patrones prohibidos (mustNotContain)
    if (assertions.mustNotContain) {
      for (const pattern of assertions.mustNotContain) {
        const matches = pattern instanceof RegExp
          ? pattern.test(text)
          : text.toLowerCase().includes(pattern.toLowerCase());

        if (matches) {
          violations.push({
            rule: 'mustNotContain',
            expected: `NO contener ${pattern}`,
            actual: text.slice(0, 140) + (text.length > 140 ? '...' : ''),
            reason: `El texto generado contiene un patrón explícitamente prohibido: ${pattern}`,
          });
        }
      }
    }

    // 3. Verificación de agente ruteado
    if (assertions.expectedAgent && response.routedAgent) {
      if (response.routedAgent.toLowerCase() !== assertions.expectedAgent.toLowerCase()) {
        violations.push({
          rule: 'expectedAgent',
          expected: assertions.expectedAgent,
          actual: response.routedAgent,
          reason: `Se esperaba ruteo a ${assertions.expectedAgent} pero fue ruteado a ${response.routedAgent}`,
        });
      }
    }

    // 4. Verificación de escalado
    if (assertions.expectedEscalation !== undefined) {
      if (Boolean(response.escalated) !== assertions.expectedEscalation) {
        violations.push({
          rule: 'expectedEscalation',
          expected: assertions.expectedEscalation ? 'ESCALADO' : 'NO ESCALADO',
          actual: response.escalated ? 'ESCALADO' : 'NO ESCALADO',
          reason: `El estado de escalado no coincide con lo esperado`,
        });
      }
    }

    // 5. Verificación personalizada opcional
    if (assertions.customCheck) {
      try {
        const customResult = assertions.customCheck(response);
        if (!customResult.passed) {
          violations.push({
            rule: 'customCheck',
            expected: 'Validación personalizada exitosa',
            actual: 'Validación personalizada fallida',
            reason: customResult.reason || 'Fallo en comprobación personalizada',
          });
        }
      } catch (err: any) {
        violations.push({
          rule: 'customCheck',
          expected: 'Ejecución sin errores',
          actual: err.message,
          reason: `Excepción en customCheck: ${err.message}`,
        });
      }
    }

    return violations;
  }
}
