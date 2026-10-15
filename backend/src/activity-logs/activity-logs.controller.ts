import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private readonly service: ActivityLogsService) {}

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('event') event?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
  ) {
    return this.service.findAll({
      userId: userId ? +userId : undefined,
      event,
      dateFrom,
      dateTo,
      page: page ? +page : 1,
    });
  }
}
