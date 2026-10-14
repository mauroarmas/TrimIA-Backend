export interface ScenarioContext {
  senderPhone?: string;
  userType: 'CLIENTE' | 'EMPLEADO';
  employeeRole?: 'EMPLEADO' | 'SUPERVISOR';
  conversationHistory?: Array<{
    sender: 'USER' | 'ASSISTANT';
    content: string;
  }>;
  initialAgent?: string;
  isEscalated?: boolean;
}

export interface AssertionViolation {
  rule: 'mustContain' | 'mustNotContain' | 'expectedAgent' | 'expectedEscalation' | 'customCheck';
  expected: string;
  actual?: string;
  reason?: string;
}

export interface ScenarioAssertions {
  mustContain?: Array<string | RegExp>;
  mustNotContain?: Array<string | RegExp>;
  expectedAgent?: string;
  expectedEscalation?: boolean;
  customCheck?: (response: {
    text: string;
    routedAgent?: string;
    escalated?: boolean;
  }) => { passed: boolean; reason?: string };
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  context: ScenarioContext;
  userMessage: string;
  assertions: ScenarioAssertions;
}

export interface ScenarioRunResult {
  runIndex: number;
  passed: boolean;
  durationMs: number;
  generatedResponse: string;
  routedAgent?: string;
  escalated?: boolean;
  failedAssertions: AssertionViolation[];
  error?: string;
}

export interface ScenarioSummary {
  scenarioId: string;
  title: string;
  totalRuns: number;
  passedRuns: number;
  passRate: number; // 0 a 100
  status: 'PASS' | 'WARN' | 'FAIL';
  runs: ScenarioRunResult[];
}

export interface EvaluationReport {
  timestamp: string;
  totalScenarios: number;
  totalRuns: number;
  passedScenarios: number;
  overallPassRate: number;
  executionTimeMs: number;
  scenarioSummaries: ScenarioSummary[];
}
