/**
 * Un barrido que quedó "corriendo" sin que nadie lo esté ejecutando.
 *
 * Pasa cuando el worker se reinicia a mitad de un job, o cuando una llamada al
 * proveedor tarda más que el `lockDuration` de BullMQ: el job se marca
 * `stalled` y muere **sin pasar por el `catch`** que deja la fila en `FAILED`.
 * La fila queda `RUNNING` para siempre y, como todos estos servicios rechazan
 * o se enganchan cuando hay uno en curso, el barrido no vuelve a arrancar
 * nunca.
 *
 * Apareció tres veces seguidas —detector de documentos, barrido de cobertura y
 * barrido de higiene—, así que el criterio vive acá en vez de copiarse en cada
 * servicio: tres copias de una regla es como se despegan entre sí.
 *
 * Función pura, sin Prisma ni Nest: cada servicio decide qué hacer con el
 * veredicto (el de cobertura arranca uno nuevo, el de documentos también, y
 * los tres marcan `FAILED` con motivo en vez de borrar en silencio — que se
 * cayó es información).
 */
export function estaColgado(
  createdAt: Date,
  minutos: number,
  ahora: Date = new Date(),
): boolean {
  return ahora.getTime() - createdAt.getTime() > minutos * 60_000;
}

/** El motivo que se guarda, para que la corrida muerta se explique sola. */
export function motivoColgado(minutos: number): string {
  return (
    `La corrida quedó sin terminar más de ${minutos} minutos. ` +
    `Probablemente el worker se reinició mientras corría.`
  );
}
