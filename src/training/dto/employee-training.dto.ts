import { TrainingProgressStatus } from '@prisma/client';

export interface EmployeeQuizQuestion {
  id: number;
  question: string;
  options: string[];
}

export interface EmployeePillSummaryDto {
  id: string;
  title: string;
  objective: string;
  orderIndex: number;
  isCompleted: boolean;
  isLocked: boolean;
  status?: TrainingProgressStatus;
  isExempted?: boolean;
}

export interface EmployeePillDetailDto {
  id: string;
  moduleId: string;
  title: string;
  objective: string;
  content: string;
  orderIndex: number;
  isCompleted: boolean;
  isLocked: boolean;
  status?: TrainingProgressStatus;
  isExempted?: boolean;
  quiz: EmployeeQuizQuestion[];
}

export interface EmployeeModuleSummaryDto {
  id: string;
  title: string;
  description?: string | null;
  pillsCount: number;
  completedPillsCount: number;
  pills: EmployeePillSummaryDto[];
}
