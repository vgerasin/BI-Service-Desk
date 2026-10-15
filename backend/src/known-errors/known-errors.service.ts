import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { KnownError, KnownErrorStatus } from './known-error.entity';

@Injectable()
export class KnownErrorsService {
  constructor(
    @InjectRepository(KnownError) private repo: Repository<KnownError>,
  ) {}

  findAll(search?: string, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (search) where.title = ILike(`%${search}%`);
    return this.repo.find({
      where,
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });
  }

  findOne(id: number) {
    return this.repo.findOne({ where: { id }, relations: ['createdBy'] });
  }

  async create(dto: Partial<KnownError>, userId: number) {
    const ke = this.repo.create({ ...dto, createdById: userId });
    return this.repo.save(ke);
  }

  async update(id: number, dto: Partial<KnownError>) {
    const ke = await this.repo.findOne({ where: { id } });
    if (!ke) throw new NotFoundException('Known Error не найден');
    if (dto.status === KnownErrorStatus.RESOLVED && ke.status !== KnownErrorStatus.RESOLVED) {
      dto.resolvedAt = new Date() as any;
    }
    Object.assign(ke, dto);
    return this.repo.save(ke);
  }

  async remove(id: number) {
    await this.repo.delete(id);
    return { success: true };
  }

  async linkToRequest(keId: number, requestId: number, dataSource: any) {
    await dataSource.query(
      `UPDATE requests SET "knownErrorId" = $1 WHERE id = $2`,
      [keId, requestId],
    );
    return { success: true };
  }

  async getLinkedRequests(keId: number, dataSource: any) {
    return dataSource.query(`
      SELECT r.id, r.number, r.name, r.status, r.priority, r."createdAt"
      FROM requests r
      WHERE r."knownErrorId" = $1
      ORDER BY r."createdAt" DESC
    `, [keId]);
  }
}
