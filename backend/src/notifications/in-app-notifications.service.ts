import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InAppNotification } from './in-app-notification.entity';

@Injectable()
export class InAppNotificationsService {
  constructor(
    @InjectRepository(InAppNotification) private repo: Repository<InAppNotification>,
  ) {}

  async create(dto: { userId: number; title: string; body?: string; requestId?: number }) {
    return this.repo.save(this.repo.create(dto));
  }

  async getForUser(userId: number) {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async getUnreadCount(userId: number) {
    return this.repo.count({ where: { userId, isRead: false } });
  }

  async markRead(id: number, userId: number) {
    await this.repo.update({ id, userId }, { isRead: true });
    return { success: true };
  }

  async markAllRead(userId: number) {
    await this.repo.update({ userId, isRead: false }, { isRead: true });
    return { success: true };
  }
}
