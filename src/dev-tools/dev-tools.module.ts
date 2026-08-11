import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { EmployeesModule } from '../employees/employees.module';
import { ClientsModule } from '../clients/clients.module';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';

@Module({
  imports: [PrismaModule, EmployeesModule, ClientsModule],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}