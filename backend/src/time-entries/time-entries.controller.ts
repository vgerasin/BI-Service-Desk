import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { TimeEntriesService } from './time-entries.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/user.entity';
import { ActivityLogsService, ActivityEvent } from '../activity-logs/activity-logs.service';

@UseGuards(JwtAuthGuard)
@Controller('time-entries')
export class TimeEntriesController {
  constructor(
    private readonly service: TimeEntriesService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  private buildFilters(q: any, currentUser: User) {
    // Executors see only their own time entries; admins see all and see financials
    const isExecutor = currentUser.role === UserRole.EXECUTOR;
    return {
      requestId: q.requestId ? +q.requestId : undefined,
      reportId: q.reportId ? +q.reportId : undefined,
      userId: isExecutor ? currentUser.id : (q.userId ? +q.userId : undefined),
      userEmail: isExecutor ? currentUser.email : undefined,
      // Multi-select on the client sends a comma-separated list ("3,7,12"); a single id still
      // works the same way (one-element array, `= ANY(...)` in the query either way).
      contractorId: q.contractorId ? String(q.contractorId).split(',').map(Number) : undefined,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      hideFinancials: isExecutor, // ставки/стоимость исполнителю не показываем — это не его дело (см. Акты)
    };
  }

  @Get('export')
  async exportExcel(
    @Query() q: any,
    @CurrentUser() currentUser: User,
    @Res() res: Response,
  ) {
    void this.activityLogs.log({
      userId: currentUser.id, userRole: currentUser.role, userName: currentUser.fullName,
      event: ActivityEvent.EXPORT_EXCEL, meta: { type: 'time-entries' },
    });
    const filters = this.buildFilters(q, currentUser);
    const buffer = await this.service.exportToExcel(filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="time-entries.xlsx"');
    res.send(buffer);
  }

  @Get()
  findAll(
    @Query() q: any,
    @CurrentUser() currentUser: User,
  ) {
    return this.service.findAll(this.buildFilters(q, currentUser));
  }

  @Post()
  async create(
    @Body() dto: {
      requestId: number; userId?: number; contractorId?: number;
      date: string; hours: number; quantity?: number;
      workName?: string; workKind?: string; comment?: string;
    },
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.role === UserRole.EXECUTOR) {
      // Resolve contractor by email, ignore whatever the client sent. Most executors are plain
      // staff with no matching `contractors` row at all — falling through to `userId = undefined`
      // in that case used to create a time_entries row with BOTH columns null: invisible to
      // findAll() (which matches on userId OR contractorId-by-email) for everyone, including the
      // person who just logged it. The create looked like it silently did nothing.
      const rows: { id: number }[] = await this.service.findContractorByEmail(currentUser.email);
      if (rows[0]?.id) {
        dto.contractorId = rows[0].id;
        dto.userId = undefined;
      } else {
        dto.contractorId = undefined;
        dto.userId = currentUser.id;
      }
    }
    return this.service.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() currentUser: User,
  ) {
    return this.service.update(id, dto, { id: currentUser.id, role: currentUser.role, email: currentUser.email });
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: User) {
    return this.service.delete(id, { id: currentUser.id, role: currentUser.role, email: currentUser.email });
  }
}
