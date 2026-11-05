// Solo API del preview aislado. Los datos son los de seed-convergence-preview.cjs.
const assert=require('node:assert/strict');
const base='http://127.0.0.1:3013';const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function call(path,token,method='GET',body){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};}
async function run(){
 const login=async email=>{const r=await call('/auth/login',null,'POST',{email,password:'Convergencia-local-2026'});assert.equal(r.status,200);return r.data.accessToken;};
 const emp=await login('empleado@convergencia.invalid');const sup=await login('supervisor@convergencia.invalid');
 for(const suffix of ['script','audio/status','audio']){assert.equal((await call('/training/pills/'+id(140)+'/'+suffix)).status,401);assert.equal((await call('/training/pills/'+id(142)+'/'+suffix,emp)).status,404);assert.equal((await call('/training/pills/'+id(141)+'/'+suffix,emp)).status,403);}
 const modules=await call('/training/modules',emp);assert.equal(modules.status,200);assert.equal(modules.data[0].pills.length,2);
 let exam=await call('/training/diagnostic',emp);assert.equal(exam.status,200);assert.equal(exam.data.totalQuestions,4);
 assert.equal(new Set(exam.data.questions.map(q=>q.questionId)).size,2); // IDs repetidos entre píldoras
 assert.equal((await call('/training/diagnostic/submit',emp,'POST',{answers:exam.data.questions.slice(0,1).map(q=>({pillId:q.pillId,questionId:q.questionId,selectedOptionIndex:0}))})).status,400);
 const answers=exam.data.questions.map(q=>({pillId:q.pillId,questionId:q.questionId,selectedOptionIndex:q.questionId===1?0:1}));
 const submitted=await call('/training/diagnostic/submit',emp,'POST',{answers});assert.equal(submitted.status,200);assert.equal(submitted.data.score,100);
 const history=await call('/training/supervisor/diagnostic/'+id(12),sup);assert.equal(history.status,200);assert.equal(history.data.hasCompletedDiagnostic,true);assert.equal(history.data.lastSession.answers.length,4);
 assert.equal((await call('/training/supervisor/diagnostic/'+id(12)+'/reset',sup,'POST')).status,200);
 exam=await call('/training/diagnostic',emp);assert.equal(exam.status,200);assert.equal(exam.data.questions.length,4);
 const detail=await call('/training/simulations/'+id(171),sup);assert.equal(detail.status,200);assert.equal(detail.data.messages.length,4);assert.equal(detail.data.feedback.businessRulesBand,'ACHIEVED');
 assert.equal((await call('/training/pills/'+id(140)+'/simulations/active?mode=GUIDED',emp)).data.id,id(17));
 assert.equal((await call('/training/simulations/'+id(17)+'/messages',emp,'POST',{content:'  '})).status,400);
 const prospects=await call('/sales/prospects',emp);assert.equal(prospects.status,200);assert.equal(prospects.data.find(p=>p.id===id(190)).handoff.producto,'Equipo consultado');
 assert.equal((await call('/sales/prospects/'+id(190)+'/followup',emp,'POST',{message:'Revisión HTTP del entorno aislado'})).status,200);
 assert.equal((await call('/sales/prospects/'+id(190)+'/takeover',emp,'POST')).status,200);
 assert.equal((await call('/sales/prospects/'+id(190)+'/reply',emp,'POST',{message:'Respuesta de prueba aislada, canal WEB.'})).status,200);
 const conversation=await call('/sales/prospects/'+id(190)+'/conversation',emp);assert.equal(conversation.status,200);assert(conversation.data.messages.some(m=>m.content==='Respuesta de prueba aislada, canal WEB.'));assert(!conversation.data.internalNotes);
 assert.equal((await call('/sales/prospects/'+id(190)+'/release',emp,'POST')).status,200);
 assert.equal((await call('/sales/close',emp,'POST',{finalAmount:1000,modality:'CASH',notes:'Prueba sin destino'})).status,400);
 assert.equal((await call('/sales/close',emp,'POST',{prospectId:id(190),finalAmount:-1,modality:'CASH',notes:'Monto inválido'})).status,400);
 assert.equal((await call('/auth/logout',emp,'POST')).status,200);assert.equal((await call('/training/pills/'+id(140)+'/audio/status',emp)).status,401);
 console.log('OK: JWT/revocación, DRAFT/candado, diagnóstico completo/reinicio, historial de simulación, seguimiento y takeover/reply WEB por API aislada.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
