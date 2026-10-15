import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource as OrmDataSource, In } from 'typeorm';
import { ReportRef } from './report-ref.entity';
import { ReportVersion } from './report-version.entity';
import { ReportStatusHistory } from './report-status-history.entity';
import { DataSource } from '../data-sources/data-source.entity';

@Injectable()
export class ReportsRefService {
  constructor(
    @InjectRepository(ReportRef) private repo: Repository<ReportRef>,
    @InjectRepository(DataSource) private dsRepo: Repository<DataSource>,
    @InjectRepository(ReportVersion) private versionsRepo: Repository<ReportVersion>,
    @InjectRepository(ReportStatusHistory) private statusHistoryRepo: Repository<ReportStatusHistory>,
    private dataSource: OrmDataSource,
  ) {}

  getVersions(reportId: number) {
    return this.dataSource.query(`
      SELECT rv.*, r.number AS "requestNumber", r.name AS "requestName"
      FROM report_versions rv
      LEFT JOIN requests r ON r.id = rv."requestId"
      WHERE rv."reportId" = $1
      ORDER BY rv."createdAt" DESC
    `, [reportId]);
  }

  getStatusHistory(reportId: number) {
    return this.statusHistoryRepo.find({ where: { reportId }, order: { createdAt: 'DESC' } });
  }

  findAll() {
    return this.dataSource.query(`
      SELECT rr.*, r.number AS "requestNumber", r.name AS "requestName",
        ro."fullName" AS "ownerName", ro."userId" AS "ownerUserId"
      FROM reports_ref rr
      LEFT JOIN requests r ON r.id = rr."requestId"
      LEFT JOIN report_owners ro ON ro.id = rr."ownerId"
      ORDER BY rr.id ASC
    `);
  }

  async findOne(id: number) {
    const rows = await this.dataSource.query(`
      SELECT rr.*, r.number AS "requestNumber", r.name AS "requestName",
        ro."fullName" AS "ownerName", ro."userId" AS "ownerUserId"
      FROM reports_ref rr
      LEFT JOIN requests r ON r.id = rr."requestId"
      LEFT JOIN report_owners ro ON ro.id = rr."ownerId"
      WHERE rr.id = $1
    `, [id]);
    if (!rows.length) throw new NotFoundException();
    const report = rows[0];
    // Load data sources separately
    const full = await this.repo.findOne({ where: { id }, relations: ['dataSources'] });
    report.dataSources = full?.dataSources ?? [];
    return report;
  }

  async create(dto: Partial<{
    name: string; owner: string; ownerId: number | null; techOwner: string; dataOwner: string;
    pbiLink: string; workspace: string; environment: string; version: string;
    dataSource: string; updateFrequency: string; slaRefreshHours: number;
    hasRLS: boolean; targetAudience: string; userCount: number; useCase: string;
    description: string; checklistDone: boolean; protocolSigned: boolean;
    publishedAt: Date; requestId: number; dataSourceIds: number[];
  }>) {
    const { dataSourceIds, ...rest } = dto as any;
    const report = this.repo.create(rest) as any;
    if (dataSourceIds?.length) {
      report.dataSources = await this.dsRepo.findBy({ id: In(dataSourceIds) });
    }
    return this.repo.save(report);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    return this.repo.remove(await this.repo.findOne({ where: { id } }));
  }

  async update(id: number, dto: Partial<{
    name: string; owner: string; ownerId: number | null; techOwner: string; dataOwner: string;
    pbiLink: string; workspace: string; environment: string; version: string;
    dataSource: string; updateFrequency: string; slaRefreshHours: number;
    hasRLS: boolean; targetAudience: string; userCount: number; useCase: string;
    description: string; status: string; statusReason: string;
    checklistDone: boolean; protocolSigned: boolean;
    publishedAt: Date; requestId: number; dataSourceIds: number[];
  }>, actingUser?: { id: number; fullName: string }) {
    const { dataSourceIds, statusReason, ...rest } = dto as any;
    const item = await this.repo.findOne({ where: { id }, relations: ['dataSources'] });
    if (!item) throw new NotFoundException();

    const statusChanged = rest.status !== undefined && rest.status !== item.status;
    if (statusChanged && !statusReason?.trim()) {
      throw new BadRequestException('Укажите причину смены статуса');
    }

    const oldStatus = item.status;
    Object.assign(item, rest);
    if (dataSourceIds !== undefined) {
      item.dataSources = dataSourceIds?.length
        ? await this.dsRepo.findBy({ id: In(dataSourceIds) })
        : [];
    }
    const saved = await this.repo.save(item);

    if (statusChanged) {
      await this.statusHistoryRepo.save(this.statusHistoryRepo.create({
        reportId: id,
        oldStatus,
        newStatus: item.status,
        reason: statusReason.trim(),
        changedById: actingUser?.id,
        changedByName: actingUser?.fullName,
      }));
    }

    return saved;
  }
}
