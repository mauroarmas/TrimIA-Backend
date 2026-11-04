import { AudioStatus, TrainingProgressStatus } from '@prisma/client';

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
  audioStatus?: AudioStatus;
  hasAudio?: boolean;
  audioDurationSeconds?: number | null;
  isAudioCompleted?: boolean;
  playbackProgressSeconds?: number;
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

  // Spec 016 — Pipeline de audio y streaming
  audioStatus?: AudioStatus;
  audioDurationSeconds?: number | null;
  hasAudio?: boolean;
  isAudioCompleted?: boolean;
  playbackProgressSeconds?: number;
  streamUrl?: string | null;
}

export interface EmployeeModuleSummaryDto {
  id: string;
  title: string;
  description?: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  pillsCount: number;
  completedPillsCount: number;
  pills: EmployeePillSummaryDto[];
}
