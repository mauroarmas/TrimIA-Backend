import * as fs from 'fs';
import * as path from 'path';

export interface EvaluationDocument {
  id: string;
  title: string;
  content: string;
  audience: 'TODOS' | 'INTERNO' | 'CLIENTE';
  area: string;
}

export class EvaluationCorpusLoader {
  private static cachedDocuments: EvaluationDocument[] | null = null;

  /**
   * Carga todos los documentos JSON del directorio de fixtures de evaluación.
   */
  static loadCorpus(): EvaluationDocument[] {
    if (this.cachedDocuments) {
      return this.cachedDocuments;
    }

    const fixturesDir = path.resolve(__dirname, '../../fixtures/corpus-evaluacion');
    if (!fs.existsSync(fixturesDir)) {
      throw new Error(`Directorio de fixtures no encontrado: ${fixturesDir}`);
    }

    const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    const allDocs: EvaluationDocument[] = [];

    for (const file of files) {
      const filePath = path.join(fixturesDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const area = data.area || path.basename(file, '.json');

        if (Array.isArray(data.documents)) {
          for (const doc of data.documents) {
            allDocs.push({
              id: doc.id,
              title: doc.title,
              content: doc.content,
              audience: doc.audience || 'TODOS',
              area,
            });
          }
        }
      } catch (err: any) {
        console.error(`Error al cargar fixture ${file}:`, err.message);
      }
    }

    this.cachedDocuments = allDocs;
    return allDocs;
  }

  /**
   * Búsqueda por similitud de texto simple sobre el corpus de evaluación fijo.
   */
  static search(query: string, limit = 4): EvaluationDocument[] {
    const docs = this.loadCorpus();
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    const scored = docs.map((doc) => {
      let score = 0;
      const titleLower = doc.title.toLowerCase();
      const contentLower = doc.content.toLowerCase();

      for (const term of terms) {
        if (titleLower.includes(term)) score += 3;
        if (contentLower.includes(term)) score += 1;
      }

      return { doc, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.doc);
  }
}
