export const FINANCING_NOTICE_PORT = Symbol('FINANCING_NOTICE_PORT');
export interface FinancingNoticeInput {
  channel?: 'WHATSAPP' | 'WEB';
  purpose?: string;
  noticeId: string;
  attemptToken: string;
  destinationFromThread: string;
  body: string;
}
export type FinancingNoticeResult =
  | {
      kind: 'ACCEPTED';
      noticeId: string;
      attemptToken: string;
      providerMessageId: string;
    }
  | { kind: 'NOT_ACCEPTED'; code: string }
  | { kind: 'UNKNOWN' };
export interface FinancingNoticePort {
  send(input: FinancingNoticeInput): Promise<FinancingNoticeResult>;
}
