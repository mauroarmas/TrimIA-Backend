import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { CommercialFlowService } from '../../financing/commercial-flow.service';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { FinancingEvaluationService } from '../../financing/financing-evaluation.service';
import {
  FinancingNoticeService,
  FINANCING_RECOVERY_MS,
} from '../../financing/financing-notice.service';
@Processor('financing', { concurrency: 5 })
@Injectable()
export class FinancingProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue('financing') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly evaluation: FinancingEvaluationService,
    private readonly notices: FinancingNoticeService,
    @Optional() private readonly commercial?: CommercialFlowService,
  ) {
    super();
  }
  async onModuleInit() {
    await this.queue.add(
      'recover',
      {},
      {
        repeat: { every: FINANCING_RECOVERY_MS },
        jobId: 'finance-recover',
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );
    await this.queue.add(
      'recover',
      {},
      { removeOnComplete: true, removeOnFail: 20 },
    );
  }
  async process(job: Job) {
    if (job.name === 'evaluate')
      return this.evaluation.evaluate(job.data.id, job.data.version);
    if (job.name === 'notice') return this.notices.dispatch(job.data.id);
    await this.notices.expireClaims();
    await this.commercial?.expireOrders();
    for (const r of await this.prisma.purchaseRequest.findMany({
      where: { status: 'PENDING_REVIEW', evaluationState: 'PENDING' },
      select: { id: true, version: true },
      take: 100,
    }))
      await this.queue.add('evaluate', r, {
        jobId: `finance-eval-${r.id}-${r.version}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    for (const n of await this.prisma.outboundCommunication.findMany({
      where: { status: 'PENDING' },
      select: { id: true, version: true },
      take: 100,
    }))
      await this.queue.add('notice', n, {
        jobId: `finance-notice-${n.id}-${n.version}`,
        removeOnComplete: true,
        removeOnFail: true,
      });
  }
}
