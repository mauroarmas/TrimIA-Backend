import { esOpcionSinEditar } from './interviews-chosen-option';

const OPCIONES = [
  'Sale semanalmente los martes, y llega a Posadas en 3 a 5 días hábiles.',
  'Sí, con recargo del 10%.',
];

describe('esOpcionSinEditar — FR-009 (spec 012)', () => {
  it('una opción idéntica da true', () => {
    expect(esOpcionSinEditar('Sí, con recargo del 10%.', OPCIONES)).toBe(true);
  });

  it('LA REGLA: una opción corta da true — el sistema no puede objetar el texto que él mismo redactó', () => {
    // "Sí" solo dispararía `esAsentimientoVacio`. Acá no, porque es lo que se
    // propuso: ese es exactamente el absurdo que FR-009 viene a evitar.
    expect(esOpcionSinEditar('Sí, con recargo del 10%.', OPCIONES)).toBe(true);
  });

  it('con espacio al final o al principio da true — el textarea los deja sin que nadie lo quiera', () => {
    expect(esOpcionSinEditar('  Sí, con recargo del 10%.  ', OPCIONES)).toBe(
      true,
    );
  });

  it('con espacios internos colapsados da true — misma clase de ruido del textarea', () => {
    expect(esOpcionSinEditar('Sí,  con   recargo del 10%.', OPCIONES)).toBe(
      true,
    );
  });

  it('⚠️ en minúsculas da FALSE — cambiar la mayúscula ES editar, no es un parecido', () => {
    expect(esOpcionSinEditar('sí, con recargo del 10%.', OPCIONES)).toBe(false);
  });

  it('⚠️ sin la tilde da FALSE — misma razón: normalizar de más desactiva la repregunta donde sí corresponde', () => {
    expect(esOpcionSinEditar('Si, con recargo del 10%.', OPCIONES)).toBe(false);
  });

  it('una opción editada a "ok" da false — vuelve a la validación normal', () => {
    expect(esOpcionSinEditar('ok', OPCIONES)).toBe(false);
  });

  it('una opción editada de verdad da false', () => {
    expect(
      esOpcionSinEditar('Sí, con recargo del 15% y solo en Posadas.', OPCIONES),
    ).toBe(false);
  });

  it('sin opciones da false para cualquier texto — no hay nada con qué coincidir', () => {
    expect(esOpcionSinEditar('lo que sea', [])).toBe(false);
    expect(esOpcionSinEditar('Sí, con recargo del 10%.', [])).toBe(false);
  });

  it('texto vacío da false aunque haya opciones — no eligió nada', () => {
    expect(esOpcionSinEditar('', OPCIONES)).toBe(false);
    expect(esOpcionSinEditar('   ', OPCIONES)).toBe(false);
  });

  it('compara contra TODAS las opciones, no solo la primera', () => {
    expect(esOpcionSinEditar(OPCIONES[0], OPCIONES)).toBe(true);
    expect(esOpcionSinEditar(OPCIONES[1], OPCIONES)).toBe(true);
  });
});
