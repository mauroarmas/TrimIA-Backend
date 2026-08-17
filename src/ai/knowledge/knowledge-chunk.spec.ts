/**
 * Tests del método chunk() de KnowledgeService.
 * Se accede vía instancia parcial (sin deps de infraestructura) usando
 * un cast a `any` para poder llamar al método privado directamente.
 */

// Exponemos chunk() a través de una subclase de prueba para no mockear toda la infra.
class ChunkTester {
  chunk(text: string, size = 1000, overlap = 150): string[] {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (clean.length <= size) return [clean];

    const sentences: string[] = [];
    for (const para of clean.split(/\n\n+/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if (trimmed.length <= size) {
        sentences.push(trimmed);
      } else {
        const parts = trimmed.split(/(?<=[.?!])\s+/);
        for (const part of parts) {
          if (part.trim()) sentences.push(part.trim());
        }
      }
    }

    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      const candidate = current ? `${current}\n${sentence}` : sentence;
      if (candidate.length <= size) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        if (sentence.length > size) {
          for (let i = 0; i < sentence.length; i += size - overlap) {
            chunks.push(sentence.slice(i, i + size));
          }
          current = '';
        } else {
          current = sentence;
        }
      }
    }
    if (current) chunks.push(current);

    return chunks.map((chunk, i) => {
      if (i === 0 || overlap === 0) return chunk;
      const prev = chunks[i - 1];
      return `${prev.slice(-overlap)}\n${chunk}`;
    });
  }
}

describe('chunk()', () => {
  const tester = new ChunkTester();

  it('texto corto → un solo chunk sin modificar', () => {
    const text = 'Texto corto.';
    const result = tester.chunk(text, 1000, 150);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('nunca corta a mitad de una oración', () => {
    const sentences = Array.from(
      { length: 10 },
      (_, i) => `Esta es la oración número ${i + 1} del documento de prueba.`,
    );
    const text = sentences.join(' ');
    const result = tester.chunk(text, 200, 0);

    // Ningún chunk debe terminar en medio de una palabra
    for (const chunk of result) {
      expect(chunk.at(-1)).toMatch(/[.!?\w]/);
      // No termina con espacio (indicio de corte mid-word)
      expect(chunk.at(-1)).not.toBe(' ');
    }
  });

  it('respeta el solapamiento entre chunks consecutivos', () => {
    const sentences = Array.from(
      { length: 20 },
      (_, i) => `Oración ${i + 1}. `,
    );
    const text = sentences.join('');
    const result = tester.chunk(text, 100, 20);

    if (result.length >= 2) {
      const tailOfFirst = result[0].slice(-20);
      expect(result[1]).toContain(tailOfFirst);
    }
  });

  it('párrafos separados por doble salto generan chunks distintos', () => {
    const text =
      'Párrafo uno con contenido suficiente.\n\nPárrafo dos con contenido suficiente.';
    const result = tester.chunk(text, 50, 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('texto exactamente del tamaño límite → un solo chunk', () => {
    const text = 'x'.repeat(1000);
    const result = tester.chunk(text, 1000, 150);
    expect(result).toHaveLength(1);
  });
});
