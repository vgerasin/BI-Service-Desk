import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { TimeEntry } from './time-entry.entity';

@Injectable()
export class TimeEntriesService {
  constructor(
    @InjectRepository(TimeEntry) private entriesRepo: Repository<TimeEntry>,
    private dataSource: DataSource,
  ) {}

  async findAll(filters: {
    requestId?: number; userId?: number; contractorId?: number | number[];
    dateFrom?: string; dateTo?: string; hideFinancials?: boolean; userEmail?: string;
    billingCompanyId?: number; reportId?: number;
  }) {
    const conds: string[] = ['1=1'];
    const params: any[] = [];
    let i = 1;
    if (filters.requestId) { conds.push(`te."requestId" = $${i++}`); params.push(filters.requestId); }
    // Which dashboard the parent request is linked to — powers the "Трудозатраты" tab on a
    // dashboard's own page and the dashboard filter on the time-entries journal.
    if (filters.reportId) { conds.push(`r."reportId" = $${i++}`); params.push(filters.reportId); }
    // For executors: match by userId OR by contractorId linked via email
    if (filters.userId && filters.userEmail) {
      conds.push(`(te."userId" = $${i++} OR te."contractorId" IN (SELECT c.id FROM contractors c WHERE c.email = $${i++}))`);
      params.push(filters.userId, filters.userEmail);
    } else if (filters.userId) {
      conds.push(`te."userId" = $${i++}`); params.push(filters.userId);
    }
    if (filters.contractorId) {
      if (Array.isArray(filters.contractorId)) {
        conds.push(`te."contractorId" = ANY($${i++}::int[])`); params.push(filters.contractorId);
      } else {
        conds.push(`te."contractorId" = $${i++}`); params.push(filters.contractorId);
      }
    }
    if (filters.dateFrom)     { conds.push(`te.date >= $${i++}`); params.push(filters.dateFrom); }
    if (filters.dateTo)       { conds.push(`te.date <= $${i++}`); params.push(filters.dateTo); }
    // Which legal entity the parent request bills to (see billing-companies module) — used by
    // ActsService to build one act per payer instead of lumping everything under one.
    if (filters.billingCompanyId) { conds.push(`r."billingCompanyId" = $${i++}`); params.push(filters.billingCompanyId); }

    return this.dataSource.query(`
      SELECT
        te.id,
        te."requestId",
        te."userId",
        te."contractorId",
        te.date,
        te.hours::numeric                AS hours,
        COALESCE(te.quantity::numeric, 1) AS quantity,
        te."workName",
        te."workKind",
        te.comment,
        te."createdAt",
        r.number                         AS "requestNumber",
        r.name                           AS "requestName",
        r."reportId"                     AS "reportId",
        rep.name                         AS "dashboardName",
        r."billingCompanyId"             AS "billingCompanyId",
        u."fullName"                     AS "userName",
        con.name                         AS "contractorName",
        ${filters.hideFinancials ? '0' : 'COALESCE(rh.rate::numeric, 0)'}    AS rate,
        ${filters.hideFinancials ? "'RUB'" : "COALESCE(rh.currency, 'RUB')"}  AS currency,
        ${filters.hideFinancials ? '0' : 'ROUND((te.hours::numeric * COALESCE(te.quantity::numeric, 1) * COALESCE(rh.rate::numeric, 0))::numeric, 2)'} AS cost
      FROM time_entries te
      LEFT JOIN requests r      ON r.id   = te."requestId"
      LEFT JOIN reports_ref rep ON rep.id = r."reportId"
      LEFT JOIN users u         ON u.id   = te."userId"
      LEFT JOIN contractors con ON con.id = te."contractorId"
      LEFT JOIN LATERAL (
        SELECT rate, currency FROM rate_history rh2
        WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
          AND rh2."dateFrom" <= te.date
          AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
        ORDER BY rh2."dateFrom" DESC
        LIMIT 1
      ) rh ON true
      WHERE ${conds.join(' AND ')}
      ORDER BY te.date DESC, te.id DESC
    `, params);
  }

  async findContractorByEmail(email: string): Promise<{ id: number }[]> {
    return this.dataSource.query(
      `SELECT id FROM contractors WHERE email = $1 LIMIT 1`,
      [email],
    );
  }

  async create(dto: {
    requestId: number; userId?: number; contractorId?: number;
    date: string; hours: number; quantity?: number;
    workName?: string; workKind?: string; comment?: string;
  }) {
    if (dto.hours <= 0) throw new BadRequestException('Часы должны быть положительными');
    // Both null used to save fine (no FK/not-null constraint on either column) and then vanish —
    // findAll() only ever matches on userId OR contractorId, so an unowned row was invisible to
    // everyone, including whoever just logged it. Fail loudly here instead of at read time.
    if (!dto.userId && !dto.contractorId) {
      throw new BadRequestException('Не удалось определить исполнителя записи — обратитесь к администратору');
    }
    const requestExists = await this.dataSource.query('SELECT 1 FROM requests WHERE id = $1', [dto.requestId]);
    if (!requestExists.length) throw new BadRequestException('Заявка не найдена');
    const entry = this.entriesRepo.create({ ...dto, quantity: dto.quantity || 1 });
    return this.entriesRepo.save(entry);
  }

  async update(id: number, dto: Partial<{
    date: string; hours: number; quantity: number; workName: string; workKind: string; comment: string;
  }>, actingUser?: { id: number; role: string; email?: string }) {
    const entry = await this.entriesRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException();
    if (actingUser) await this.assertOwnership(entry, actingUser);
    if (dto.hours !== undefined && dto.hours <= 0) throw new BadRequestException('Часы должны быть положительными');
    Object.assign(entry, dto);
    return this.entriesRepo.save(entry);
  }

  async delete(id: number, actingUser?: { id: number; role: string; email?: string }) {
    if (actingUser) {
      const entry = await this.entriesRepo.findOne({ where: { id } });
      if (!entry) throw new NotFoundException();
      await this.assertOwnership(entry, actingUser);
    }
    await this.entriesRepo.delete(id);
  }

  // PUT/DELETE had no ownership check at all — any executor could edit or delete any other
  // person's logged time by id, not just their own (the list endpoint already scopes correctly,
  // this closes the gap on the two mutating routes).
  private async assertOwnership(entry: TimeEntry, user: { id: number; role: string; email?: string }) {
    if (user.role === 'admin') return;
    if ((entry as any).userId === user.id) return;
    if ((entry as any).contractorId && user.email) {
      const rows = await this.dataSource.query('SELECT id FROM contractors WHERE email = $1', [user.email]);
      if (rows.some((r: any) => r.id === (entry as any).contractorId)) return;
    }
    throw new ForbiddenException('Можно редактировать только свои записи времени');
  }

  async exportToExcel(filters: {
    requestId?: number; userId?: number; contractorId?: number | number[];
    dateFrom?: string; dateTo?: string; hideFinancials?: boolean; userEmail?: string;
    reportId?: number;
  }): Promise<Buffer> {
    const rows = await this.findAll(filters);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Трудозатраты');

    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'Дата', key: 'date', width: 12 },
      { header: '№ Заявки', key: 'requestNumber', width: 14 },
      { header: 'Заявка', key: 'requestName', width: 40 },
      { header: 'Исполнитель', key: 'executor', width: 25 },
      { header: 'Наименование работ', key: 'workName', width: 35 },
      { header: 'Часы', key: 'hours', width: 8 },
      { header: 'Кол-во', key: 'quantity', width: 8 },
    ];
    if (!filters.hideFinancials) {
      columns.push(
        { header: 'Ставка', key: 'rate', width: 10 },
        { header: 'Валюта', key: 'currency', width: 8 },
        { header: 'Стоимость', key: 'cost', width: 14 },
      );
    }
    ws.columns = columns;

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };

    let totalHours = 0;
    let totalCost = 0;
    for (const r of rows as any[]) {
      const row: any = {
        date: r.date,
        requestNumber: r.requestNumber,
        requestName: r.requestName,
        executor: r.contractorName || r.userName || '',
        workName: r.workName || r.workKind || '',
        hours: Number(r.hours),
        quantity: Number(r.quantity || 1),
      };
      if (!filters.hideFinancials) {
        row.rate = Number(r.rate);
        row.currency = r.currency;
        row.cost = Number(r.cost);
        totalCost += Number(r.cost);
      }
      totalHours += Number(r.hours) * Number(r.quantity || 1);
      ws.addRow(row);
    }

    const totalRow = ws.addRow({ requestName: 'ИТОГО', hours: totalHours, ...(filters.hideFinancials ? {} : { cost: totalCost }) });
    totalRow.font = { bold: true };

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }
}
