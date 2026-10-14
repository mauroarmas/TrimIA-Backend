import { ScenarioDefinition } from '../types';
import { duenoVentasScenario } from './01-dueno-ventas.scenario';
import { clienteVentasScenario } from './02-cliente-ventas.scenario';
import { saludoConPreguntaScenario } from './03-saludo-con-pregunta.scenario';
import { saludoPuroScenario } from './04-saludo-puro.scenario';
import { cuartoTurnoScenario } from './05-cuarto-turno.scenario';
import { consultaFinanciacionScenario } from './06-consulta-financiacion.scenario';
import { escaladoHumanoScenario } from './07-escalado-humano.scenario';
import { supervisorVaciosScenario } from './08-supervisor-vacios.scenario';

export const ALL_SCENARIOS: ScenarioDefinition[] = [
  duenoVentasScenario,
  clienteVentasScenario,
  saludoConPreguntaScenario,
  saludoPuroScenario,
  cuartoTurnoScenario,
  consultaFinanciacionScenario,
  escaladoHumanoScenario,
  supervisorVaciosScenario,
];

export {
  duenoVentasScenario,
  clienteVentasScenario,
  saludoConPreguntaScenario,
  saludoPuroScenario,
  cuartoTurnoScenario,
  consultaFinanciacionScenario,
  escaladoHumanoScenario,
  supervisorVaciosScenario,
};
