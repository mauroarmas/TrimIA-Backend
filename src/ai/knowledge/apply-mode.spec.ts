/**
 * Tests de `componerContenido` — la regla de "agregar o pisar".
 *
 * Vale la pena testearla sola aunque sea de tres líneas: la usan **dos**
 * caminos que corrigen documentos con texto aprobado por una persona (las
 * fichas de entrevista y la resolución de un caso escalado), y lo que se está
 * fijando no es el `if` sino el resultado exacto de la unión — que es lo que
 * después lee el chunker.
 */
import { componerContenido } from './apply-mode';

const ACTUAL = 'Lo que el documento dice hoy.';
const NUEVO = 'El dato que faltaba.';

describe('componerContenido', () => {
  it('AGREGAR deja lo anterior y suma lo nuevo al final', () => {
    expect(componerContenido('AGREGAR' as never, ACTUAL, NUEVO)).toBe(
      `${ACTUAL}\n\n${NUEVO}`,
    );
  });

  it('REEMPLAZAR devuelve solo lo nuevo', () => {
    expect(componerContenido('REEMPLAZAR' as never, ACTUAL, NUEVO)).toBe(NUEVO);
  });

  /**
   * El motivo real de los `trim`. Un documento que ya termina en saltos de
   * línea y un texto que empieza con otros dan cuatro renglones en blanco, y el
   * chunker los lee como una separación de secciones que nadie quiso poner.
   * Exactamente uno, venga como venga cada lado.
   */
  it('AGREGAR normaliza a UN renglón en blanco, sobren o falten', () => {
    expect(
      componerContenido('AGREGAR' as never, `${ACTUAL}\n\n\n`, `\n\n${NUEVO}`),
    ).toBe(`${ACTUAL}\n\n${NUEVO}`);
  });

  it('REEMPLAZAR no toca el texto nuevo, ni sus espacios', () => {
    // Acá no hay unión que normalizar: lo que se aprobó es el documento.
    expect(
      componerContenido('REEMPLAZAR' as never, ACTUAL, `\n${NUEVO}\n`),
    ).toBe(`\n${NUEVO}\n`);
  });

  it('AGREGAR sobre un documento vacío no deja renglones al principio', () => {
    expect(componerContenido('AGREGAR' as never, '', NUEVO)).toBe(
      `\n\n${NUEVO}`,
    );
  });
});
