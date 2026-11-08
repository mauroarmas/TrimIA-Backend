import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CollectionsController } from './collections.controller';
import { UpdateReminderConfigDto } from './dto/update-reminder-config.dto';

describe('Recordatorios — RF04-19/20', () => {
  it.each([{ daysBefore: [0, 30] }, { daysBefore: [7, 3, 0] }])(
    'acepta días válidos %j',
    async (input) => {
      const dto = plainToInstance(UpdateReminderConfigDto, input);
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it.each([
    { daysBefore: [-1] },
    { daysBefore: [31] },
    { daysBefore: [0.5] },
    { daysBefore: [] },
    { daysBefore: [7, 7] },
  ])('rechaza los días inválidos %j', async (input) => {
    const dto = plainToInstance(UpdateReminderConfigDto, input);
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('permite configurar a Marisa controladora y deniega a un cobrador común', () => {
    const config = {
      get: jest.fn().mockResolvedValue({ daysBefore: [7, 3, 0] }),
      update: jest.fn(),
    };
    const controller = new CollectionsController(
      null,
      null,
      null,
      null,
      config as any,
      null,
    );
    controller.getReminderConfig({
      user: { role: 'EMPLEADO', isController: true },
    });
    controller.updateReminderConfig(
      { daysBefore: [0, 30] },
      { user: { role: 'EMPLEADO', isController: true } },
    );
    expect(config.update).toHaveBeenCalledWith({ daysBefore: [0, 30] });
    expect(() =>
      controller.getReminderConfig({
        user: { role: 'EMPLEADO', isController: false },
      }),
    ).toThrow(ForbiddenException);
    controller.getReminderConfig({
      user: { role: 'SUPERVISOR', isController: false },
    });
    expect(config.get).toHaveBeenCalledTimes(2);
  });
});
