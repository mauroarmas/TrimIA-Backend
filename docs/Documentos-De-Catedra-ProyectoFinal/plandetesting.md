Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
PLAN DE TESTING - SISTEMA TRIMIA - UTN FRT
Proyecto TrimIA Cliente Credimisión S.R.L.
ID de 12 Versión del 1.2
proyecto plan
Elaborado Bazán, Agustina Fecha 21/10/2026
por
Equipo Albornoz, Silvia Melisa; Armas, Tutores Chibilisco, Vicente; López,
Mauro Nahuel; Bazán, Agustina; Emmanuel
Berrondo, Milagros del Valle
1. Identificador del Plan de Testing
PT-TrimIA-2026-01
2. Introducción
Actualmente Credimisión S.R.L., empresa dedicada a la comercialización financiada de productos,
sostiene su operación diaria con el sistema de gestión Paljet (facturación, saldos, cajas y stock), un
servicio de verificación crediticia (Riesgo Online), un CRM para el seguimiento comercial y planillas de
Google Drive para el control de cobranzas. Buena parte de la comunicación operativa (consultas entre
ventas, depósito y administración, seguimiento de prospectos y recordatorios de cuotas) se resuelve en
forma manual por WhatsApp y llamadas, y depende del conocimiento de los empleados con más
experiencia. El objetivo principal del proyecto a probar es construir TrimIA, una plataforma de
inteligencia artificial basada en un ecosistema de agentes especializados que funciona como capa
complementaria de esos sistemas, sin reemplazarlos ni modificar su lógica interna, y que permite
centralizar el conocimiento operativo, asistir a empleados y clientes en tiempo real y automatizar procesos
de capacitación, seguimiento comercial y gestión de cobranzas.
Las siguientes secciones describen la naturaleza del sistema bajo prueba, los objetivos de la prueba y la
amplitud. También se provee una lista de documentos relacionados.
2.1. Naturaleza del Proyecto
TrimIA permitirá atender en forma centralizada las consultas de empleados y clientes que llegan por una
interfaz web propia y por WhatsApp Business. Un agente orquestador identifica el tipo de usuario
(empleado o cliente externo), clasifica cada consulta y la deriva a uno de cinco agentes especializados:
Ventas, Cobranzas, Administración, Depósito y Logística. Los agentes responden con la base de
conocimiento de la empresa mediante un motor de Generación Aumentada por Recuperación (RAG) y,
cuando no tienen certeza suficiente o la situación es crítica, escalan el caso a un supervisor humano a
través de la Cola de Prioridades del Panel Web de Gobernanza.
Los usuarios internos trabajan sobre dos interfaces web: el panel operativo, con vistas por rol para
cobradores, vendedores y supervisores (Ventanas 1 a 15 del documento de Análisis y Diseño), y el panel
de capacitación para supervisores y nuevos empleados (Ventanas 16 a 26). Los clientes interactúan solo
por WhatsApp.
El sistema incluye además un módulo de cobranzas (recordatorios automáticos de cuotas, recepción de
comprobantes por WhatsApp, revisión por el cobrador y verificación de impacto bancario), el flujo de
venta financiada con verificación crediticia y revisión del supervisor, el seguimiento automático de
prospectos, la administración de la base de conocimiento y un módulo de capacitación que genera
contenido a partir de entrevistas guiadas a los supervisores. Las integraciones con Paljet, Riesgo Online y
PT-TrimIA-2026-01 - Plan de Testing Página 1

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
el CRM son parciales y controladas: de solo lectura para Paljet y Riesgo Online, y de registro no
transaccional para el CRM. Para la validación académica del Producto Mínimo Viable (PMV) estas
integraciones se implementan como adaptadores simulados, reemplazables por la conexión real sin
modificar a los agentes.
La versión bajo prueba es la 1.0.0 (Release 1), que queda desplegada en el entorno de validación al
finalizar el paquete PT-4.1.1 el 27/10/2026. La Release Final del PMV, con las correcciones surgidas de
este plan, se presenta el 02/11/2026.
2.2. Objetivos y Amplitud de la Prueba del Sistema
Este plan de pruebas describe el entorno, actividades, tareas, herramientas y cronogramas para el testing
del sistema TrimIA, el cual es desarrollado por el equipo de Proyecto Final de la UTN, Facultad Regional
Tucumán para Credimisión S.R.L.
Nuestro objetivo para el testing del sistema es asegurar que:
● todas las funcionalidades requeridas (RF-01 a RF-14) están presentes y operan correctamente
de acuerdo a los requerimientos y a los casos de uso especificados;
● el software alcanza sus requerimientos de performance: el 90% de las consultas frecuentes se
responde en menos de 30 segundos y las derivaciones a responsables humanos se notifican en
menos de 2 minutos (RNF-01);
● las respuestas generadas por la IA son precisas y contextualizadas, con una tasa de respuestas
incorrectas que no supera el 5% en pruebas controladas, y el sistema deriva a una persona en
lugar de inventar una respuesta (RNF-03);
● la información sensible solo es accesible por usuarios autorizados según su rol y nunca se
expone a clientes externos (RNF-02);
● el software es confiable y robusto, y se recupera adecuadamente de fallas de los servicios
externos sin bloquear la operación (RNF-04);
● el software es fácil de usar y mantener;
● se relaciona correctamente con el software externo requerido: WhatsApp Business, Paljet,
Riesgo Online, CRM, el modelo de lenguaje Gemini y el servicio de transcripción de audio
(RI-01 a RI-04).
Un conjunto completo de pruebas será realizado, incluyendo:
● prueba funcional: con esta prueba se pretende verificar que el sistema integrado de hardware y
software cumple los requisitos especificados. El objetivo perseguido es determinar cuándo está
preparado el sistema para llevar a cabo la prueba de aceptación que se realiza en el entorno del
usuario. En la prueba de sistema se verifican los requisitos del sistema y las funciones que
realiza. Se utilizará la estrategia de Caja Negra, también denominada “conducida por los datos”
o “conducida por la entrada/salida”. Esta estrategia considera al software como una caja negra,
es decir, no considera el detalle procedimental de los programas. Se centra en buscar
situaciones donde el programa no se ajusta a su especificación, utilizando precisamente ésta
como entrada para derivar los casos de prueba. Los casos de prueba consistirán en conjuntos de
datos de entrada que deberán generar una salida en concordancia con la especificación. Las
fuentes de la especificación son la Matriz de Trazabilidad de Requisitos y los casos de uso
reales del documento de Análisis y Diseño;
● pruebas de integración: verifican el intercambio con WhatsApp Business, Paljet, Riesgo
Online y el CRM, incluyendo el comportamiento ante la falla o desconexión de cada servicio,
utilizando respuestas simuladas cuando corresponda;
PT-TrimIA-2026-01 - Plan de Testing Página 2

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
● pruebas de seguridad: inicio y cierre de sesión, permisos de acceso a módulos y
funcionalidades por rol, identificación del tipo de usuario en WhatsApp, confidencialidad de la
información crediticia e intentos de obtener información interna mediante instrucciones
maliciosas al asistente;
● pruebas de rendimiento: medición de tiempos de respuesta con consultas individuales y
simultáneas;
● pruebas de aceptación: batería controlada de preguntas frecuentes, validada con Credimisión,
para medir la precisión de las respuestas, y pruebas de usuario con empleados de la empresa en
un entorno controlado.
Las pruebas unitarias de cada agente quedan a cargo del equipo de desarrollo durante la construcción y no
forman parte de este plan.
2.3. Documentos Relacionados
Los siguientes documentos son usados como fuentes de información para el desarrollo de este Plan de
Testing:
● TrimIA - TP1 - Acta de Constitución del Proyecto.
● TrimIA - TP1 - Registro de Interesados.
● TrimIA - TP2 - Declaración del Alcance del Proyecto (T045).
● TrimIA - TP2 - Matriz de Trazabilidad de Requisitos.
● TrimIA - Diccionario de la EDT.
● TrimIA - TP3 - Cronograma del Proyecto.
● TrimIA - TP4 - Planificación Financiera.
● TrimIA - TP5 - Registro de Riesgos.
● TrimIA - TP6 - Plan de Gestión del Proyecto.
● TrimIA - TP7 - Análisis y Diseño, versión 2: modelo de dominio, diagramas y especificación
de casos de uso, mockups (Ventanas 1 a 26), especificación de requisitos de software (IEEE
830), casos de uso reales, diagramas de colaboración y modelo de base de datos.
● TrimIA - Documento de Arquitectura de Software (vistas 4+1).
Los siguientes documentos relacionados con la prueba serán preparados para el sistema:
● Casos de Prueba - TrimIA - Ciclo - N.xlsm
● Defectos - TrimIA - Ciclo - N.xlsx
● Observaciones y sugerencias - TrimIA - Ciclo - N.pdf
3. Ítems a Probar
Todos los ítems que constituyen el sistema TrimIA serán testeados durante la prueba del sistema para
asegurar que funcionan en conjunto e implementan los requerimientos del cliente. Estos ítems están
listados a continuación con su identificador y número de versión.
Estos ítems constituyen la configuración a probar para el sistema TrimIA.
Nombre Identificador Número de Versión
Panel operativo y de gobernanza Frontend-App - Google Cloud Run 1.0.0
(interfaz web, Ventanas 1 a 15)
PT-TrimIA-2026-01 - Plan de Testing Página 3

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
Nombre Identificador Número de Versión
Panel de capacitación (interfaz web, TrimIA Capacitación - Frontend-App 1.0.0
Ventanas 16 a 26)
API del backend (NestJS) Backend-App - Google Cloud Run 1.0.0
Orquestador y agentes especializados Módulo de orquestación del 1.0.0
(LangGraph.js) Backend-App
Motor RAG y base de conocimiento ChromaDB - Google Cloud Run 1.0.0
vectorial
Flujos de mensajería de WhatsApp n8n - Google Cloud Run + WhatsApp 1.0.0
Business Platform (Meta)
Base de datos transaccional Cloud SQL PostgreSQL (esquema 1.0.0
Prisma)
Colas de mensajes Memorystore for Redis + BullMQ 1.0.0
Conectores de Paljet, Riesgo Online y Adaptadores simulados del Backend-App 1.0.0
CRM
Transcripción de audio Google Speech-to-Text V2 Servicio gestionado
Las direcciones de acceso del entorno de validación se comunican a la responsable de las pruebas al
finalizar el despliegue (paquete PT-4.1.1) y se registran en la carpeta de pruebas del proyecto.
4. Características a ser Probadas
A continuación se listan las características a ser probadas, agrupadas por módulo. Para este ciclo se
seleccionaron 101 casos de prueba, priorizados por su criticidad, con el siguiente criterio:
● al menos un caso por cada caso de uso real y por cada grupo transversal de requisitos no
funcionales y de integración. La única excepción es la consulta de documentos de la base de
conocimiento (CU-SUP-03), que no tiene un caso propio porque se recorre como paso previo
de los casos de edición de documentos (CU-SUP-04), que abren cada documento desde esa
lista;
● los cursos alternos que protegen la seguridad de la información: autenticación, permisos por rol,
separación entre clientes y empleados, información interna y resistencia a instrucciones
maliciosas;
● los cursos alternos ante fallas de las integraciones (Paljet, Riesgo Online, CRM y WhatsApp
Business) y ante plantillas no aprobadas por Meta;
● los valores límite y las validaciones de datos de mayor impacto (duración del audio, DNI, días
de anticipación de los recordatorios y tipos de archivo);
● los casos con evidencia en las capturas del documento Análisis y Diseño V2 y los vinculados a
defectos registrados.
Los cursos alternos de menor riesgo (filtros, búsquedas, mensajes de lista vacía y acciones secundarias)
quedan fuera de este ciclo y podrán incorporarse en la regresión de la Release Final. El detalle de cada
caso se encuentra en el archivo Casos de Prueba - TrimIA - Ciclo - 1.xlsm. Por brevedad, en las tablas se
omite el prefijo “TC-TRIMIA-” de cada identificador.
PT-TrimIA-2026-01 - Plan de Testing Página 4

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
Módulo Autenticación y administración:
| Caso de uso / requisito  |     |     | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | --- | --- | ------------------------- | ------ |
CU-AUTH-01 - Iniciar sesión  No  RF12-01,  RNF02-01,  RNF02-02,  4
aplica  RNF02-03
| CU-AUTH-02 - Cerrar sesión  |     |     | 1  RNF02-04  | 1   |
| --------------------------- | --- | --- | ------------ | --- |
CU-GER-01 - Gestionar empleados y  No  RF12-02, RF12-03, RF12-04  3
| sectores  |     |     | aplica  |     |
| --------- | --- | --- | ------- | --- |

Módulo Asistente conversacional:
| Caso de uso / requisito  |     |     | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | --- | --- | ------------------------- | ------ |
CU-GEN-01 - Consultar al asistente  8  RF01-01, RF01-02, RF07-01, RF07-02  4
(web)
CU-GEN-02 - Consultar al asistente  No  RF08-01, RF12-05, RF13-01  3
| por WhatsApp  |     |     | aplica  |     |
| ------------- | --- | --- | ------- | --- |
CU-GEN-03  -  Identificar  tipo  de  No  RF12-06, RF12-07  2
| usuario    |                |             | aplica       |     |
| ---------- | -------------- | ----------- | ------------ | --- |
| CU-GEN-04  | -  Clasificar  | y  derivar  | No  RF02-01  | 1   |
| consulta   |                |             | aplica       |     |
CU-GEN-05  -  Enviar  consulta  por  No  RF14-01, RF14-02, RF14-03  3
| audio  |     |     | aplica  |     |
| ------ | --- | --- | ------- | --- |
CU-GEN-06  -  Escalar  consulta  a  No  RNF03-01, RNF03-02  2
| supervisor  |     |     | aplica  |     |
| ----------- | --- | --- | ------- | --- |

Módulo Ventas y venta financiada:
| Caso de uso / requisito  |               |           | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | ------------- | --------- | ------------------------- | ------ |
| CU-VEN-01                | -  Contactar  | clientes  | 9  RF03-01                | 1      |
derivados por el asistente
CU-VEN-02 - Consultar stock  10  RF09-01, RF09-02, RI01-01  3
| CU-VEN-03                         | -  Solicitar  | venta  | No  RF13-02, RI03-01  | 2   |
| --------------------------------- | ------------- | ------ | --------------------- | --- |
| financiada                        |               |        | aplica                |     |
| CU-VEN-04 - Realizar seguimiento  |               |        | No  RI04-01           | 1   |
| automático de prospectos          |               |        | aplica                |     |
CU-ADM-01  -  Verificar  situación  No  RF10-01, RF10-02, RF10-03  3
| crediticia  |     |     | aplica  |     |
| ----------- | --- | --- | ------- | --- |

Módulo Supervisión y base de conocimiento:
| Caso de uso / requisito  |     |     | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | --- | --- | ------------------------- | ------ |
CU-SUP-01 - Ver casos escalados  11  RNF03-03, RNF02-05, RNF01-01  3
CU-SUP-02  -  Resolver  casos  12  RF13-03, RF06-01, RNF03-04  3
escalados
CU-SUP-03 - Consultar documentos  13  Sin caso propio: se recorre en los casos de  0
de la base de conocimiento  CU-SUP-04
| PT-TrimIA-2026-01 - Plan de Testing  |     |     |     | Página 5  |
| ------------------------------------ | --- | --- | --- | --------- |

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
| Caso de uso / requisito  |     |     | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | --- | --- | ------------------------- | ------ |
CU-SUP-04  -  Gestionar documento  14  RF06-02, RNF02-06, RF06-03, RF12-08  4
de la base de conocimiento
CU-SUP-05 - Subir archivo a la base  15  RF06-04, RF06-05  2
de conocimiento
CU-SUP-06  -  Revisar  solicitud  de  No  RF13-04, RF13-05, RF13-06  3
| venta financiada                   |     |     | aplica        |     |
| ---------------------------------- | --- | --- | ------------- | --- |
| CU-SUP-07 - Consultar métricas de  |     |     | No  RNF02-07  | 1   |
| gobernanza                         |     |     | aplica        |     |

Módulo Cobranzas:
| Caso de uso / requisito  |               |        | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | ------------- | ------ | ------------------------- | ------ |
| CU-COB-01                | -  Consultar  | panel  | de  1  RF04-01            | 1      |
cobranzas
| CU-COB-02  | -   | Gestionar  | 2  RF04-02, RF04-03, RF04-04  | 3   |
| ---------- | --- | ---------- | ----------------------------- | --- |
comprobantes de pago
CU-COB-03  -  Consultar  clientes  3  RF04-05, RF04-06, RF04-07  3
asignados
CU-COB-04  - Gestionar cuotas del  4  RF04-08,  RF04-09,  RF04-10,  RF04-11,  5
cliente  RI04-02
| CU-COB-05  | -   | Consultar  | 5  RF04-12  | 1   |
| ---------- | --- | ---------- | ----------- | --- |
recordatorios enviados
| CU-COB-06 - Consultar registro de  |     |     | 6  RF04-13  | 1   |
| ---------------------------------- | --- | --- | ----------- | --- |
actividad
| CU-COB-07  | -  Verificar  | impacto  | 7  RF04-14, RNF02-08  | 2   |
| ---------- | ------------- | -------- | --------------------- | --- |
bancario
CU-COB-08  -  Enviar  recordatorios  No  RF04-15, RF04-16, RI04-03  3
| de cuotas      |                        |             | aplica                          |     |
| -------------- | ---------------------- | ----------- | ------------------------------- | --- |
| CU-COB-09      | - Recibir comprobante  |             | No  RF04-17, RF04-18            | 2   |
| de pago        |                        |             | aplica                          |     |
| CU-COB-10      | -                      | Configurar  | No  RF04-19, RF04-20, RNF02-09  | 3   |
| recordatorios  |                        |             | aplica                          |     |

Módulo Capacitación:
| Caso de uso / requisito  |             |         | Ventana  Casos de prueba  | Cant.  |
| ------------------------ | ----------- | ------- | ------------------------- | ------ |
| CU-CAP-01                | -  Definir  | puesto  | de  16  RF05-01           | 1      |
trabajo
| CU-CAP-02 - Realizar entrevista     |     |     | 17  RF11-01, RF11-02  | 2   |
| ----------------------------------- | --- | --- | --------------------- | --- |
| CU-CAP-03 - Revisar píldoras        |     |     | 18  RF11-03           | 1   |
| CU-CAP-04 - Configurar publicación  |     |     | 19  RF05-02, RF11-04  | 2   |
| CU-CAP-05 - Ver introducción a la   |     |     | 20  RF05-03, RF05-04  | 2   |
organización
| CU-CAP-06 - Escuchar lección         |     |     | 21  RF05-05           | 1         |
| ------------------------------------ | --- | --- | --------------------- | --------- |
| CU-CAP-07 - Ver módulo teórico       |     |     | 22  RF05-06, RF05-07  | 2         |
| PT-TrimIA-2026-01 - Plan de Testing  |     |     |                       | Página 6  |

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
| Caso de uso / requisito  |     | Ventana  | Casos de prueba  | Cant.  |
| ------------------------ | --- | -------- | ---------------- | ------ |
CU-CAP-08  -  Escuchar  píldora  de  23  RF05-08, RF05-09  2
audio
| CU-CAP-09  | -  Realizar  | módulo  24  | RF05-10  | 1   |
| ---------- | ------------ | ----------- | -------- | --- |
práctico
| CU-CAP-10 - Realizar simulación  |     | 25  | RF05-11  | 1   |
| -------------------------------- | --- | --- | -------- | --- |
| CU-CAP-11 - Obtener feedback     |     | 26  | RF05-12  | 1   |

Requisitos no funcionales y de integración (transversales):
| Caso de uso / requisito       |     | Ventana  | Casos de prueba     | Cant.  |
| ----------------------------- | --- | -------- | ------------------- | ------ |
| RNF-01 - Tiempo de respuesta  |     | No       | RNF01-02, RNF01-03  | 2      |
aplica
RNF-02  -  Control  de  acceso  y  No  RNF02-10, RNF02-11, RNF02-12  3
confidencialidad  aplica
| RNF-03 - Precisión de respuestas  |     | No  | RNF03-05  | 1   |
| --------------------------------- | --- | --- | --------- | --- |
aplica
RNF-04 - Arquitectura desacoplada  No  RNF04-01, RNF04-02  2
aplica
RI-01  /  RI-02  -  Integraciones  con  No  RI01-02, RI02-01, RI01-03  3
Paljet y Riesgo Online  aplica
| RI-03  /  RI-04  | -  Integraciones  | con  No  | RI03-02  | 1   |
| ---------------- | ----------------- | -------- | -------- | --- |
CRM y WhatsApp Business  aplica

En total se diseñaron 101 casos de prueba sobre 42 casos de uso y 6 grupos transversales: 64 funcionales,
22 de seguridad, 12 de integración y 3 de rendimiento. Todos los requisitos de la Matriz de Trazabilidad
quedan cubiertos por al menos un caso (Anexo A).
El identificador de cada caso de prueba se arma con el requisito principal que prueba y un número
correlativo (por ejemplo, TC-TRIMIA-RF04-01 es el primer caso de RF-04). Además, cada caso indica
en su objetivo todos los requisitos que prueba, con la identificación de la Especificación de Requisitos de
Software (por ejemplo, “Prueba RF-04, RI-04: Aceptar un comprobante de pago pendiente”), y la hoja de
registro del archivo de casos incluye la columna “Requisitos cubiertos”. Los procedimientos usan los
nombres reales de pestañas, botones y mensajes de las ventanas del prototipo, y los datos de prueba de
esas ventanas (Anexo B).
Características que no serán probadas:
De acuerdo con la Declaración del Alcance, las siguientes características están fuera del alcance del
producto o no pueden verificarse en este ciclo, y por lo tanto no se prueban:
●  actualización de stock, facturación, pagos, débitos u otras operaciones financieras, que el
sistema no realiza;
●  cierre de ventas y negociación comercial, que siguen a cargo del personal de Credimisión;
●  consultas de estado de pedidos y fechas estimadas de llegada de mercadería;
●  integración real con los sistemas productivos de Paljet, Riesgo Online y el CRM (se prueban los
adaptadores simulados);
| PT-TrimIA-2026-01 - Plan de Testing  |     |     |     | Página 7  |
| ------------------------------------ | --- | --- | --- | --------- |

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
● disponibilidad superior al 99% del canal de WhatsApp en horario hábil (RF-08 y RI-04), que
requiere operación prolongada y se monitorea durante el grupo piloto;
● funciones visibles en las ventanas que no están especificadas en ningún caso de uso (“Editar
con la IA” y “Limpiar base de conocimiento”); se informan en Observaciones y sugerencias
para que se documenten antes de probarlas;
● pruebas unitarias del código de cada agente, que realiza el equipo de desarrollo.
5. Aproximación
De acuerdo con el Diccionario de la EDT, las pruebas forman parte del paquete de trabajo PT-4.1.2
“Pruebas funcionales y de integración”, cuya responsable es Agustina Bazán. Ella diseña y ejecuta los
casos de prueba, registra los resultados y los defectos, y elabora el informe. Cada defecto se asigna para
su corrección al responsable del paquete de la EDT que construyó la parte afectada.
5.1. Fuentes de Datos de Ejemplos del Dominio
Para realizar las pruebas con datos del dominio del sistema, se requerirá el asesoramiento de Credimisión
S.R.L. (su socio, Diego Alejandro Bazán, y los supervisores de ventas y cobranzas), que proveerán
ejemplos reales de consultas frecuentes, la lista de productos y promociones, la tabla de financiación
vigente y los procedimientos internos, y validarán la batería de preguntas con su respuesta esperada que
se usa para medir la precisión del asistente.
No se utilizarán datos personales reales de clientes (Ley 25.326 de Protección de los Datos Personales).
Los adaptadores simulados de Paljet, Riesgo Online y el CRM se cargan con los datos ficticios descriptos
en el Anexo B.
5.2. Personal
Según el Diccionario de la EDT, una persona del equipo, Agustina Bazán, responsable del paquete
PT-4.1.2, será la encargada del diseño de los casos de prueba, la ejecución de las pruebas y la registración
de los resultados. Será supervisada por los tutores de la cátedra, Vicente Chibilisco y Emmanuel López.
Integrante Rol en el proyecto Responsabilidad en las pruebas
Bazán, Agustina Analista y Directora del Responsable del paquete PT-4.1.2 y única tester.
proyecto Diseño de casos, ejecución, registro de resultados
y defectos, e informe de resultados.
Armas, Mauro Nahuel Programador Responsable del paquete PT-4.1.1. Despliegue,
cuentas, permisos y soporte del entorno de
validación.
Credimisión S.R.L. Cliente Provisión de datos del dominio y validación de las
pruebas de aceptación.
5.3. Registro
Todos los eventos observados durante la ejecución serán guardados en el registro de cada caso de prueba
(campos “Resultados obtenidos” y “Observaciones” del archivo de casos de prueba) junto con su
evidencia: capturas de pantalla del panel, capturas o exportaciones de las conversaciones de WhatsApp y
extractos de los registros de Google Cloud Logging. Los archivos relativos a las pruebas serán ubicados
en la carpeta TrimIA_TEST del repositorio del proyecto. Todas las fallas tendrán asignado un nivel de
severidad y serán registradas en un reporte de incidente/problema. Todos los defectos encontrados durante
la prueba del sistema serán registrados en el archivo de defectos del ciclo. La productividad del tester será
PT-TrimIA-2026-01 - Plan de Testing Página 8

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
monitoreada usando una medida de número de casos de prueba construidos por semana y el número de
casos de prueba ejecutados por semana.
5.4. Estado de la Prueba e Indicadores
La prueba del sistema será seguida con una revisión diaria breve durante la ejecución y con una reunión al
cierre de cada ciclo, dentro de las reuniones de seguimiento del proyecto. El número de requisitos
cubiertos contra el número total de requisitos (22) será uno de los índices utilizados para seguir el
progreso de la prueba. Otros índices que se obtendrán incluirán:
● número de defectos de cada nivel de severidad encontrados por día y por ciclo;
● cantidad de ciclos de prueba realizados;
● cantidad de casos de prueba elaborados y ejecutados por semana, y porcentaje de casos
aprobados;
● tasa de respuestas incorrectas del asistente en la batería controlada (meta: 5% o menos);
● porcentaje de consultas respondidas en menos de 30 segundos (meta: 90% o más).
5.5. Herramientas de Testing
Al realizarse pruebas funcionales manuales, no se utilizarán herramientas específicas de automatización
de testing. Se usarán utilitarios para documentar los casos de prueba, sus resultados y el registro de
defectos (planillas de la cátedra), Google Chrome para el panel web, teléfonos con WhatsApp para los
números de prueba, Google Cloud Logging para obtener las marcas de tiempo de los mensajes al medir
tiempos de respuesta y el registro de operaciones de los adaptadores simulados. Se utilizará el repositorio
Git del proyecto para versionar la documentación utilizada.
5.6. Técnicas de Diseño de Casos de Prueba
Los casos de prueba se derivaron con técnicas de caja negra:
● casos de uso: un caso por el curso normal de cada caso de uso real y casos para sus cursos
alternos más críticos;
● partición de equivalencias: clases válidas e inválidas de perfiles de usuario, tipo de remitente
en WhatsApp (empleado activo, cliente, empleado inactivo), área de la consulta, formato de
archivo y estado de cuotas y comprobantes;
● valores límite: duración de audio (75 segundos, por encima del máximo de 60), días de
anticipación de los recordatorios (-1, 0, 30 y 31), monto de comprobante igual a cero, stock
igual a cero y DNI de 7 y 8 dígitos;
● revisión (prueba estática): revisión de las 26 ventanas del prototipo y del documento de
Análisis y Diseño V2; sus hallazgos se informan en Observaciones y sugerencias - TrimIA -
Ciclo - 1;
● criterios de aceptación: los criterios de la Matriz de Trazabilidad que no surgen de un caso de
uso, como el historial compartido entre canales (RF-07) o la información mínima de las cuotas
(RF-04).
Como las respuestas del asistente las genera un modelo de lenguaje y pueden variar en su redacción, un
caso con respuesta de la IA se considera aprobado cuando cumple el criterio esperado (contenido correcto
según la base de conocimiento, agente que responde y tiempo de respuesta), no cuando repite un texto
literal.
PT-TrimIA-2026-01 - Plan de Testing Página 9

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
5.7. Criterio de Terminación de la Prueba
La decisión de terminar la prueba del sistema estará basada en 1 la cobertura de todos los requerimientos,
y 2 el número de reportes de incidentes o problemas abiertos. Consideraremos que la prueba del sistema
estará completada cuando todos los requerimientos hayan sido cubiertos con al menos un caso de prueba
ejecutado, y no haya reportes de problemas o incidentes asociados con defectos de nivel 1 a 3 (impacto
crítico a medio). Aceptaremos el riesgo de que el software aún contenga defectos de bajo nivel de
severidad que tendrán un efecto mínimo en los usuarios.
6. Criterio de Aprobación
Los niveles de severidad para los defectos se distribuyen en una escala de niveles, la cual se extiende de
valores de 1 a 4, donde 1 es una falta que tiene un efecto crítico en el sistema o el usuario, y 4 indica un
efecto bajo sobre el sistema o el usuario.
Nivel Severidad Ejemplos en TrimIA
1 Crítico Se expone información crediticia o interna a un cliente; el canal de WhatsApp
deja de responder; un usuario accede sin autenticarse.
2 Alto Las consultas se derivan sistemáticamente a un agente equivocado; se envía un
recordatorio por una cuota ya pagada; no se escala un caso crítico.
3 Medio Un filtro o un contador del panel no funciona; un mensaje de error es confuso;
una validación de datos falta.
4 Bajo Formatos de fecha inconsistentes, textos de estado en inglés u otros defectos de
presentación.
Para este sistema en cuestión, una prueba será considerada como aprobada si la falta observada es
clasificada en un nivel de 3 o 4. Eso significa que esa prueba puede continuar; sin embargo, todas las
faltas y defectos asociados deben ser registrados y tratados. Los reportes de incidentes de la prueba y los
reportes de problema/defecto deben ser terminados para todas las fallas observadas. Todas las fallas se
deben remitir a desarrollo y priorizarlas para su subsecuente reparación, seguido por la prueba de
regresión que realiza la responsable de las pruebas.
7. Criterio de Suspensión / Recomienzo
Normalmente la prueba se suspenderá al final del día. Todos los documentos relacionados con la prueba
deben ser guardados en la carpeta TrimIA_TEST del repositorio del proyecto. Las pruebas se
recomenzarán al comienzo del día siguiente. Además, las pruebas se suspenderán en los siguientes casos:
1. una falla de nivel 1 o 2 de severidad es observada;
2. ocurre una falla en el entorno de validación (Google Cloud Run, base de datos o colas);
3. ocurre una falla de hardware;
4. un servicio externo del que depende la prueba no está disponible: la API de Gemini (por
ejemplo, por agotar la cuota del plan gratuito o de bajo costo), WhatsApp Business o el
servicio de transcripción.
Cuando el defecto causante de la falla del software es reparado, se ejecutará una prueba de regresión a la
nueva versión del software. Si la nueva versión pasa la prueba de regresión, entonces la prueba normal
puede ser recomenzada.
Si durante las pruebas del sistema hay una falla de hardware, de entorno o de un servicio externo, la tester
notificará al responsable del entorno (Mauro Armas) y recomenzará las pruebas cuando las reparaciones
hayan sido hechas, arrancando desde el principio el caso de prueba que estaba en ejecución.
PT-TrimIA-2026-01 - Plan de Testing Página 10

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
8. Entregables de la Prueba
Los siguientes ítems serán generados por la responsable de las pruebas (PT-4.1.2) para este proyecto:
● Plan de Testing del sistema: este documento, que describe el alcance, acercamiento, recursos y
cronograma de las actividades de la prueba prevista.
● Especificaciones de casos de prueba del sistema: archivo Casos de Prueba - TrimIA - Ciclo -
N, que muestra entradas, resultados previstos y un conjunto de condiciones de ejecución para
cada ítem de la prueba.
● Especificaciones de procesos de prueba del sistema: el procedimiento de cada caso de
prueba, que exhibe la secuencia de acciones para su ejecución.
● Registro de las pruebas del sistema: listado cronológico de detalles relevantes sobre la
ejecución de las pruebas (hoja de registro de cada ciclo y evidencias).
● Reporte de incidentes de pruebas del sistema: archivo Defectos - TrimIA - Ciclo - N, que
reporta cualquier acontecimiento ocurrido durante la prueba que requiera una investigación.
● Observaciones y sugerencias: documento por ciclo con mejoras que no constituyen defectos.
● Reporte general de pruebas del sistema: documento que sintetiza las actividades y los
resultados de la prueba (informe de pruebas funcionales y de integración del paquete PT-4.1.2).
9. Tareas de Testing
El listado de tareas de la prueba fue preparado desarrollando una estructura para las tareas relacionadas
con las pruebas requeridas por el proyecto TrimIA, en concordancia con el paquete de trabajo PT-4.1.2
“Pruebas funcionales y de integración” del Diccionario de la EDT. La lista enumera cada tarea de la
prueba, sus tareas precedentes, habilidades especiales necesarias para realizarla, la persona responsable, el
esfuerzo requerido y la fecha de terminación.
N° Tarea Precede Habilidades Responsable Esfuerz Fin
o
1 Preparación de las PT-4.1.1 Análisis de Bazán 3 h 28/10/2026
especificaciones de prueba requisitos
(Plan de Testing)
2 Revisión de las interfaces del 1 Usabilidad y Bazán 3 h 28/10/2026
prototipo y del Análisis y análisis
Diseño V2 (observaciones y
sugerencias)
3 Entrevista con Credimisión 1 Relevamiento Bazán 1 h 28/10/2026
para obtener ejemplos y
datos (batería de preguntas,
tabla de financiación)
4 Diseño de casos de prueba 1, 2, 3 Técnicas de Bazán 5 h 29/10/2026
caja negra
5 Ejecución del Ciclo 1 y 4 Uso del Bazán 10 h 30/10/2026
registro de resultados sistema
6 Registro y priorización de 5 Análisis de Bazán 2 h 30/10/2026
defectos fallas
7 Ejecución del Ciclo 2 6 Uso del Bazán 4 h 03/11/2026
(regresión y casos sistema
pendientes) sobre la Release
Final
PT-TrimIA-2026-01 - Plan de Testing Página 11

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
| N°  Tarea  |     | Precede  Habilidades  | Responsable  | Esfuerz Fin  |
| ---------- | --- | --------------------- | ------------ | ------------ |
o
8  Comunicación  de  los  7  Redacción  Bazán  2 h  03/11/2026
| resultados   | a  las  áreas  | técnica  |     |     |
| ------------ | -------------- | -------- | --- | --- |
| interesadas  | (informe,      |          |     |     |
observaciones y sugerencias)

Las ocho tareas suman las 30 horas del paquete PT-4.1.2, que según el Diccionario de la EDT se realiza
entre el 28/10 y el 03/11/2026 y está a cargo de Agustina Bazán. El despliegue y la preparación del
ambiente (usuarios, datos simulados y números de WhatsApp) corresponden al paquete PT-4.1.1, a cargo
de Mauro Armas, que finaliza el 27/10/2026. La corrección de los defectos entre ciclos (30/10 al 02/11) la
realiza el responsable del paquete que construyó cada parte afectada.
10. Entorno de la Prueba
El sistema en cuestión está basado en una arquitectura cliente-servidor por capas (Comunicación, Lógica,
Datos, Administración e Infraestructura). El backend está desarrollado en NestJS (Node.js/TypeScript); la
orquestación de agentes utiliza LangChain.js y LangGraph.js con el modelo Gemini; la persistencia
transaccional  se  realiza  en  PostgreSQL  mediante  Prisma  y  la  base  de  conocimiento  vectorial en
ChromaDB. Los mensajes de WhatsApp se reciben y envían a través de n8n y la API de WhatsApp
Business, con colas asíncronas en Redis y BullMQ. Todos los componentes se ejecutan en contenedores
Docker sobre Google Cloud Platform.
La prueba se desarrollará en el ambiente de validación académica controlada (sin operación comercial
real):
Back End
| Backend y orquestador:  |     | Google Cloud Run (Backend-App)  |     |     |
| ----------------------- | --- | ------------------------------- | --- | --- |
| Modelo de lenguaje:     |     | Gemini API (Google AI Studio)   |     |     |
| Base de datos:          |     | Cloud SQL (PostgreSQL)          |     |     |
| Base vectorial:         |     | ChromaDB en Google Cloud Run    |     |     |
| Colas de mensajes:      |     | Memorystore for Redis (BullMQ)  |     |     |
Mensajería:  n8n en Google Cloud Run + WhatsApp Business Platform (Meta)
| Transcripción de audio:   |     | Google Speech-to-Text V2            |     |     |
| ------------------------- | --- | ----------------------------------- | --- | --- |
| Credenciales e imágenes:  |     | Secret Manager y Artifact Registry  |     |     |
Sistemas externos:  Adaptadores simulados de Paljet, Riesgo Online y CRM

Front End
Panel web:  Google  Cloud  Run  (Frontend-App),  accedido  con  Google
Chrome (versión estable vigente)
| Estación de trabajo:  |     | notebook de la responsable de las pruebas  |     |     |
| --------------------- | --- | ------------------------------------------ | --- | --- |
Dispositivos móviles:  teléfonos con WhatsApp para los números de prueba del Anexo
B

11. Cronogramas
A continuación se detalla el cronograma de la prueba, alineado con las tareas 4.1.1 a 4.1.3 del cronograma
del proyecto y con los hitos del Acta de Constitución:
PT-TrimIA-2026-01 - Plan de Testing  Página 12

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
Actividad Inicio Fin
Despliegue y configuración en la nube y preparación del ambiente 21/10/2026 27/10/2026
(PT-4.1.1)
Release 1 - PMV (versión 1.0.0) disponible en el entorno de 27/10/2026 27/10/2026
validación
Plan de Testing, revisión de interfaces y diseño de casos de prueba 28/10/2026 29/10/2026
(PT-4.1.2)
Ciclo 1 - Ejecución sobre la versión 1.0.0 29/10/2026 30/10/2026
Corrección de defectos de nivel 1 a 3 30/10/2026 02/11/2026
Release Final - PMV 02/11/2026 02/11/2026
Ciclo 2 - Regresión y casos pendientes sobre la Release Final 03/11/2026 03/11/2026
Informe de pruebas, observaciones y sugerencias 03/11/2026 03/11/2026
Capacitación a usuarios (PT-4.1.3) y pruebas con el grupo piloto 11/11/2026 17/11/2026
PT-TrimIA-2026-01 - Plan de Testing Página 13

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
Anexo A. Matriz de cobertura de requisitos
Para cada requisito de la Matriz de Trazabilidad se indican los casos de prueba que lo cubren. Por
brevedad se omite el prefijo “TC-TRIMIA-” de cada identificador.
| Requisito  | Descripción  |     | Casos de prueba  |     |     |     |     | Cant.  |
| ---------- | ------------ | --- | ---------------- | --- | --- | --- | --- | ------ |
RF-01  Consultas operativas  RF01-01,  RF01-02,  RF05-10,  RF07-02,  RF08-01,  7
RNF01-02, RNF03-01
| RF-02  | Clasificación  |     | y  RF02-01  |     |     |     |     | 1   |
| ------ | -------------- | --- | ----------- | --- | --- | --- | --- | --- |
derivación
| RF-03  | Seguimiento  |     | de  RF03-01, RI03-02, RI04-01  |     |     |     |     | 3   |
| ------ | ------------ | --- | ------------------------------ | --- | --- | --- | --- | --- |
prospectos
RF-04  Recordatorios  y  RF04-01,  RF04-02,  RF04-03,  RF04-04,  RF04-05,  22
cobranzas  RF04-06, RF04-07, RF04-08, RF04-09, RF04-10, RF04-11,
|     |     |     | RF04-12,  | RF04-13,  | RF04-14,  | RF04-15,  | RF04-16,  |     |
| --- | --- | --- | --------- | --------- | --------- | --------- | --------- | --- |
RF04-17, RF04-18, RF04-19, RF04-20, RI04-02, RI04-03
RF-05  Capacitación  de  RF05-01,  RF05-02,  RF05-03,  RF05-04,  RF05-05,  13
empleados  RF05-06, RF05-07, RF05-08, RF05-09, RF05-10, RF05-11,
RF05-12, RF11-01
RF-06  Base  de  RF06-01,  RF06-02,  RF06-03,  RF06-04,  RF06-05,  6
|        | conocimiento  |      | RNF02-06                      |     |     |     |     |     |
| ------ | ------------- | ---- | ----------------------------- | --- | --- | --- | --- | --- |
| RF-07  | Acceso        | web  | y  RF01-01, RF07-01, RF07-02  |     |     |     |     | 3   |
WhatsApp
RF-08  Atención  a  clientes  RF03-01, RF05-10, RF05-11, RF08-01  4
por WhatsApp
| RF-09  | Consulta de stock  |     | RF09-01, RF09-02, RNF01-02  |     |     |     |     | 3   |
| ------ | ------------------ | --- | --------------------------- | --- | --- | --- | --- | --- |
RF-10  Verificación  RF10-01,  RF10-02,  RF10-03,  RF13-04,  RNF01-02,  7
|     | crediticia  |     | RI01-02, RI02-01  |     |     |     |     |     |
| --- | ----------- | --- | ----------------- | --- | --- | --- | --- | --- |
RF-11  Entrevistas  y  RF05-01, RF05-02, RF05-08, RF11-01, RF11-02, RF11-03,  7
|     | módulos  |     | de  RF11-04  |     |     |     |     |     |
| --- | -------- | --- | ------------ | --- | --- | --- | --- | --- |
capacitación
RF-12  Tipo  de  usuario  y  RF05-02,  RF12-01,  RF12-02,  RF12-03,  RF12-04,  11
|     | acceso  |     | RF12-05,  | RF12-06,  | RF12-07,  | RF12-08,  | RNF02-03,  |     |
| --- | ------- | --- | --------- | --------- | --------- | --------- | ---------- | --- |
RNF02-11
RF-13  Flujo  de  venta  RF03-01,  RF13-01,  RF13-02,  RF13-03,  RF13-04,  10
|     | financiada  |     | RF13-05, RF13-06, RNF03-03, RI01-02, RI02-01  |     |     |     |     |     |
| --- | ----------- | --- | --------------------------------------------- | --- | --- | --- | --- | --- |
RF-14  Consultas por audio  RF05-05, RF05-08, RF14-01, RF14-02, RF14-03  5
RNF-01  Tiempo de respuesta  RF01-01,  RF05-11,  RF08-01,  RF09-01,  RNF01-01,  9
RNF01-02, RNF01-03, RNF03-01, RNF03-03
RNF-02  Control de acceso y  RF03-01,  RF04-01,  RF04-05,  RF04-14,  RF05-01,  31
confidencialidad  RF05-04,  RF05-06,  RF10-01,  RF12-01,  RF12-02,
|     |     |     | RF12-04,  | RF12-05,  | RF12-06,   | RF12-07,   | RF12-08,   |     |
| --- | --- | --- | --------- | --------- | ---------- | ---------- | ---------- | --- |
|     |     |     | RF13-03,  | RF13-05,  | RNF02-01,  | RNF02-02,  | RNF02-03,  |     |
RNF02-04, RNF02-05, RNF02-06, RNF02-07, RNF02-08,
RNF02-09, RNF02-10, RNF02-11, RNF02-12, RNF03-05,
RI01-03
| PT-TrimIA-2026-01 - Plan de Testing  |     |     |     |     |     |     |     | Página 14  |
| ------------------------------------ | --- | --- | --- | --- | --- | --- | --- | ---------- |

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
| Requisito  | Descripción  | Casos de prueba  |     |     |     |     | Cant.  |
| ---------- | ------------ | ---------------- | --- | --- | --- | --- | ------ |
RNF-03  Precisión  de  RF01-01,  RF01-02,  RF02-01,  RF04-07,  RF05-08,  21
respuestas  RF05-09,  RF05-12,  RF06-01,  RF06-02,  RF06-03,
|     |     | RF06-04,  | RF11-03,  | RF13-01,  | RF13-03,  | RNF01-01,  |     |
| --- | --- | --------- | --------- | --------- | --------- | ---------- | --- |
RNF02-12, RNF03-01, RNF03-02, RNF03-03, RNF03-04,
RNF03-05
RNF-04  Arquitectura  RF10-03, RNF04-01, RNF04-02, RI01-01, RI03-01  5
desacoplada
RI-01  Integración  con  RF09-01, RNF04-02, RI01-01, RI01-02, RI01-03  5
Paljet
RI-02  Integración  con  RF10-01,  RF10-02,  RF10-03,  RNF02-10,  RNF04-02,  6
|        | Riesgo Online  | RI02-01                |     |     |     |     |     |
| ------ | -------------- | ---------------------- | --- | --- | --- | --- | --- |
| RI-03  | Integración    | con  RI03-01, RI03-02  |     |     |     |     | 2   |
CRM
RI-04  Integración  con  RF04-02,  RF04-08,  RF04-12,  RF04-13,  RF04-15,  10
|     | WhatsApp Business  | RF04-17, RF08-01, RI04-01, RI04-02, RI04-03  |     |     |     |     |     |
| --- | ------------------ | -------------------------------------------- | --- | --- | --- | --- | --- |

| PT-TrimIA-2026-01 - Plan de Testing  |     |     |     |     |     |     | Página 15  |
| ------------------------------------ | --- | --- | --- | --- | --- | --- | ---------- |

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
Anexo B. Perfiles y datos de prueba
Los casos de prueba utilizan los siguientes usuarios, números de teléfono y datos. Los usuarios, clientes,
productos y documentos provienen de las ventanas del prototipo del documento de Análisis y Diseño V2.
Los marcados “a crear” no figuran en el prototipo y se cargan al preparar el ambiente, y los correos de
Laura Gómez y Sofía Ramírez, que no se ven en las ventanas, se confirman en esa misma tarea.
| Perfil  | Usuario o dato de prueba  |     |     | Uso  |
| ------- | ------------------------- | --- | --- | ---- |
Gerente  gerente.prueba@credimision.com  (a  Gestión  de  empleados,  métricas  y
|     | crear)  |     |     | clasificación de consultas (acceso a todos  |
| --- | ------- | --- | --- | ------------------------------------------- |
los agentes).
Supervisor de Ventas  diego.bazan@credimision.com  -  Casos escalados, base de conocimiento,
|     | SUPERVISOR (Ventas)  |     |     | ventas financiadas y capacitación.  |
| --- | -------------------- | --- | --- | ----------------------------------- |
Supervisora  de  silvia.rios@credimision.com  -  Documentos  de  solo  lectura  de  otras
Cobranzas  SUPERVISOR (Cobranzas)  áreas y casos escalados de cobranzas.
Vendedora  Laura  Gómez  Clientes para Contactar, Consultar Stock
|     | (laura.gomez@credimision.com)  |     |     | -  y consultas por WhatsApp.  |
| --- | ------------------------------ | --- | --- | ----------------------------- |
Tel. E
Vendedor inactivo  vendedor.inactivo@credimision.com  Pruebas  de  acceso  de  empleados
|     | (a crear)  |     |     | desactivados.  |
| --- | ---------- | --- | --- | -------------- |
Cobrador  roberto.sosa@credimision.com  -  Panel  de  cobranzas,  comprobantes,
EMPLEADO (Cobranzas)  clientes, cuotas y chat con el asistente.
Cobradora  marisa.paz@credimision.com  -  KPIs globales, verificación de impacto y
Controladora  EMPLEADO  (Cobranzas)  configuración de recordatorios.
[Controlador]
| Empleada      | en  Sofía                        |     |     | Ramírez  Módulos de capacitación.  |
| ------------- | -------------------------------- | --- | --- | ---------------------------------- |
| capacitación  | (sofia.ramirez@credimision.com)  |     |     | -                                  |
Vendedora Ecommerce
Cliente nuevo  Tel.  C1  -  número  no  registrado  Consultas comerciales, venta financiada
|     | (“Cliente  | Prueba  | Uno”),  | DNI  y audio.  |
| --- | ---------- | ------- | ------- | -------------- |
30111222
Cliente con cuotas  Tel.  C2  -  Comercio  Don  Pedro  Recordatorios, comprobantes y cuotas.
|     | (5491133334444),  |     | asignado  | a   |
| --- | ----------------- | --- | --------- | --- |
Roberto Sosa, cuotas de $120.000
Cliente derivado  Valentina Herrera (pidió hablar con  Clientes para Contactar.
un vendedor)
Riesgo  Online  DNI  30111222:  situación  normal.  Dictámenes  APROBADO  y
| (simulado)  | DNI 30999888: deudas en situación  |     |     | RECHAZADO.  |
| ----------- | ---------------------------------- | --- | --- | ----------- |
irregular.
Paljet (simulado)  Categoría  Smart  TV:  Samsung  55"  Consultas de stock e historial de pagos.
4K (4 unidades), LG 50" Full HD (1)
y Philips 43" (0). Historial de pagos
de Comercio Don Pedro.
Base  de  “Circuito  de  Ventas”  (SALES,  Consulta,  edición  y  audiencia  de
| conocimiento  | PUBLICO)        | y   | “Facturación  | y  documentos.  |
| ------------- | --------------- | --- | ------------- | --------------- |
|               | documentación”  |     | (ADMIN,       |                 |
INTERNO).
Capacitación  Puesto  “Vendedor  Ecommerce  /  Módulos de capacitación.
|     | Salón”  con  | 6 píldoras y la lección  |     |     |
| --- | ------------ | ------------------------ | --- | --- |
“¿Qué es Credimisión?”.
PT-TrimIA-2026-01 - Plan de Testing  Página 16

Proyecto Final UTN-FRT - TrimIA
Testing y Calidad
PT-TrimIA-2026-01 - Plan de Testing Página 17
