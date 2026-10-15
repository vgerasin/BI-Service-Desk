import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ReportOwner } from './report-owner.entity';

@Injectable()
export class ReportOwnersService {
  constructor(
    @InjectRepository(ReportOwner) private repo: Repository<ReportOwner>,
    private dataSource: DataSource,
  ) {}

  findAll() {
    return this.dataSource.query(`
      SELECT ro.*, u.email AS "userEmail"
      FROM report_owners ro
      LEFT JOIN users u ON u.id = ro."userId"
      ORDER BY ro."fullName" ASC
    `);
  }

  async create(fullName: string) {
    const name = (fullName || '').trim();
    if (!name) throw new BadRequestException('Укажите имя');
    const existing = await this.repo.findOne({ where: { fullName: name } });
    if (existing) return existing;

    const owner = this.repo.create({ fullName: name });
    // Best-effort auto-link — collapses into an existing account with the exact same name.
    await this.linkByName(owner);
    return this.repo.save(owner);
  }

  async setUserLink(id: number, userId: number | null) {
    const owner = await this.repo.findOne({ where: { id } });
    if (!owner) throw new NotFoundException();
    owner.userId = userId;
    return this.repo.save(owner);
  }

  private async linkByName(owner: ReportOwner) {
    const rows = await this.dataSource.query(`SELECT id FROM users WHERE "fullName" = $1 LIMIT 1`, [owner.fullName]);
    if (rows[0]) owner.userId = rows[0].id;
  }

  /** Called right after a user account is created/updated via SSO — collapses any matching
   *  free-standing owner entry into this account. */
  async autoLinkUser(fullName: string, userId: number) {
    await this.dataSource.query(
      `UPDATE report_owners SET "userId" = $1 WHERE "fullName" = $2 AND ("userId" IS NULL OR "userId" <> $1)`,
      [userId, fullName],
    );
  }
}
