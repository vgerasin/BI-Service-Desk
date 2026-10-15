import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BillingCompany } from './billing-company.entity';

@Injectable()
export class BillingCompaniesService {
  constructor(
    @InjectRepository(BillingCompany) private repo: Repository<BillingCompany>,
    private dataSource: DataSource,
  ) {}

  findAll(): Promise<BillingCompany[]> {
    return this.repo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  async create(dto: Partial<BillingCompany>): Promise<BillingCompany> {
    const saved = await this.repo.save(this.repo.create(dto));
    if (dto.isDefault) await this.makeDefault(saved.id);
    return saved;
  }

  async update(id: number, dto: Partial<BillingCompany>): Promise<BillingCompany> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Юрлицо не найдено');
    Object.assign(row, dto);
    await this.repo.save(row);
    if (dto.isDefault) await this.makeDefault(id);
    return row;
  }

  // Exactly one row is ever the default — flip the rest off in the same breath, rather than
  // trusting every caller to remember to.
  private async makeDefault(id: number): Promise<void> {
    await this.dataSource.query(`UPDATE billing_companies SET "isDefault" = (id = $1)`, [id]);
  }

  async remove(id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Юрлицо не найдено');
    if (row.isDefault) throw new BadRequestException('Нельзя удалить юрлицо по умолчанию — сначала назначьте другое');
    const [{ count }] = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM requests WHERE "billingCompanyId" = $1) +
        (SELECT COUNT(*) FROM reports_ref WHERE "billingCompanyId" = $1) AS count`,
      [id],
    );
    if (Number(count) > 0) {
      throw new BadRequestException('На это юрлицо уже ссылаются заявки или дашборды — удаление невозможно');
    }
    await this.repo.delete(id);
  }
}
