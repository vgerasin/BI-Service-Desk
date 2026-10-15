import {
  Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Post, Put,
  Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { RequestsService } from './requests.service';
import { ResolveRequestIdPipe } from './resolve-request-id.pipe';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { RequestStatus, RequestType, Priority } from './request.entity';
import { ActivityLogsService, ActivityEvent } from '../activity-logs/activity-logs.service';

function multerStorage() {
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  return diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  });
}

@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  @Get('export')
  async exportExcel(
    @Query() q: any,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    void this.activityLogs.log({
      userId: user.id, userRole: user.role, userName: user.fullName,
      event: ActivityEvent.EXPORT_EXCEL, meta: { type: 'requests' },
    });
    const buffer = await this.requestsService.exportToExcel({
      status: q.status, priority: q.priority, search: q.search,
      assigneeId: q.assigneeId ? +q.assigneeId : undefined,
      contractorId: q.contractorId ? +q.contractorId : undefined,
      customerId: q.customerId ? +q.customerId : undefined,
      userId: user.id, userRole: user.role, userEmail: user.email,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="requests.xlsx"');
    res.send(buffer);
  }

  @Get()
  findAll(
    @Query() q: {
      status?: string; assigneeId?: string; customerId?: string;
      reportId?: string; contractorId?: string; priority?: string; search?: string;
      page?: string; pageSize?: string; mine?: string; overdue?: string;
      sortField?: string; sortOrder?: string;
    },
    @CurrentUser() user: User,
  ) {
    return this.requestsService.findAll({
      status: q.status,
      assigneeId: q.assigneeId ? +q.assigneeId : undefined,
      customerId: q.customerId ? +q.customerId : undefined,
      reportId: q.reportId ? +q.reportId : undefined,
      contractorId: q.contractorId ? +q.contractorId : undefined,
      priority: q.priority,
      search: q.search,
      page: q.page ? +q.page : undefined,
      pageSize: q.pageSize ? +q.pageSize : undefined,
      mine: q.mine === 'true',
      overdue: q.overdue === 'true',
      sortField: q.sortField,
      sortOrder: q.sortOrder,
      userId: user.id,
      userRole: user.role,
      userEmail: user.email,
      userCustomerId: (user as any).customerId ?? undefined,
    });
  }

  // Must come before ':id' — otherwise Express matches "similar" as the :id param.
  @Get('similar')
  findSimilar(@Query('q') q: string, @Query('type') type?: string) {
    return this.requestsService.findSimilar(q, type);
  }

  @Get(':id')
  async findOne(@Param('id', ResolveRequestIdPipe) id: number, @CurrentUser() user: User) {
    const result = await this.requestsService.findOne(id);
    this.requestsService.assertCanView(result as any, user as any);
    void this.activityLogs.log({
      userId: user.id, userRole: user.role, userName: user.fullName,
      event: ActivityEvent.REQUEST_VIEWED, entityId: id, entityType: 'request',
      entityLabel: result?.number ? `${result.number} — ${result.name}` : `#${id}`,
    });
    return result;
  }

  @Post()
  async create(
    @Body() dto: {
      type: RequestType; name: string; customerId?: number; reportId?: number;
      priority: Priority; description?: string; plannedHours?: number;
      plannedDate?: string; assigneeId?: number; contractorId?: number;
      onBehalfOfName?: string; onBehalfOfEmail?: string;
      billingCompanyId?: number;
    },
    @CurrentUser() user: User,
  ) {
    // Portal customers: auto-assign their customerId, ignore client-provided value
    if (user.role === 'customer' && (user as any).customerId) {
      dto = { ...dto, customerId: (user as any).customerId };
    }
    const result = await this.requestsService.create(dto, user.id, user.role);
    const event = user.role === 'customer' ? ActivityEvent.PORTAL_SUBMIT : ActivityEvent.REQUEST_CREATED;
    void this.activityLogs.log({
      userId: user.id, userRole: user.role, userName: user.fullName,
      event, entityId: result?.id, entityType: 'request',
      entityLabel: result?.number ? `${result.number} — ${result.name}` : undefined,
    });
    return result;
  }

  @Put(':id')
  update(
    @Param('id', ResolveRequestIdPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: User,
  ) {
    // Назначение исполнителя, тип услуги, плановый срок и заявитель — прерогатива администратора;
    // фронт уже прячет эти поля от остальных ролей, но эндпоинт сам по себе ничего не проверял.
    if (user.role !== 'admin' && (
      dto.contractorId !== undefined || dto.assigneeId !== undefined || dto.type !== undefined
      || dto.plannedDate !== undefined || dto.onBehalfOfName !== undefined || dto.onBehalfOfEmail !== undefined
    )) {
      throw new ForbiddenException('Только администратор может назначать исполнителя, менять тип услуги, плановый срок и заявителя');
    }
    return this.requestsService.update(id, dto, user.id, user.role, (user as any).email);
  }

  // A team lead handing a request they're currently assigned off to their own subordinate —
  // deliberately separate from the admin-only PUT above (see RequestsService.delegate for the
  // "current assignee + is my subordinate" checks).
  @Post(':id/delegate')
  delegate(
    @Param('id', ResolveRequestIdPipe) id: number,
    @Body() body: { assigneeId: number },
    @CurrentUser() user: User,
  ) {
    return this.requestsService.delegate(id, body.assigneeId, { id: user.id, role: user.role });
  }

  @Post(':id/status')
  async changeStatus(
    @Param('id', ResolveRequestIdPipe) id: number,
    @Body() body: { status: RequestStatus; comment?: string; closeReason?: string },
    @CurrentUser() user: User,
  ) {
    const result = await this.requestsService.changeStatus(id, body.status, user.id, body.comment, body.closeReason, user.role);
    void this.activityLogs.log({
      userId: user.id, userRole: user.role, userName: user.fullName,
      event: ActivityEvent.STATUS_CHANGED, entityId: id, entityType: 'request',
      meta: { to: body.status },
    });
    return result;
  }

  @Post(':id/accept')
  acceptByCustomer(
    @Param('id', ResolveRequestIdPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.requestsService.acceptByCustomer(id, user.id);
  }

  @Post(':id/remind-rating')
  remindRating(
    @Param('id', ResolveRequestIdPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.requestsService.remindRating(id, user.id);
  }

  @Post(':id/comments')
  addComment(
    @Param('id', ResolveRequestIdPipe) id: number,
    @Body() body: { text: string },
    @CurrentUser() user: User,
  ) {
    return this.requestsService.addComment(id, body.text, user.id);
  }

  @Post(':id/artifacts')
  @UseInterceptors(FileInterceptor('file', { storage: multerStorage() }))
  uploadArtifact(
    @Param('id', ResolveRequestIdPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('artifactType') artifactType: string,
    @CurrentUser() user: User,
  ) {
    return this.requestsService.saveArtifact(id, file, user.id, artifactType);
  }

  @Delete(':id')
  remove(
    @Param('id', ResolveRequestIdPipe) id: number,
    @CurrentUser() user: User,
  ) {
    if (user.role !== 'admin') throw new ForbiddenException('Только администратор может удалять заявки');
    return this.requestsService.remove(id);
  }

  @Post('batch')
  batchUpdate(
    @Body() body: { ids: number[]; action: string; payload: any },
    @CurrentUser() user: User,
  ) {
    if (body.action === 'assign_contractor' && user.role !== 'admin') {
      throw new ForbiddenException('Только администратор может назначать исполнителя');
    }
    return this.requestsService.batchUpdate(body.ids, body.action, body.payload, user.id);
  }

  @Delete('artifacts/:id')
  deleteArtifact(@Param('id', ParseIntPipe) id: number) {
    return this.requestsService.deleteArtifact(id);
  }

  // One-off remediation for the "assignee got no email" bug: assigning an internal
  // executor via assigneeId never sent a notification (only contractorId did) until this
  // fix. Re-sends the "you've been assigned" email for every currently-open request that
  // already has an assignee, so already-assigned executors aren't left uninformed forever.
  @Post('backfill-assignee-notifications')
  backfillAssigneeNotifications(@CurrentUser() user: User) {
    if (user.role !== 'admin') throw new ForbiddenException('Только администратор может запускать рассылку');
    return this.requestsService.backfillAssigneeNotifications();
  }
}
