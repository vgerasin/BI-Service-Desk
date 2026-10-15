import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { NotificationsService } from './notifications.service';

/** «Отправить тестовое письмо» button on Settings → Почта. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('settings/smtp')
export class SmtpTestController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('test')
  @HttpCode(200)
  test(@Body('to') to: string) {
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequestException('Укажите корректный email');
    return this.notifications.sendDiagnostic(to.trim());
  }
}
