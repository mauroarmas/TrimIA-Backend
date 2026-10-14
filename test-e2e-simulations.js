const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function login(email, password = 'trimia2026') {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return res.accessToken;
}

async function run() {
  console.log('--- TEST E2E: SIMULACIÓN INTERACTIVA (SPEC 017) ---');

  // 1. Login como empleado (Roberto Sosa) y supervisor (Diego Bazán)
  console.log('1. Autenticando usuarios...');
  const empToken = await login('roberto.sosa@credimision.com');
  const supToken = await login('diego.bazan@credimision.com');
  const empProfile = await request('/auth/me', { headers: { Authorization: `Bearer ${empToken}` } });
  console.log(`✓ Logueado como empleado: ${empProfile.name || empProfile.email} (ID: ${empProfile.id})`);

  // 2. Obtener píldoras disponibles
  console.log('2. Obteniendo píldoras de capacitación...');
  let modules = await request('/training/modules', { headers: { Authorization: `Bearer ${empToken}` } });
  let pill = null;
  for (const m of modules) {
    if (m.pills && m.pills.length > 0) {
      pill = m.pills[0];
      break;
    }
  }

  if (!pill) {
    console.log('No hay píldoras para el empleado, consultando módulos de supervisor...');
    const supModules = await request('/training/supervisor/modules', { headers: { Authorization: `Bearer ${supToken}` } });
    for (const m of supModules) {
      if (m.pills && m.pills.length > 0) {
        pill = m.pills[0];
        // Asegurar que esté publicada
        await request(`/training/pills/${pill.id}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supToken}` },
        }).catch(() => {});
        break;
      }
    }
  }

  if (!pill) {
    throw new Error('No se encontró ninguna píldora en el sistema para probar la simulación');
  }
  console.log(`✓ Píldora de prueba seleccionada: "${pill.title}" (ID: ${pill.id})`);

  // 3. Iniciar Práctica Guiada (US1)
  console.log('\n3. Iniciando Práctica Guiada (GUIDED)...');
  const startTime = Date.now();
  const guidedSession = await request(`/training/pills/${pill.id}/simulations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ mode: 'GUIDED' }),
  });
  const startElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✓ Sesión guiada creada en ${startElapsed}s (ID: ${guidedSession.id})`);
  console.log(`  - Escenario: "${guidedSession.scenarioTitle}"`);
  console.log(`  - Cliente simulado: ${guidedSession.customerName}`);
  console.log(`  - Saludo inicial: "${guidedSession.messages[0]?.content}"`);
  console.log(`  - Checklist de objetivos generados (${guidedSession.goals.length}):`);
  guidedSession.goals.forEach((g, i) => console.log(`    [${i + 1}] ${g.description}`));

  if (guidedSession.goals.length < 3) {
    throw new Error(`Se esperaban al menos 3 objetivos en el checklist, recibidos: ${guidedSession.goals.length}`);
  }

  // 4. Enviar Mensaje 1 (Saludo y solicitud de DNI)
  console.log('\n4. Enviando Mensaje 1 del empleado (saludo y DNI)...');
  const msg1Start = Date.now();
  const turn1 = await request(`/training/simulations/${guidedSession.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({
      content: '¡Hola! Buenos días, bienvenido a Credimisión. ¿Podrías indicarme tu nombre completo y número de DNI para que pueda consultar tu situación en el sistema?',
    }),
  });
  const msg1Elapsed = ((Date.now() - msg1Start) / 1000).toFixed(2);
  console.log(`✓ Réplica del cliente en ${msg1Elapsed}s (Tono: ${turn1.clientMessage.emotion || 'neutral'}):`);
  console.log(`  "${turn1.clientMessage.content}"`);
  console.log('  Estado del checklist en vivo:');
  turn1.updatedGoals.forEach((g) => {
    console.log(`    ${g.isCompleted ? '✅ [CUMPLIDO]' : '⏳ [PENDIENTE]'} ${g.description}${g.evidence ? ` -> Cita: "${g.evidence}"` : ''}`);
  });

  // 5. Enviar Mensaje 2 (Explicación de solución y acuerdo)
  console.log('\n5. Enviando Mensaje 2 del empleado (propuesta y acuerdo)...');
  const msg2Start = Date.now();
  const turn2 = await request(`/training/simulations/${guidedSession.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({
      content: 'Comprendo perfectamente tu situación. Podemos ofrecerte un plan de refinanciación en 3 cuotas fijas sin interés punitorio para regularizar la cuenta hoy mismo. ¿Te parece que coordinemos el primer vencimiento para este viernes?',
    }),
  });
  const msg2Elapsed = ((Date.now() - msg2Start) / 1000).toFixed(2);
  console.log(`✓ Réplica del cliente en ${msg2Elapsed}s (Tono: ${turn2.clientMessage.emotion || 'neutral'}):`);
  console.log(`  "${turn2.clientMessage.content}"`);
  console.log('  Estado del checklist en vivo:');
  turn2.updatedGoals.forEach((g) => {
    console.log(`    ${g.isCompleted ? '✅ [CUMPLIDO]' : '⏳ [PENDIENTE]'} ${g.description}${g.evidence ? ` -> Cita: "${g.evidence}"` : ''}`);
  });

  // 6. Concluir Simulación y Generar Feedback en 3 Tarjetas (US3)
  console.log('\n6. Finalizando simulación y solicitando devolución cualitativa...');
  const feedbackStart = Date.now();
  const feedback = await request(`/training/simulations/${guidedSession.id}/conclude`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
  });
  const feedbackElapsed = ((Date.now() - feedbackStart) / 1000).toFixed(2);
  console.log(`✓ Feedback generado en ${feedbackElapsed}s:`);
  console.log(`  - Banda Global de Desempeño: [ ${feedback.band} ]`);
  console.log(`  - Tarjeta 1 (Qué hizo bien):\n    ${feedback.whatWentWell}`);
  console.log(`  - Tarjeta 2 (A mejorar):\n    ${feedback.toImprove}`);
  console.log(`  - Tarjeta 3 (Reglas del negocio):\n    ${feedback.businessRules}`);
  console.log(`  - Resumen:\n    ${feedback.summary}`);

  if (!['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED'].includes(feedback.band)) {
    throw new Error(`Banda inválida recibida: ${feedback.band}`);
  }

  // 7. Auditoría de Supervisor (US3)
  console.log('\n7. Verificando auditoría del supervisor...');
  const auditList = await request(`/training/supervisor/employees/${empProfile.id}/simulations`, {
    headers: { Authorization: `Bearer ${supToken}` },
  });
  const auditedSession = auditList.find((s) => s.id === guidedSession.id);
  if (!auditedSession) {
    throw new Error('La sesión de simulación no aparece en la auditoría del supervisor');
  }
  console.log(`✓ Sesión encontrada en la auditoría del supervisor (Banda: ${auditedSession.band})`);

  // 8. Probar Modo Libre (US2)
  console.log('\n8. Probando Simulación Libre (FREE)...');
  const freeSession = await request(`/training/pills/${pill.id}/simulations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ mode: 'FREE' }),
  });
  console.log(`✓ Sesión libre creada (ID: ${freeSession.id}, Modo: ${freeSession.mode}, Objetivos: ${freeSession.goals.length})`);
  if (freeSession.goals.length !== 0) {
    throw new Error('El modo libre no debe tener objetivos de checklist en vivo');
  }

  const freeTurn = await request(`/training/simulations/${freeSession.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ content: 'Hola, ¿en qué podemos ayudarte hoy en Credimisión?' }),
  });
  console.log(`✓ Respuesta en modo libre recibida: "${freeTurn.clientMessage.content}"`);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS E2E DE SIMULACIÓN Y PRÁCTICA GUIADA PASARON CON ÉXITO! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ ERROR EN TEST E2E:', err);
  process.exit(1);
});

