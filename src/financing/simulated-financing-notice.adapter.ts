import { Injectable } from '@nestjs/common';
import {
  FinancingNoticeInput,
  FinancingNoticePort,
  FinancingNoticeResult,
} from './financing-notice.port';
@Injectable()
export class SimulatedFinancingNoticeAdapter implements FinancingNoticePort {
  async send(input: FinancingNoticeInput): Promise<FinancingNoticeResult> {
    return {
      kind: 'ACCEPTED',
      noticeId: input.noticeId,
      attemptToken: input.attemptToken,
      providerMessageId: `sim:${input.noticeId}:${input.attemptToken}`,
    };
  }
}
