import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Customer } from './customer.entity';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { getAppUrl } from '../common/app-config';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer) private repo: Repository<Customer>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private notifications: NotificationsService,
  ) {}

  findAll() { return this.repo.find({ order: { department: 'ASC' } }); }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException();
    return item;
  }

  create(dto: { department: string; responsible?: string; contact?: string; phone?: string; email?: string }) {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: number, dto: Partial<{ department: string; responsible: string; contact: string; phone: string; email: string; isActive: boolean }>) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async getPortalInfo(customerId: number) {
    const portalUser = await this.usersRepo.findOne({
      where: { customerId, role: UserRole.CUSTOMER },
    });
    return {
      hasPortalAccess: !!portalUser,
      portalEmail: portalUser?.email ?? null,
      portalFullName: portalUser?.fullName ?? null,
      portalUserId: portalUser?.id ?? null,
      portalIsActive: portalUser?.isActive ?? null,
    };
  }

  async createPortalAccess(customerId: number) {
    const customer = await this.findOne(customerId);

    if (!customer.email) {
      throw new BadRequestException('У заказчика не указан email — укажите его перед созданием доступа');
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const password = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    const existing = await this.usersRepo.findOne({ where: { customerId, role: UserRole.CUSTOMER } });

    if (existing) {
      existing.passwordHash = await bcrypt.hash(password, 10);
      existing.isActive = true;
      existing.fullName = customer.responsible || customer.department;
      existing.email = customer.email;
      await this.usersRepo.save(existing);
    } else {
      const emailTaken = await this.usersRepo.findOne({ where: { email: customer.email } });
      if (emailTaken) {
        throw new BadRequestException(`Email ${customer.email} уже занят другим пользователем`);
      }
      const user = this.usersRepo.create({
        email: customer.email,
        fullName: customer.responsible || customer.department,
        passwordHash: await bcrypt.hash(password, 10),
        role: UserRole.CUSTOMER,
        customerId,
        isActive: true,
      });
      await this.usersRepo.save(user);
    }

    const appUrl = getAppUrl();
    await this.notifications.sendPortalInvite({
      to: customer.email,
      toName: customer.responsible || customer.department,
      department: customer.department,
      login: customer.email,
      password,
      portalUrl: appUrl,
    }).catch(() => {});

    return { ok: true, email: customer.email, password };
  }

  async revokePortalAccess(customerId: number) {
    const user = await this.usersRepo.findOne({ where: { customerId, role: UserRole.CUSTOMER } });
    if (!user) throw new NotFoundException('Портальный доступ не найден');
    user.isActive = false;
    await this.usersRepo.save(user);
    return { ok: true };
  }
}
