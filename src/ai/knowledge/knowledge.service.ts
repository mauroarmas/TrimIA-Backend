import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChromaClient, Collection } from 'chromadb';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import {
  AgentType,
  Audience,
  KnowledgeChangeOrigin,
  KnowledgeSourceType,
  KnowledgeSyncStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EmployeesService } from '../../employees/employees.service';
import { esResponsableDeTodasLasAreas } from '../../employees/area-responsibility';
import { KnowledgeUsageService } from './knowledge-usage.service';

/** Nombre de la colección en ChromaDB donde viven todos los chunks. */
const COLLECTION = 'trimia_knowledge';

/** Cuántos caracteres del contenido viajan como resumen en el listado. */
const SUMMARY_LENGTH = 240;

/** ChromaDB solo admite escalares en la metadata de un chunk. */
type ChunkMetadata = Record<string, string | number | boolean>;

export interface IngestInput {
  title: string;
  content: string;
  category: string;
  audience?: Audience; // por defecto INTERNO (lo más restrictivo)
  agentType?: AgentType | null; // null = documento general (todos los agentes)
  /**
   * De dónde salió el conocimiento (Sprint 5A, FR-026). Por defecto DOCUMENTO,
   * que es lo que era todo antes del sprint. `sourceId` apunta al
   * `KnowledgeFile` o a la `Escalation` según el tipo: deliberadamente sin FK,
   * porque tres columnas nullable excluyentes serían peor que una sin
   * integridad referencial (ver data-model.md).
   */
  sourceType?: KnowledgeSourceType;
  sourceId?: string | null;
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

/** Filtros del listado del panel (Sprint 5A). */
export interface ListFilter {
  agentType?: AgentType;
  category?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/** Campos editables de un documento (Sprint 5A). */
export interface UpdateInput {
  title?: string;
  content?: string;
  category?: string;
  audience?: Audience;
  agentType?: AgentType;
  /** MANUAL por defecto; AI_ACCEPTED lo usa "Editar con la IA" (US6). */
  origin?: KnowledgeChangeOrigin;
  /** Qué le pidió el supervisor a la IA, cuando el origen es AI_ACCEPTED. */
  aiInstruction?: string;
  /**
   * Versión sobre la que se preparó el cambio. Si ya no es la vigente, el
   * update falla con 409 en vez de pisar la edición de otro (FR-033).
   * Opcional: el `PUT` manual no lo usa.
   */
  expectedVersion?: number;
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
    @InjectQueue('knowledge-reindex')
    private readonly reindexQueue: Queue,
    private readonly usage: KnowledgeUsageService,
    private readonly employees: EmployeesService,
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
   * Único lugar donde se decide si alguien puede **escribir** un documento
   * (spec 005, US5, FR-011/FR-012).
   *
   * ```text
   * documento transversal  →  el autor es responsable de TODAS las áreas
   * si no                  →  el área del documento ∈ áreas del autor
   * ```
   *
   * **Por qué acá y no en el controlador ni en un guard.** La escritura entra por
   * diez caminos, y dos de ellos no están en la pantalla de gestión: resolver un
   * caso "enseñándole al agente" y guardar una respuesta sin enviarla. Con la regla
   * en la ruta, un responsable de Ventas mete un documento de Cobranzas resolviendo
   * un caso y nada lo delata. Este método es la regla; cada camino lo llama.
   *
   * ⚠️ **El `autor` NO es el `Caller` conversacional.** Son el mismo concepto con
   * dos resoluciones distintas: el `Caller` se resuelve por **teléfono** y sirve
   * para el trato del asistente; el autor de acá sale del **empleado autenticado
   * del token**, porque los diez caminos son requests HTTP sin teléfono. El
   * parámetro se llama `autorId` para que el nombre impida la confusión en vez de
   * invitarla.
   *
   * **Ver no se restringe** (FR-013): el listado y el detalle siguen mostrando
   * todo. Hace falta ver lo de otras áreas para no duplicarlo y para saber a quién
   * derivar; filtrar la lectura empeoraría justo lo que esto protege.
   *
   * @param agentType área del documento. `null` es **transversal**: responde para
   *   todos los agentes, así que con la regla general no lo podría tocar nadie
   *   (CL-6) y necesita su propia línea.
   */
  async assertPuedeEscribir(
    autorId: string,
    agentType: AgentType | null,
  ): Promise<void> {
    const autor = await this.employees.findById(autorId);
    const areas = autor.areasSupervisadas ?? [];

    if (agentType === null) {
      const totalAreas = await this.prisma.sector.count();
      if (!esResponsableDeTodasLasAreas(areas.length, totalAreas)) {
        throw new ForbiddenException(
          'Este documento no es de un área en particular: responde para todos ' +
            'los agentes, así que solo lo puede modificar quien es responsable de ' +
            'todas las áreas.',
        );
      }
      return;
    }

    // Un área sin agente asignado no habilita ningún documento: `Sector.agentType`
    // es lo que traduce "área" a "corpus", y sin él no hay nada que traducir.
    const agentesPropios = areas
      .map((area) => area.agentType)
      .filter((tipo): tipo is AgentType => tipo !== null);

    if (!agentesPropios.includes(agentType)) {
      // El mensaje dice de qué áreas SÍ es responsable: sin eso, alguien recién
      // asignado no tiene forma de saber si el problema es el documento o su
      // propia asignación. Y un responsable sin áreas —que no puede escribir
      // nada— es un estado detectable en vez de un permiso implícito (CL-10).
      const propias = areas.map((area) => area.name).join(', ');
      throw new ForbiddenException(
        `Este documento es de otra área. ` +
          (propias
            ? `Sos responsable de: ${propias}.`
            : `No tenés áreas asignadas, así que no podés modificar documentos.`),
      );
    }
  }

  /**
   * Ingesta un documento: lo guarda en Prisma y vuelca sus chunks a Chroma.
   *
   * ⚠️ **No autoriza nada**: es la primitiva de escritura, y también la usa el worker
   * de ingestión de archivos, que corre sin nadie autenticado detrás. Quien decide
   * si esta escritura corresponde es `assertPuedeEscribir`, y lo hace en la **puerta**
   * —el endpoint o el caso que se resuelve—, donde todavía existe un autor. Si
   * aparece una puerta nueva que llame acá, tiene que llamar antes a la regla.
   */
  /**
   * El texto con el que se calcula el vector de un fragmento (spec 006, FR-005).
   *
   * **El título no se vectorizaba.** Viajaba solo en la metadata de Chroma, que
   * no participa de la similitud, así que un documento «Sobre Nosotros» cuyo
   * cuerpo no repite la palabra "empresa" perdía contra la consulta "qué sabés
   * sobre la empresa" frente a documentos que no eran la respuesta.
   *
   * Medido sobre el corpus real: la señal sube entre 1.3 y 3.3 puntos y el piso
   * de ruido **baja** 2.1 — o sea que separa mejor por los dos lados. En el
   * caso que falló el 2026-08-20 el documento correcto pasa de la posición 3 a
   * la 1.
   *
   * ⚠️ **Esto NO cambia lo que se guarda como `documents` en Chroma**, que es
   * lo que `search()` devuelve y lo que termina leyendo el asistente (FR-006).
   * El vector se calcula sobre un texto enriquecido; el contenido que se
   * devuelve es el original. Que los dos dejen de coincidir es a propósito, y
   * es lo que permite mejorar el recall sin cambiar lo que el agente responde.
   *
   * **Solo el título.** Categoría y agente quedaron afuera a conciencia: son
   * etiquetas cortas y repetidas, y el riesgo de que acerquen entre sí a todos
   * los documentos de una misma área es real y no se midió.
   */
  private textoAVectorizar(title: string, chunk: string): string {
    return `${title}\n\n${chunk}`;
  }

  /**
   * Vectoriza y **verifica que salió bien** (spec 006, FR-001..004).
   *
   * ⚠️ **`embedDocuments` no lanza cuando falla.** Su implementación en
   * `@langchain/google-genai` usa `Promise.allSettled` y, para el lote
   * rechazado, devuelve `Array(n).fill([])`:
   *
   *     .flatMap((res, idx) => res.status === "fulfilled"
   *       ? res.value.embeddings.map((e) => e.values || [])
   *       : Array(batchEmbedChunks[idx].length).fill([]))
   *
   * Sin esta guarda, esos vectores vacíos se escribían en ChromaDB y el
   * documento quedaba `SYNCED` a continuación: el panel lo mostraba sano, el
   * documento dejaba de ser recuperable, y nada lo delataba. Es el mismo modo
   * de fallo que `KnowledgeSyncStatus` existe para evitar, entrando por una
   * puerta que el diseño del Sprint 5A no contemplaba.
   *
   * No es teórico: midiendo el corpus real, una corrida devolvió **98 vectores
   * vacíos** de golpe sin un solo error en consola.
   *
   * La invariante: `SYNCED` ⟹ hay un vector válido por cada fragmento.
   *
   * Vive acá, en un solo lugar, y la usan los dos caminos que vectorizan
   * (`ingest` y `reindex`). Si aparece un tercero, tiene que pasar por acá.
   */
  private async vectorizar(textos: string[]): Promise<number[][]> {
    const vectores = await this.embeddings.embedDocuments(textos);

    if (vectores.length !== textos.length) {
      throw new Error(
        `El servicio de embeddings devolvió ${vectores.length} vectores para ` +
          `${textos.length} fragmentos. No se escribe nada.`,
      );
    }
    const vacios = vectores.filter((v) => !v || v.length === 0).length;
    if (vacios > 0) {
      throw new Error(
        `El servicio de embeddings devolvió ${vacios} de ${textos.length} ` +
          `vectores vacíos (probable fallo de cuota o de red en un lote). ` +
          `No se escribe nada.`,
      );
    }

    return vectores;
  }

  async ingest(
    input: IngestInput,
  ): Promise<{ documentId: string; chunks: number }> {
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
        sourceType: input.sourceType ?? KnowledgeSourceType.DOCUMENTO,
        sourceId: input.sourceId ?? null,
      },
    });

    const chunks = this.chunk(input.content);

    // Precomputamos los vectores con Gemini y los pasamos explícitos a Chroma,
    // para no depender de la función de embeddings interna de la colección.
    //
    // Si la vectorización falla, el documento se CONSERVA en REINDEX_FAILED en
    // vez de borrarse (spec 006, FR-002). Tres motivos:
    //
    //  1. En `POST /knowledge/upload` el texto ya costó una extracción cara
    //     (unpdf, mammoth o Gemini Vision). Borrarlo obliga a reprocesar el
    //     archivo entero por un 429.
    //  2. En "responder y enseñar a la IA" la respuesta al cliente YA se envió;
    //     la ingesta es un efecto posterior. Borrar perdería el conocimiento en
    //     silencio — justo el modo de fallo que esta guarda vino a eliminar.
    //  3. REINDEX_FAILED ya existe y el panel ya sabe mostrarlo, con su botón
    //     de reintentar.
    //
    // La invariante que importa no es "el documento no existe", es **"no hay
    // vectores inválidos en el índice"**. Un documento sin vectores se arregla
    // con un clic; uno con vectores rotos marcado SYNCED no, porque nadie sabe
    // que está roto.
    let vectors: number[][];
    try {
      vectors = await this.vectorizar(
        chunks.map((c) => this.textoAVectorizar(input.title, c)),
      );
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      await this.markReindexFailed(doc.id, motivo);
      this.logger.error(
        `Documento "${input.title}" quedó sin vectorizar (${motivo}). ` +
          `Se conserva en REINDEX_FAILED para reintentar desde el panel.`,
      );
      throw err;
    }

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
        // Sprint 5A: viajan en la metadata para que search() pueda excluir los
        // documentos desactivados sin borrar sus vectores, y para detectar
        // chunks huérfanos de una reindexación a medias.
        isActive: true,
        version: doc.version,
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

    // Sprint 5A: un documento desactivado deja de responder, sin borrar sus
    // vectores (reactivar no debe pagar embeddings de nuevo).
    //
    // ⚠️ Los chunks ingestados antes del Sprint 5A no traen `isActive`, y un
    // `where` de igualdad NO matchea si la clave está ausente: sin el backfill
    // de `prisma/backfill-chunk-metadata.ts` esta condición deja afuera todo el
    // corpus previo y los agentes escalan en cada consulta, sin ningún error.
    const activeFilter = { isActive: true };

    // Filtro opcional por agente (incluye los documentos generales).
    // Los tres criterios —audiencia, actividad y agente— se resuelven acá y en
    // ningún otro lado: es el punto único de filtrado (Principio I).
    const where = opts.agentType
      ? {
          $and: [
            audienceFilter,
            activeFilter,
            { agentType: { $in: [opts.agentType, 'GENERAL'] } },
          ],
        }
      : { $and: [audienceFilter, activeFilter] };

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

  // ==========================================================================
  // Gestión de la base de conocimiento (Sprint 5A)
  // ==========================================================================

  /** Listado del panel, filtrado por área/categoría/estado (FR-019). */
  async list(filter: ListFilter = {}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = {
      ...(filter.agentType ? { agentType: filter.agentType } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.knowledgeDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: { updatedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.knowledgeDocument.count({ where }),
    ]);

    // Una sola query para el uso de TODA la página, en vez de una por fila
    // (US7, FR-047).
    const usage = await this.usage.forDocuments(rows.map((r) => r.id));

    return {
      data: rows.map(({ content, ...doc }) => ({
        ...doc,
        // El listado no manda el contenido entero: son N documentos y el panel
        // solo muestra un resumen. El texto completo va en findById().
        summary: content.slice(0, SUMMARY_LENGTH),
        usage: usage.get(doc.id),
      })),
      page,
      limit,
      total,
      hasMore: skip + rows.length < total,
    };
  }

  /**
   * De dónde salió el documento (US7, FR-026).
   *
   * `sourceId` no tiene FK a propósito (tres columnas nullable excluyentes
   * serían peor, ver data-model.md), así que el destino se resuelve acá según
   * el `sourceType` en vez de por un `include` de Prisma.
   */
  private async buildSource(doc: {
    sourceType: KnowledgeSourceType;
    sourceId: string | null;
    uploadedFile?: {
      id: string;
      filename: string;
      mimeType: string;
      storagePath: string | null;
    } | null;
  }) {
    if (doc.sourceType === KnowledgeSourceType.ESCALADO && doc.sourceId) {
      const escalation = await this.prisma.escalation.findUnique({
        where: { id: doc.sourceId },
        select: { id: true, reason: true, resolvedAt: true },
      });
      return { type: doc.sourceType, escalation };
    }

    const file = doc.uploadedFile;
    return {
      type: doc.sourceType,
      // `file: null` cuando el origen fue un audio —el binario se eliminó al
      // transcribir (FR-004)— o cuando se cargó como texto plano. Sin el
      // `storagePath` no hay nada que descargar, así que no se ofrece el link.
      file:
        file && file.storagePath
          ? {
              id: file.id,
              filename: file.filename,
              mimeType: file.mimeType,
              downloadUrl: `/knowledge/files/${file.id}/download`,
            }
          : null,
    };
  }

  /** Detalle completo con origen y bitácora (pantalla Fig 16). */
  async findById(id: string) {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      include: {
        updatedBy: { select: { id: true, name: true } },
        uploadedFile: true,
        changes: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');

    const { uploadedFile: _file, ...rest } = doc;
    return {
      ...rest,
      source: await this.buildSource(doc),
      usage: await this.usage.forDocument(id),
    };
  }

  /**
   * Edita un documento (FR-020).
   *
   * La decisión central: **solo un cambio de `content` invalida los vectores**.
   * Editar el título o la categoría no altera lo que el agente recupera, así
   * que no versiona ni reindexa — reindexar por cambiar una etiqueta pagaría
   * embeddings sin motivo.
   *
   * Cuando sí hay que reindexar, el orden es deliberado: primero se marca
   * `PENDING_REINDEX` y recién después se encola. Si el proceso muere entre
   * medio, el documento queda visiblemente desincronizado y el reintento lo
   * resuelve; nunca queda en `SYNCED` mintiendo (FR-024).
   */
  async update(id: string, input: UpdateInput, employeeId: string) {
    const current = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');

    // Spec 005: se necesita permiso sobre el área DEL DOCUMENTO. Va adentro del
    // servicio y no en la ruta porque acá pasan las dos puertas que editan —el
    // `PUT` del panel y el "editar con la IA", que termina llamando a este mismo
    // método—, así que una sola línea cubre las dos.
    await this.assertPuedeEscribir(employeeId, current.agentType);

    // Y si el cambio MUEVE el documento de área, también hace falta permiso sobre
    // el destino: si no, alguien podría meter contenido en un área ajena en dos
    // pasos —crear en la propia y reasignar— y la regla no serviría para nada.
    if (
      input.agentType !== undefined &&
      input.agentType !== current.agentType
    ) {
      await this.assertPuedeEscribir(employeeId, input.agentType ?? null);
    }

    // Bloqueo optimista (FR-033). Va acá y no en el controller para que valga
    // sin importar quién llame — el chequeo protege el documento, no la ruta.
    //
    // Solo aplica cuando el llamador dice sobre qué versión trabajó: `PUT`
    // manual no la manda (el supervisor está mirando el texto que edita),
    // pero "editar con la IA" sí, porque entre el preview y el apply pasa un
    // rato en el que otro pudo haber guardado.
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version
    ) {
      throw new ConflictException({
        statusCode: 409,
        reason: 'VERSION_CONFLICT',
        currentVersion: current.version,
        message:
          `Otra persona editó este documento mientras preparabas el cambio ` +
          `(ahora va por la versión ${current.version}). Volvé a generar la ` +
          `propuesta sobre el texto actual para no pisar lo que hizo.`,
      });
    }

    const changedFields = (
      ['title', 'content', 'category', 'audience', 'agentType'] as const
    ).filter(
      (field) => input[field] !== undefined && input[field] !== current[field],
    );

    if (changedFields.length === 0) return current;

    const contentChanged = changedFields.includes('content');
    // La audiencia y el agente viajan en la metadata de cada chunk, así que
    // cambiarlos también obliga a re-volcar a Chroma aunque el texto sea el
    // mismo: si no, un documento que pasa a INTERNO seguiría siendo
    // recuperable por un cliente. Es un agujero de confidencialidad, no una
    // desprolijidad (Principio I).
    const needsReindex =
      contentChanged ||
      changedFields.includes('audience') ||
      changedFields.includes('agentType');

    const updated = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.knowledgeDocument.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.agentType !== undefined
            ? { agentType: input.agentType }
            : {}),
          ...(contentChanged
            ? {
                version: { increment: 1 },
                checksum: createHash('sha256')
                  .update(input.content!)
                  .digest('hex'),
              }
            : {}),
          ...(needsReindex
            ? {
                syncStatus: KnowledgeSyncStatus.PENDING_REINDEX,
                syncError: null,
              }
            : {}),
          updatedById: employeeId,
        },
      });

      await tx.knowledgeChange.create({
        data: {
          documentId: id,
          authorId: employeeId,
          changedFields,
          origin: input.origin ?? KnowledgeChangeOrigin.MANUAL,
          aiInstruction: input.aiInstruction ?? null,
        },
      });

      return doc;
    });

    if (needsReindex) {
      await this.reindexQueue.add(
        'reindex-document',
        { documentId: id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 200 },
        },
      );
    }

    this.logger.log(
      `Documento ${id} editado (${changedFields.join(', ')})` +
        (needsReindex ? ' → reindexación encolada' : ' → sin reindexar'),
    );
    return updated;
  }

  /**
   * Activa o desactiva un documento (FR-022).
   *
   * No borra los chunks: actualiza su metadata para que `search()` los excluya.
   * Así reactivar cuesta un update de metadata y no una tanda de embeddings.
   */
  async setActive(id: string, isActive: boolean, autorId: string) {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.assertPuedeEscribir(autorId, doc.agentType);
    if (doc.isActive === isActive) return doc;

    await this.updateChunkMetadata(id, { isActive });

    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { isActive },
    });
    this.logger.log(`Documento ${id} ${isActive ? 'activado' : 'desactivado'}`);
    return updated;
  }

  /**
   * Elimina un documento definitivamente (FR-023).
   *
   * Primero Chroma y después Postgres, a propósito: si fallara al revés,
   * quedarían chunks huérfanos respondiendo consultas sobre un documento que el
   * panel ya no muestra — la peor combinación posible.
   *
   * El `KnowledgeFile` que lo originó sobrevive con `documentId: null`
   * (`onDelete: SetNull`): borrar el conocimiento no borra el rastro de quién
   * subió qué (OE-11).
   */
  async remove(id: string, autorId: string) {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.assertPuedeEscribir(autorId, doc.agentType);

    await this.collection.delete({ where: { documentId: id } });
    await this.prisma.knowledgeDocument.delete({ where: { id } });

    this.logger.log(`Documento ${id} eliminado (Chroma + Postgres)`);
  }

  /** Reemplaza los chunks de un documento. Lo usa el worker de reindexación. */
  async reindex(documentId: string): Promise<number> {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');

    const chunks = this.chunk(doc.content);

    // ORDEN DELIBERADO: vectorizar y validar ANTES de borrar (spec 006, FR-003).
    //
    // El borrado sigue yendo antes del alta —si se agregara primero, una falla
    // intermedia dejaría las dos versiones conviviendo y el agente podría
    // responder con la vieja aunque el panel muestre la nueva—, pero la
    // vectorización se adelantó a las dos cosas.
    //
    // El motivo: si se vectorizara después del borrado, un fallo de embeddings
    // dejaría al documento SIN fragmentos, invisible para la búsqueda hasta que
    // alguien reintentara a mano. Validando primero, un fallo no cuesta nada:
    // el documento sigue respondiendo con su versión anterior mientras BullMQ
    // reintenta. El estado anterior es *viejo*, no *roto*.
    const vectors = await this.vectorizar(
      chunks.map((c) => this.textoAVectorizar(doc.title, c)),
    );

    await this.collection.delete({ where: { documentId } });

    await this.collection.add({
      ids: chunks.map((_, idx) => `${doc.id}:${idx}`),
      embeddings: vectors,
      documents: chunks,
      metadatas: chunks.map((_, idx) => ({
        documentId: doc.id,
        title: doc.title,
        category: doc.category,
        audience: doc.audience,
        agentType: doc.agentType ?? 'GENERAL',
        chunkIndex: idx,
        isActive: doc.isActive,
        version: doc.version,
      })),
    });

    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        syncStatus: KnowledgeSyncStatus.SYNCED,
        syncError: null,
        vectorId: `${doc.id}:*`,
      },
    });

    this.logger.log(
      `Documento ${documentId} reindexado (${chunks.length} chunks)`,
    );
    return chunks.length;
  }

  /**
   * Reintento manual del botón "reintentar" del panel, para un documento que
   * quedó en `REINDEX_FAILED`.
   */
  async requestReindex(id: string, autorId: string) {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.assertPuedeEscribir(autorId, doc.agentType);

    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        syncStatus: KnowledgeSyncStatus.PENDING_REINDEX,
        syncError: null,
      },
    });
    await this.reindexQueue.add(
      'reindex-document',
      { documentId: id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    );

    return { id, syncStatus: KnowledgeSyncStatus.PENDING_REINDEX };
  }

  /** Marca un documento como no reindexable tras agotar los reintentos. */
  async markReindexFailed(documentId: string, reason: string) {
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        syncStatus: KnowledgeSyncStatus.REINDEX_FAILED,
        syncError: reason.slice(0, 500),
      },
    });
  }

  /** Actualiza metadata de todos los chunks de un documento, preservando el resto. */
  private async updateChunkMetadata(
    documentId: string,
    // Chroma solo admite escalares en la metadata; tiparlo así evita mandarle
    // un objeto anidado que rompería recién en runtime.
    patch: ChunkMetadata,
  ) {
    const res = (await this.collection.get({
      where: { documentId },
      include: ['metadatas'] as never,
    })) as { ids: string[]; metadatas: (ChunkMetadata | null)[] };

    const ids = res.ids ?? [];
    if (ids.length === 0) return;

    await this.collection.update({
      ids,
      // Se hace merge y no reemplazo: pisar la metadata entera borraría
      // `audience` y `agentType`, que son el filtro de confidencialidad.
      metadatas: (res.metadatas ?? []).map((m) => ({ ...(m ?? {}), ...patch })),
    });
  }
}
