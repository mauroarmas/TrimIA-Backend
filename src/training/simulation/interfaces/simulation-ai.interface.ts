import { PerformanceBand } from '@prisma/client';

export interface GeneratedGoal {
  description: string;
}

export interface GeneratedScenario {
  scenarioTitle: string;
  customerName: string;
  customerProfile: string;
  initialCustomerGreeting: string;
  goals: GeneratedGoal[];
}

export interface TurnGoalEvaluation {
  goalId: string;
  isCompleted: boolean;
  evidence?: string;
}

export interface TurnAiResponse {
  customerResponse: string;
  emotion: string;
  completedGoalEvaluations?: TurnGoalEvaluation[];
}

export interface GeneratedFeedback {
  band: PerformanceBand;
  whatWentWell: string;
  toImprove: string;
  businessRules: string;
  summary: string;
}
