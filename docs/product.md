# Sistema TrimIA
Una plataforma de Inteligencia Artificial basada en un ecosistema de agentes inteligentes especializados en procesos comunes dentro de empresas comerciales, orientada a centralizar el conocimiento organizacional, asistir a los empleados durante la ejecución de tareas y automatizar procesos de capacitación, seguimiento comercial y gestión de cobranzas. Los usuarios podrán interactuar con la plataforma mediante una interfaz web propia y a través de canales de mensajería instantánea como WhatsApp,  permitiendo realizar consultas operativas en tiempo real. La plataforma funcionará mediante un agente orquestador central encargado de identificar la naturaleza de cada interacción y derivarla automáticamente al agente especializado  correspondiente. Entre ellos se encontrarán agentes orientados a ventas, cobranzas, depósito, logística y consultas administrativas. Además, el sistema incorporará mecanismos inteligentes de gestión y delegación de consultas, permitiendo que aquellas situaciones que no puedan resolverse automáticamente sean derivadas al responsable más adecuado según el tipo de problema y el área involucrada, evitando que todas las consultas recaigan exclusivamente sobre supervisores generales. 
En el área comercial, el sistema incorporará agentes de ventas capaces de responder 
consultas frecuentes sobre productos y promociones, registrar información de prospectos y 
realizar seguimientos persistentes sobre clientes que inicialmente no concretaron una compra. 
Asimismo, la plataforma podrá registrar información comercial y almacenar historiales de 
interacción mediante integraciones parciales y controladas con sistemas CRM, permitiendo 
centralizar el seguimiento de oportunidades comerciales. Sin embargo, el cierre final de la 
venta y la negociación comercial continuarán siendo responsabilidad del personal humano de 
la empresa, ya que dichas instancias requieren criterio comercial, interpretación contextual y 
toma de decisiones particulares. En paralelo, la plataforma integrará agentes especializados 
en gestión de cobranzas orientados a automatizar recordatorios de pagos, seguimiento de 
cuotas y comunicaciones con clientes que posean cuentas corrientes o ventas financiadas 
pudiendo gestionar interacciones mediante WhatsApp, manteniendo un seguimiento 
constante sobre vencimientos y estados de pago. 
La arquitectura del sistema estará basada en un enfoque de Generación Aumentada por 
Recuperación (RAG), utilizando como fuente principal la base de conocimiento propia de la 
organización. Los supervisores y responsables de área podrán cargar documentación, 
manuales, protocolos, procedimientos, audios y material operativo mediante una interfaz de 
administración intuitiva. A partir de esta información, la plataforma construirá una base de 
conocimiento dinámica capaz de brindar respuestas contextualizadas, asistencia paso a paso 
y módulos de capacitación continua organizados según puestos de trabajo, procesos y niveles 
de complejidad. Asimismo, las consultas no resueltas, junto con sus respuestas posteriores,                                                                               
quedarán registradas automáticamente para retroalimentar la base de conocimiento y evitar 
futuras repeticiones del mismo problema. 
La plataforma realizará integraciones parciales y controladas con algunos sistemas utilizados 
actualmente por la organización, funcionando como una capa complementaria de asistencia 
operativa. En particular, el sistema podrá integrarse superficialmente con Paljet para consultar 
información vinculada al stock disponible de mercadería y tiempos estimados de entrega de 
pedidos, con Riesgo Online para verificar el estado crediticio y nivel de endeudamiento de 
clientes candidatos a ventas financiadas, y con el CRM para registrar potenciales clientes, 
almacenar seguimientos comerciales y consultar información básica necesaria para la 
operación de los agentes de ventas. Estas integraciones tendrán como objetivo automatizar 
verificaciones y consultas que actualmente se realizan de forma manual durante el proceso 
comercial, reduciendo tiempos operativos, interrupciones y carga administrativa sobre 
vendedores y supervisores. 
Sin embargo, la plataforma no se integrará de manera profunda con los sistemas 
transaccionales críticos de la organización ni modificará directamente su lógica interna de 
negocio. La solución no ejecutará operaciones financieras, actualización de stock, facturación 
ni modificaciones estructurales sobre los sistemas existentes, manteniendo una arquitectura 
desacoplada enfocada principalmente en la asistencia inteligente, automatización de 
consultas y soporte operativo contextualizado.

## Capas del sistema

1. Capa de Comunicación e Integración (Las Fronteras)
Esta capa maneja la entrada y salida de datos hacia el mundo exterior.
WhatsApp Business API: El canal oficial y principal donde los clientes y operarios interactúan con el sistema.
n8n: El enrutador de telecomunicaciones. Recibe los webhooks de WhatsApp, limpia la información (extrayendo números y texto) y los envía al backend. También recibe la respuesta del backend y la formatea de vuelta para WhatsApp.
Frontend (ReactJS)

2. Capa de Lógica de Negocio y Orquestación (El Cerebro)
El núcleo del sistema donde reside la inteligencia y el control de concurrencia.
NestJS (TypeScript): El framework principal del backend. Proporciona una arquitectura modular, estricta y orientada a objetos (inyección de dependencias) para exponer la API.
Redis (+ BullMQ): El sistema de colas. Atrapa los mensajes entrantes de n8n instantáneamente para evitar saturar el servidor, permitiendo procesar las respuestas de la IA en segundo plano sin perder el hilo.
LangGraph.js & LangChain.js: El motor de razonamiento. Define el "Agente Administrador" y los subagentes especializados (Ventas, Cobranzas, Logística) mediante grafos de estado cíclicos.
Gemini API (Google AI Studio): El Modelo de Lenguaje Grande (LLM) que dota de capacidad generativa, análisis de intención y persuasión a los agentes.

3. Capa de Datos y Conocimiento (La Memoria)
Donde el sistema busca el contexto corporativo y guarda el historial de lo sucedido.
PostgreSQL (con Prisma ORM): La base de datos relacional. Guarda el estado de las conversaciones (memoria a largo plazo de LangGraph), métricas de uso y registros transaccionales del bot.
ChromaDB / Pinecone: La base de datos vectorial. Aloja los embeddings de los manuales y procesos internos para ejecutar la arquitectura RAG (Generación Aumentada por Recuperación) sin alucinaciones.
Sistemas Externos (Paljet / Riesgo Online): APIs de terceros consultadas en modo de "solo lectura" por los agentes mediante herramientas (Tools) para verificar stock o validar créditos.

4. Capa de Administración y Gobernanza (El Panel de Control)
La interfaz humana para auditar y controlar a los agentes.
Paperclip: El entorno visual para los supervisores. Permite monitorear el gasto de tokens, leer el historial exacto de las derivaciones de LangGraph, pausar agentes o tomar el control manual del chat (Human-in-the-loop) en casos críticos.

5. Capa de Infraestructura y Despliegue (Los Cimientos)
El entorno físico y virtual donde vive todo el código.
Docker & Docker Compose: Contenedores que empaquetan NestJS, Redis, la base de datos y n8n, asegurando que funcionen idénticamente en desarrollo y en producción.
Google Cloud Platform (GCP): El proveedor de infraestructura en la nube donde se alojarán los contenedores para garantizar alta disponibilidad operativa.