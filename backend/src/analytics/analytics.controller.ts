import { Controller, ForbiddenException, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('dashboard')
  dashboard() { return this.service.getDashboard(); }

  @Get('executive')
  executive() { return this.service.getExecutiveDashboard(); }

  @Get('bugs')
  bugs(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.service.getBugMetrics({ dateFrom, dateTo });
  }

  @Get('ratings')
  ratings(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.service.getRatingMetrics({ dateFrom, dateTo });
  }

  // Non-admins see only their own costs — team leads (someone else's users.managerId points at
  // them) also see their whole team's. Anyone WHO IS a subordinate (their own managerId is set)
  // sees no cost data at all, not even their own — their lead sees it instead. Enforced here
  // regardless of what the client sends.
  private async scopedExecutorIds(user: User): Promise<number[] | undefined> {
    if (user.role === 'admin') return undefined;
    if (user.managerId) throw new ForbiddenException('Затраты видны только вашему руководителю');
    const subordinates = await this.usersService.getSubordinates(user.id);
    return [user.id, ...subordinates.map(s => s.id)];
  }

  @Get('cost')
  async cost(@Query() q: any, @CurrentUser() user: User) {
    return this.service.getCostReport({
      dateFrom: q.dateFrom, dateTo: q.dateTo,
      requestId: q.requestId ? +q.requestId : undefined,
      reportId: q.reportId ? +q.reportId : undefined,
      customerId: q.customerId ? +q.customerId : undefined,
      executorUserIds: await this.scopedExecutorIds(user),
    });
  }

  @Get('cost/export')
  async exportCost(@Query() q: any, @CurrentUser() user: User, @Res() res: Response) {
    const buffer = await this.service.exportCostToExcel({
      dateFrom: q.dateFrom, dateTo: q.dateTo,
      executorUserIds: await this.scopedExecutorIds(user),
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cost-report.xlsx"');
    res.send(buffer);
  }

  @Get('dashboard-cost')
  async dashboardCost(@Query() q: any, @CurrentUser() user: User) {
    return this.service.getDashboardCostReport({
      dateFrom: q.dateFrom, dateTo: q.dateTo,
      executorUserIds: await this.scopedExecutorIds(user),
    });
  }

  @Get('funnel')
  funnel(@Query() q: any) {
    const types = q.types ? String(q.types).split(',').filter(Boolean) : undefined;
    return this.service.getFunnel(
      q.year ? +q.year : undefined,
      q.month ? +q.month : undefined,
      types,
    );
  }

  @Get('sla')
  sla(@Query() q: any) {
    return this.service.getSlaReport({
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
  }

  @Get('monthly')
  monthly(@Query() q: any) {
    const now = new Date();
    return this.service.getMonthlyReport(
      q.year ? +q.year : now.getFullYear(),
      q.month ? +q.month : now.getMonth() + 1,
    );
  }
}
