import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection } from 'chromadb';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { AgentType, Audience } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

/** Nombre de la colección en ChromaDB donde viven todos los chunks. */
const COLLECTION = 'trimia_knowledge';

export interface IngestInput {
  title: string;
  content: string;
  category: string;
  audience?: Audience; // por defecto INTERNO (lo más restrictivo)
  agentType?: AgentType | null; // null = documento general (todos los agentes)
}

export interface SearchOptions {
  /** Audiencia del que pregunta: CLIENTE→PUBLICO, EMPLEADO→PUBLICO+INTERNO. */
  audience: Audience;
  /** Opcional: restringe a documentos de un agente (+ los generales). */
  agentType?: AgentType;
  k?: number;
}

export interface SearchHit {
  documentId: string;
  title: string;
  content: string;
  score: number; // 1 - distancia coseno (1 = idéntico, 0 = sin relación)
}

/**
 * Motor RAG (Fase 4). Encapsula ChromaDB y los embeddings de Gemini.
 *
 * - Persiste los metadatos de negocio del documento en Prisma (KnowledgeDocument).
 * - Vuelca los chunks vectorizados a ChromaDB con su audiencia/agente.
 * - La búsqueda aplica el filtro de confidencialidad: un cliente nunca
 *   recupera documentos marcados como INTERNO.
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly client: ChromaClient;
  private readonly embeddings: GoogleGenerativeAIEmbeddings;
  private collection!: Collection;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.client = new ChromaClient({
      path: this.config.get<string>('CHROMA_URL'),
    });
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: this.config.get<string>('GOOGLE_API_KEY'),
      model: this.config.get<string>('EMBEDDING_MODEL'),
    });
  }

  async onModuleInit() {
    // Chroma delega la vectorización en Gemini a través de esta función.
    const embeddingFunction = {
      generate: (texts: string[]) => this.embeddings.embedDocuments(texts),
    };
    this.collection = await this.client.getOrCreateCollection({
      name: COLLECTION,
      embeddingFunction,
      // Distancia coseno → score de similitud = 1 - distancia.
      metadata: { 'hnsw:space': 'cosine' },
    });
    this.logger.log(`Colección Chroma "${COLLECTION}" lista`);
  }

  /**
   * Parte un texto en chunks semánticos de ~`size` chars.
   *
   * Estrategia: prioriza cortar en límites naturales del texto para no
   * partir oraciones a la mitad (lo que degrada la calidad del embedding).
   *   1. Si el texto cabe entero → un solo chunk.
   *   2. Divide por párrafos dobles (\n\n) y los agrupa hasta `size`.
   *   3. Si un párrafo supera `size`, lo subdivide por oración (`. `, `? `, `! `).
   *   4. Solo como último recurso corta por índice de char.
   *
   * El solapamiento `overlap` añade los últimos N chars del chunk anterior
   * al inicio del siguiente para preservar contexto en el borde.
   */
  private chunk(text: string, size = 1000, overlap = 150): string[] {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (clean.length <= size) return [clean];

    // Divide por párrafos y luego por oraciones si el párrafo es muy largo.
    const sentences: string[] = [];
    for (const para of clean.split(/\n\n+/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if (trimmed.length <= size) {
        sentences.push(trimmed);
      } else {
        // Partir el párrafo largo por límites de oración.
        const parts = trimmed.split(/(?<=[.?!])\s+/);
        for (const part of parts) {
          if (part.trim()) sentences.push(part.trim());
        }
      }
    }

    // Agrupa oraciones en chunks respetando el límite de tamaño.
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      const candidate = current ? `${current}\n${sentence}` : sentence;
      if (candidate.length <= size) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        // Si la oración sola supera el límite, corte de emergencia por chars.
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

    // Aplica solapamiento: prefija cada chunk (salvo el primero) con el
    // final del chunk anterior para preservar contexto en el borde.
    return chunks.map((chunk, i) => {
      if (i === 0 || overlap === 0) return chunk;
      const prev = chunks[i - 1];
      const tail = prev.slice(-overlap);
      return `${tail}\n${chunk}`;
    });
  }

  /**
   * Ingesta un documento: lo guarda en Prisma y vuelca sus chunks a Chroma.
   */
  async ingest(input: IngestInput): Promise<{ documentId: string; chunks: number }> {
    const audience = input.audience ?? Audience.INTERNO;
    const agentTag = input.agentType ?? 'GENERAL';
    const checksum = createHash('sha256').update(input.content).digest('hex');

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        title: input.title,
        content: input.content,
        category: input.category,
        audience,
        agentType: input.agentType ?? null,
        checksum,
      },
    });

    const chunks = this.chunk(input.content);
    // Precomputamos los vectores con Gemini y los pasamos explícitos a Chroma,
    // para no depender de la función de embeddings interna de la colección.
    const vectors = await this.embeddings.embedDocuments(chunks);
    await this.collection.add({
      ids: chunks.map((_, idx) => `${doc.id}:${idx}`),
      embeddings: vectors,
      documents: chunks,
      metadatas: chunks.map((_, idx) => ({
        documentId: doc.id,
        title: input.title,
        category: input.category,
        audience,
        agentType: agentTag,
        chunkIndex: idx,
      })),
    });

    await this.prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { vectorId: `${doc.id}:*` },
    });

    this.logger.log(
      `Documento "${input.title}" ingestado (${chunks.length} chunks, audiencia=${audience})`,
    );
    return { documentId: doc.id, chunks: chunks.length };
  }

  /**
   * Recupera conocimiento relevante aplicando el filtro de confidencialidad.
   */
  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const k = opts.k ?? 4;

    // Filtro de audiencia: el cliente solo ve lo público.
    const audienceFilter =
      opts.audience === Audience.INTERNO
        ? { audience: { $in: ['PUBLICO', 'INTERNO'] } }
        : { audience: 'PUBLICO' };

    // Filtro opcional por agente (incluye los documentos generales).
    const where = opts.agentType
      ? { $and: [audienceFilter, { agentType: { $in: [opts.agentType, 'GENERAL'] } }] }
      : audienceFilter;

    const queryVector = await this.embeddings.embedQuery(query);
    const res = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: k,
      where,
      // chromadb 1.x no incluye las distancias por defecto: hay que pedirlas.
      include: ['documents', 'metadatas', 'distances'] as never,
    });

    const docs = res.documents?.[0] ?? [];
    const metas = res.metadatas?.[0] ?? [];
    const dists = res.distances?.[0] ?? [];

    return docs.map((content, i) => {
      const meta = (metas[i] ?? {}) as Record<string, unknown>;
      return {
        documentId: String(meta.documentId ?? ''),
        title: String(meta.title ?? ''),
        content: content ?? '',
        score: 1 - (dists[i] ?? 1),
      };
    });
  }
}
