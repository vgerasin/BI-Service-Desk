import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSource, DataSourceType, DbEngine } from './data-source.entity';

@Injectable()
export class DataSourcesService {
  constructor(
    @InjectRepository(DataSource) private repo: Repository<DataSource>,
  ) {}

  findAll() {
    return this.repo.find({ order: { code: 'ASC', name: 'ASC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id }, relations: ['reports'] });
    if (!item) throw new NotFoundException();
    return item;
  }

  create(dto: {
    code?: string; name: string; type: DataSourceType;
    dbEngine?: DbEngine; dbServer?: string; dbName?: string;
    url?: string; description?: string;
  }) {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: number, dto: Partial<{
    code: string; name: string; type: DataSourceType;
    dbEngine: DbEngine; dbServer: string; dbName: string;
    url: string; description: string; isActive: boolean;
  }>) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException();
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async getLineage() {
    // Load all sources with their connected reports via the junction table relation
    const sources = await this.repo.find({
      order: { type: 'ASC', name: 'ASC' },
      relations: ['reports'],
    });

    // Collect unique reports across all sources
    const reportsMap: Record<number, any> = {};
    const links: Array<{ sourceId: number; reportId: number }> = [];

    for (const src of sources) {
      for (const rpt of src.reports ?? []) {
        reportsMap[rpt.id] = {
          id: rpt.id, name: rpt.name, status: rpt.status, environment: rpt.environment,
        };
        links.push({ sourceId: src.id, reportId: rpt.id });
      }
    }

    return {
      sources: sources.map(s => ({
        id: s.id, code: s.code, name: s.name, type: s.type,
        dbEngine: s.dbEngine, dbServer: s.dbServer, dbName: s.dbName, isActive: s.isActive,
        reports: (s.reports ?? []).map(r => ({
          id: r.id, name: r.name, status: r.status, environment: r.environment,
        })),
      })),
      reports: Object.values(reportsMap),
      links,
    };
  }

  async remove(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException();
    return this.repo.remove(item);
  }
}
