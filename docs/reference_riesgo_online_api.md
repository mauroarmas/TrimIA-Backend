---
name: Riesgo Online API
description: Documentación oficial de la API de Riesgo Online — usada por el cliente para verificar estado crediticio y endeudamiento
type: reference
originSessionId: 1facc19b-453b-4476-aac3-5d9766931d3d
---
Documentación oficial: https://informe.riesgoonline.com/api/#

Es la API de uno de los sistemas que usa el cliente de TrimIA. Se va a integrar en la **Fase 5** del plan de implementación, en modo **solo lectura**, como `DynamicStructuredTool` **exclusivo del agente ADMIN** (es el único agente con acceso a Riesgo Online — ver [[project-credimision-procesos]] y [[project-trimia]]).

Métodos previstos según el plan:
- `checkCredit(clientId)` — estado crediticio del cliente
- `getDebtLevel(clientId)` — nivel de endeudamiento

Cuando lleguemos a Fase 5 hay que consultar esta documentación para mapear los endpoints reales a los nombres de tools previstos en el plan. Los métodos pueden cambiar tras revisar la API.
