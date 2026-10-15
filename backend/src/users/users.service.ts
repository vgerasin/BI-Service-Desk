import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from './user.entity';
import { RateHistory } from './rate-history.entity';
import { ContractorsService } from '../contractors/contractors.service';

interface ActFields {
  contractorType?: string; contractorRate?: number; contractorCurrency?: string;
  legalDesignation?: string; contractNumber?: string; contractDate?: string | null;
}

// Deliberately excludes contractorCurrency — the form defaults it to 'RUB' even when the admin
// never touches the "Данные для актов" block, so it alone must not create a stub Contractor for
// every executor. A real value in any of these means the block was actually used.
const ACT_TRIGGER_KEYS: (keyof ActFields)[] = [
  'contractorType', 'contractorRate', 'legalDesignation', 'contractNumber', 'contractDate',
];

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(RateHistory) private ratesRepo: Repository<RateHistory>,
    private contractorsService: ContractorsService,
  ) {}

  async findAll() {
    return this.usersRepo.find({ order: { fullName: 'ASC' } });
  }

  async findOne(id: number) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  /** Direct reports only (no multi-level hierarchy — matches the flat team-lead use case). */
  async getSubordinates(userId: number): Promise<User[]> {
    return this.usersRepo.find({ where: { managerId: userId } });
  }

  // Executor + any "Данные для актов" field filled in → keeps the linked Contractor record
  // (rate/legal wording/contract ref) in sync, so admin never has to open "Подрядчики" for the
  // common case of a single person with a login. See ContractorsService.upsertContractorForUser.
  private async syncContractor(user: User, fields: ActFields) {
    if (user.role !== UserRole.EXECUTOR || !user.email) return;
    if (!ACT_TRIGGER_KEYS.some((k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== '')) return;
    await this.contractorsService.upsertContractorForUser({
      email: user.email,
      name: user.fullName,
      type: fields.contractorType,
      rate: fields.contractorRate,
      currency: fields.contractorCurrency,
      legalDesignation: fields.legalDesignation,
      contractNumber: fields.contractNumber,
      contractDate: fields.contractDate,
    });
  }

  async create(dto: {
    fullName: string; email: string; password: string;
    role: UserRole; position?: string;
  } & ActFields) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email уже используется');
    const { contractorType, contractorRate, contractorCurrency, legalDesignation, contractNumber, contractDate, ...userDto } = dto;
    const passwordHash = await bcrypt.hash(userDto.password, 10);
    const user = this.usersRepo.create({ ...userDto, passwordHash });
    const saved = await this.usersRepo.save(user);
    await this.syncContractor(saved, { contractorType, contractorRate, contractorCurrency, legalDesignation, contractNumber, contractDate });
    // save() returns the same in-memory instance we just set passwordHash on — select:false only
    // hides the column on fetches, so the freshly-hashed value must be stripped here by hand.
    delete (saved as any).passwordHash;
    return saved;
  }

  async update(id: number, dto: Partial<{
    fullName: string; email: string; role: UserRole; position: string; isActive: boolean; password: string;
    managerId: number | null;
  } & ActFields>) {
    const user = await this.findOne(id);
    if (dto.email && dto.email !== user.email) {
      const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
      if (exists) throw new ConflictException('Email уже используется другим пользователем');
    }
    const { contractorType, contractorRate, contractorCurrency, legalDesignation, contractNumber, contractDate, ...userDto } = dto;
    if (userDto.password) {
      (user as any).passwordHash = await bcrypt.hash(userDto.password, 10);
      delete userDto.password;
    }
    Object.assign(user, userDto);
    const saved = await this.usersRepo.save(user);
    await this.syncContractor(saved, { contractorType, contractorRate, contractorCurrency, legalDesignation, contractNumber, contractDate });
    delete (saved as any).passwordHash;
    return saved;
  }

  async getRates(userId: number) {
    return this.ratesRepo.find({
      where: { userId },
      order: { dateFrom: 'DESC' },
    });
  }

  async addRate(dto: {
    userId?: number; contractorId?: number; rate: number; currency?: string; dateFrom: string; dateTo?: string;
  }) {
    const entry = this.ratesRepo.create(dto);
    return this.ratesRepo.save(entry);
  }

  async deleteRate(id: number) {
    await this.ratesRepo.delete(id);
  }

  async delete(id: number) {
    await this.usersRepo.delete(id);
  }

  // First run: create an administrator. ADMIN_EMAIL / ADMIN_PASSWORD come from .env; without
  // ADMIN_PASSWORD a random password is generated and printed to the log once.
  // Later runs: if ADMIN_EMAIL is set and that account exists, make sure it is an active admin
  // (handy when the first admin signs in through SSO and would otherwise start as a customer).
  async seedAdmin() {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
    const count = await this.usersRepo.count();
    if (count === 0) {
      const email = adminEmail || 'admin@example.com';
      const generated = !process.env.ADMIN_PASSWORD;
      const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
      await this.usersRepo.save(
        this.usersRepo.create({
          fullName: 'Администратор',
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: UserRole.ADMIN,
          isActive: true,
          position: 'Администратор системы',
        }),
      );
      console.log(
        `[setup] Создан администратор ${email}` +
        (generated ? ` с временным паролем: ${password} — смените его после первого входа` : ''),
      );
      return;
    }
    if (adminEmail) {
      const admin = await this.usersRepo.findOne({ where: { email: adminEmail } });
      if (admin && (admin.role !== UserRole.ADMIN || !admin.isActive)) {
        admin.role = UserRole.ADMIN;
        admin.isActive = true;
        await this.usersRepo.save(admin);
      }
    }
  }
}
