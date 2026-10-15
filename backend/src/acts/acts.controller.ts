import {
  BadRequestException, Controller, ForbiddenException, Get, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ActsService } from './acts.service';

// Same abbreviation rules as frontend/src/utils/formatName.ts (no shared package between
// frontend/backend to import from, so kept in sync by hand) — used only for the downloaded
// filename below, never the document body itself.
function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  const [surname, ...rest] = parts;
  const initials = rest.map((p) => `${p[0].toUpperCase()}.`).join('');
  return `${surname} ${initials}`;
}
function shortCompanyName(name: string): string {
  const lastOpen = name.lastIndexOf('«');
  const close = name.indexOf('»', lastOpen);
  if (lastOpen === -1 || close === -1) return name;
  return name.slice(lastOpen + 1, close);
}

@UseGuards(JwtAuthGuard)
@Controller('acts')
export class ActsController {
  constructor(
    private readonly service: ActsService,
    private readonly usersService: UsersService,
  ) {}

  // Access to a contractor's acts is ownership-based, not role-based: an ADMIN can pick any
  // combination of contractors (several logins can legally be one "Исполнитель" — e.g. a
  // self-employed counterparty whose 3-4 people each log time under their own contractor
  // login), everyone else only for the contractor(s) linked to their own login email plus —
  // if they're a team lead (users.managerId) — their direct reports' contractors too. Anyone
  // WHO IS a subordinate (their own managerId is set) has no act access at all, not even for
  // themselves — their lead generates it instead.
  private async allowedContractorIds(user: User): Promise<{ id: number; name: string }[]> {
    if (user.managerId) return [];
    const subordinates = await this.usersService.getSubordinates(user.id);
    const emails = [user.email, ...subordinates.map((s) => s.email)];
    const contractors = await this.service.findContractorsByEmails(emails);
    return contractors.map((c) => ({ id: c.id, name: c.name }));
  }

  private async resolveContractorIds(user: User, requestedIds?: string): Promise<number[]> {
    if (user.role === UserRole.ADMIN) {
      const ids = (requestedIds || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
      if (!ids.length) throw new BadRequestException('contractorIds обязателен');
      return ids;
    }
    const allowed = (await this.allowedContractorIds(user)).map((c) => c.id);
    if (!allowed.length) throw new ForbiddenException('Аккаунт не привязан к подрядчику');
    const requested = (requestedIds || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
    if (!requested.length) return allowed;
    if (requested.some((id) => !allowed.includes(id))) throw new ForbiddenException();
    return requested;
  }

  // Own contractor plus, for a team lead, their direct reports' — powers the self-service
  // "Акт" tab: one result means no picker (fixed contractor), several means the multi-select
  // generator scoped to just this team, none (incl. subordinates) means no access.
  @Get('my-team')
  async myTeam(@CurrentUser() user: User) {
    if (user.role === UserRole.ADMIN) return [];
    return this.allowedContractorIds(user);
  }

  @Get('my-contractor')
  async myContractor(@CurrentUser() user: User) {
    if (user.role === UserRole.ADMIN || user.managerId) return null;
    const own = await this.service.findContractorByEmail(user.email);
    return own ? { id: own.id, name: own.name } : null;
  }

  @Get('preview')
  async preview(
    @CurrentUser() user: User,
    @Query('contractorIds') contractorIds: string,
    @Query('billingCompanyId') billingCompanyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom и dateTo обязательны');
    if (!billingCompanyId) throw new BadRequestException('billingCompanyId обязателен');
    const ids = await this.resolveContractorIds(user, contractorIds);
    const ctx = await this.service.buildContext({ contractorIds: ids, billingCompanyId: Number(billingCompanyId), dateFrom, dateTo });
    return {
      contractors: ctx.contractors.map((c) => ({ id: c.id, name: c.name })),
      billingCompany: { id: ctx.billingCompany.id, name: ctx.billingCompany.name },
      dateFrom: ctx.dateFrom,
      dateTo: ctx.dateTo,
      items: ctx.items,
      byContractor: ctx.byContractor,
      totalHours: ctx.totalHours,
      totalSum: ctx.totalSum,
      totalSumWords: ctx.totalSumWords,
      totalKopecks: ctx.totalKopecks,
    };
  }

  @Get('download')
  async download(
    @CurrentUser() user: User,
    @Query('contractorIds') contractorIds: string,
    @Query('billingCompanyId') billingCompanyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('actDate') actDate: string,
    @Query('city') city: string,
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom и dateTo обязательны');
    if (!billingCompanyId) throw new BadRequestException('billingCompanyId обязателен');
    const ids = await this.resolveContractorIds(user, contractorIds);
    const ctx = await this.service.buildContext({
      contractorIds: ids, billingCompanyId: Number(billingCompanyId), dateFrom, dateTo, actDate, city,
    });
    const buffer = await this.service.renderDocx(ctx);

    // Compact filename — the full names still spell out in full inside the document itself
    // (see acts.service.ts renderDocx), this only affects what shows up in the downloads
    // folder. Naming the contractor only makes sense for a single-contractor act; group it by
    // 3-4+ people (one legal counterparty split across logins — see resolveContractorIds) and
    // even short names strung together get unwieldy again, so the name drops out entirely once
    // there's more than one.
    const namePart = ctx.contractors.length === 1 ? `${shortName(ctx.contractors[0].name)}_` : '';
    const filename = `Акт_${namePart.replace(/[^\p{L}\p{N}_]+/gu, '_')}${shortCompanyName(ctx.billingCompany.name).replace(/[^\p{L}\p{N}]+/gu, '_')}_${dateFrom}_${dateTo}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    // (Cache-Control: no-store is set globally for all /api/* responses — see main.ts.)
    res.send(buffer);
  }
}
