import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Contractor } from './contractor.entity';
import { RateHistory } from '../users/rate-history.entity';
import { User, UserRole } from '../users/user.entity';

@Injectable()
export class ContractorsService {
  constructor(
    @InjectRepository(Contractor) private repo: Repository<Contractor>,
    @InjectRepository(RateHistory) private ratesRepo: Repository<RateHistory>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private dataSource: DataSource,
  ) {}

  async findAll() {
    return this.dataSource.query(`
      SELECT c.*,
        rh.rate::numeric AS "currentRate",
        rh.currency       AS "currentCurrency",
        rh."dateFrom"     AS "rateSince",
        u.id IS NOT NULL  AS "hasLogin"
      FROM contractors c
      LEFT JOIN LATERAL (
        SELECT rate, currency, "dateFrom"
        FROM rate_history
        WHERE "contractorId" = c.id
          AND "dateFrom" <= CURRENT_DATE
          AND ("dateTo" IS NULL OR "dateTo" >= CURRENT_DATE)
        ORDER BY "dateFrom" DESC
        LIMIT 1
      ) rh ON true
      LEFT JOIN users u ON u.email = c.email AND u.role = 'executor'
      ORDER BY c."isActive" DESC, c.name ASC
    `);
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException();
    return item;
  }

  async create(dto: {
    name: string; type?: string; contact?: string;
    details?: string; currency?: string; email?: string; rate?: number; password?: string;
    parentContractorId?: number | null;
  }) {
    const { rate, password, ...contractorData } = dto;
    const contractor = await this.repo.save(this.repo.create(contractorData));

    if (rate !== undefined && rate !== null && !isNaN(Number(rate))) {
      await this.ratesRepo.save(this.ratesRepo.create({
        contractorId: contractor.id,
        rate: Number(rate),
        currency: contractor.currency || 'RUB',
        dateFrom: new Date().toISOString().split('T')[0],
      }));
    }

    if (contractor.email && password) {
      await this.upsertLinkedUser(contractor.name, contractor.email, password);
    }

    return contractor;
  }

  async update(id: number, dto: Partial<{
    name: string; type: string; contact: string;
    details: string; currency: string; email: string; isActive: boolean; rate: number; password: string;
    parentContractorId: number | null;
  }>) {
    const { rate, password, ...contractorData } = dto as any;
    const item = await this.findOne(id);
    const oldEmail = item.email;
    Object.assign(item, contractorData);
    await this.repo.save(item);

    if (rate !== undefined && rate !== null && !isNaN(Number(rate))) {
      await this.ratesRepo.save(this.ratesRepo.create({
        contractorId: id,
        rate: Number(rate),
        currency: item.currency || 'RUB',
        dateFrom: new Date().toISOString().split('T')[0],
      }));
    }

    // Rename linked user if email changed
    if (oldEmail && item.email && oldEmail !== item.email) {
      const existing = await this.usersRepo.findOne({ where: { email: oldEmail, role: UserRole.EXECUTOR } });
      if (existing) {
        existing.email = item.email;
        existing.fullName = item.name;
        await this.usersRepo.save(existing);
      }
    }

    // Update name on linked user if name changed
    if (item.email && !oldEmail) {
      // email was just set — no-op unless password provided
    } else if (item.email && contractorData.name) {
      const linked = await this.usersRepo.findOne({ where: { email: item.email, role: UserRole.EXECUTOR } });
      if (linked) { linked.fullName = item.name; await this.usersRepo.save(linked); }
    }

    // Update active status
    if (item.email && contractorData.isActive !== undefined) {
      const linked = await this.usersRepo.findOne({ where: { email: item.email, role: UserRole.EXECUTOR } });
      if (linked) { linked.isActive = contractorData.isActive; await this.usersRepo.save(linked); }
    }

    if (item.email && password) {
      await this.upsertLinkedUser(item.name, item.email, password);
    }

    return item;
  }

  // Reverse of upsertLinkedUser — called from UsersService when an executor is saved with
  // billing/Act fields filled in, so admin only ever has to use the "Пользователи системы" form
  // for the common case. Never touches login (that stays contractor-record-first, via
  // create()/update() above with an explicit password).
  async upsertContractorForUser(dto: {
    email: string; name: string; type?: string; rate?: number; currency?: string;
    legalDesignation?: string; contractNumber?: string; contractDate?: string | null;
  }) {
    let contractor = await this.repo.findOne({ where: { email: dto.email } });
    if (!contractor) {
      contractor = this.repo.create({
        name: dto.name, email: dto.email, type: dto.type || 'internal',
        currency: dto.currency || 'RUB', isActive: true,
      });
    } else {
      contractor.name = dto.name;
      if (dto.type) contractor.type = dto.type;
      if (dto.currency) contractor.currency = dto.currency;
    }
    if (dto.legalDesignation !== undefined) contractor.legalDesignation = dto.legalDesignation;
    if (dto.contractNumber !== undefined) contractor.contractNumber = dto.contractNumber;
    if (dto.contractDate !== undefined) contractor.contractDate = dto.contractDate;
    await this.repo.save(contractor);

    if (dto.rate !== undefined && dto.rate !== null && !isNaN(Number(dto.rate))) {
      await this.ratesRepo.save(this.ratesRepo.create({
        contractorId: contractor.id,
        rate: Number(dto.rate),
        currency: contractor.currency || 'RUB',
        dateFrom: new Date().toISOString().split('T')[0],
      }));
    }
    return contractor;
  }

  private async upsertLinkedUser(fullName: string, email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await this.usersRepo.findOne({ where: { email } });
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.fullName = fullName;
      if (existing.role !== UserRole.EXECUTOR) existing.role = UserRole.EXECUTOR;
      existing.isActive = true;
      await this.usersRepo.save(existing);
    } else {
      await this.usersRepo.save(this.usersRepo.create({
        fullName,
        email,
        passwordHash,
        role: UserRole.EXECUTOR,
        position: 'Подрядчик',
        isActive: true,
      }));
    }
  }

  getRates(contractorId: number) {
    return this.ratesRepo.find({ where: { contractorId }, order: { dateFrom: 'DESC' } });
  }

  addRate(dto: { contractorId: number; rate: number; currency: string; dateFrom: string; dateTo?: string }) {
    return this.ratesRepo.save(this.ratesRepo.create(dto));
  }

  async deleteRate(id: number) {
    await this.ratesRepo.delete(id);
  }

  async delete(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (item?.email) {
      await this.usersRepo.delete({ email: item.email, role: UserRole.EXECUTOR });
    }
    await this.repo.delete(id);
  }
}
