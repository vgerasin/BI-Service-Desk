import { Controller, Get, Patch, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { InAppNotificationsService } from './in-app-notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class InAppNotificationsController {
  constructor(private readonly service: InAppNotificationsService) {}

  @Get()
  getAll(@CurrentUser() user: User) {
    return this.service.getForUser(user.id);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: User) {
    return this.service.getUnreadCount(user.id).then(count => ({ count }));
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: User) {
    return this.service.markAllRead(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: User) {
    return this.service.markRead(id, user.id);
  }
}
