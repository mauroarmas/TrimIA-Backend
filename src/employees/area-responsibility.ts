/**
 * "Ser responsable de **todas** las áreas" (spec 005).
 *
 * Aparece en dos lugares que no se conocen entre sí y que necesitan responder lo
 * mismo:
 *
 *  - la conversación, para saber si a quien habla se lo trata como **gerente**
 *    (`CallerResolver`);
 *  - la escritura de conocimiento, para saber si puede tocar un documento
 *    **transversal**, que no pertenece a ninguna área en particular
 *    (`KnowledgeService.assertPuedeEscribir`).
 *
 * Vive acá y no en `caller.types.ts` a propósito: la escritura NO resuelve un
 * `Caller` —su autor sale del token, no del teléfono— y hacerla importar el objeto
 * conversacional invitaría justo a la confusión que la spec pide evitar. Lo que
 * comparten es esta cuenta, y nada más.
 *
 * Se compara contra las áreas que **existen**, no contra un número fijo: el día que
 * se agregue un área, quien tenía las anteriores deja de ser responsable de todo
 * solo, que es lo correcto.
 */
export function esResponsableDeTodasLasAreas(
  areasPropias: number,
  areasQueExisten: number,
): boolean {
  // `areasQueExisten > 0` no es paranoia: sin esa guarda, una base sin sectores
  // haría que 0 === 0 y **cualquiera** pasaría por responsable de todo.
  return areasQueExisten > 0 && areasPropias === areasQueExisten;
}
