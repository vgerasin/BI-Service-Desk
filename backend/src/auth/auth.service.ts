import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SsoService } from './sso.service';
import { IntegrationsService } from '../settings/integrations.service';
import { ActivityLogsService, ActivityEvent } from '../activity-logs/activity-logs.service';
import { ReportOwnersService } from '../report-owners/report-owners.service';
import { TelegramService } from '../settings/telegram.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private jwtService: JwtService,
    private notifications: NotificationsService,
    private sso: SsoService,
    private integrations: IntegrationsService,
    private activityLogs: ActivityLogsService,
    private reportOwners: ReportOwnersService,
    private telegram: TelegramService,
  ) {}

  private issueToken(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role, customerId: user.customerId ?? undefined };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id, fullName: user.fullName, email: user.email,
        role: user.role, position: user.position,
        customerId: user.customerId ?? undefined,
        managerId: user.managerId ?? undefined,
      },
    };
  }

  async login(login: string, password: string, ip?: string) {
    const localUser = await this.usersRepo.findOne({
      where: { email: login },
      select: {
        id: true, fullName: true, email: true, passwordHash: true, role: true,
        position: true, isActive: true, customerId: true, managerId: true,
      },
    });

    // Local user with a password: authenticate locally only (fast path, no LDAP)
    if (localUser && localUser.passwordHash) {
      if (!localUser.isActive) throw new UnauthorizedException('Пользователь неактивен');
      const valid = await bcrypt.compare(password, localUser.passwordHash).catch(() => false);
      if (!valid) {
        void this.activityLogs.log({ event: ActivityEvent.LOGIN_FAIL, userName: login, ip });
        throw new UnauthorizedException('Неверный логин или пароль');
      }
      void this.activityLogs.log({
        event: ActivityEvent.LOGIN_SUCCESS,
        userId: localUser.id, userRole: localUser.role, userName: localUser.fullName, ip,
      });
      return this.issueToken(localUser);
    }

    void this.activityLogs.log({ event: ActivityEvent.LOGIN_FAIL, userName: login, ip });
    throw new UnauthorizedException('Неверный логин или пароль');
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { email, isActive: true } });
    if (!user) return;

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const newPassword = Array.from({ length: 10 }, () =>
      chars[Math.floor(Math.random() * chars.length)],
    ).join('');

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.save(user);

    await this.notifications.sendPasswordReset({
      to: user.email,
      toName: user.fullName,
      newPassword,
    });
  }

  async me(userId: number) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    return {
      id: user.id, fullName: user.fullName, email: user.email,
      role: user.role, position: user.position,
      customerId: user.customerId ?? undefined,
      managerId: user.managerId ?? undefined,
      telegramLinked: !!user.telegramChatId,
    };
  }

  telegramLink(userId: number) {
    return this.telegram.generateLinkToken(userId);
  }

  async telegramUnlink(userId: number) {
    await this.telegram.unlink(userId);
    return { success: true };
  }

  ssoPublicConfig() {
    return this.integrations.getSsoPublic();
  }

  async ssoCallback(code: string, redirectUri: string) {
    const accessToken = await this.sso.exchangeCode(code, redirectUri);
    return this.ssoUpsertUser(accessToken);
  }

  private async ssoUpsertUser(accessToken: string) {
    const profile = await this.sso.getProfile(accessToken);
    const cfg = await this.integrations.getSso();

    const fullName = profile.fullName;
    const email = profile.email ?? `sso_${profile.subject.slice(0, 8)}@sso.local`;
    // ADMIN_EMAIL (env) always gets the admin role when signing in through SSO.
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const isPinnedAdmin = !!adminEmail && email.toLowerCase() === adminEmail;

    let user = await this.usersRepo.findOne({ where: { ssoSubject: profile.subject } })
      ?? await this.usersRepo.findOne({ where: { email } });

    if (!user) {
      user = this.usersRepo.create({
        ssoSubject: profile.subject,
        email,
        fullName,
        position: profile.position ?? undefined,
        passwordHash: null,
        role: isPinnedAdmin ? UserRole.ADMIN : (cfg.defaultRole === 'executor' ? UserRole.EXECUTOR : UserRole.CUSTOMER),
        isActive: true,
      });
    } else {
      if (!user.isActive) throw new UnauthorizedException('Пользователь неактивен');
      user.ssoSubject = profile.subject;
      user.fullName = fullName;
      // Only overwrite if the provider actually returned one — never clobber a manually-set position.
      if (profile.position) user.position = profile.position;
      if (isPinnedAdmin) user.role = UserRole.ADMIN;
    }

    await this.usersRepo.save(user);
    // Collapse any free-standing "Владелец (бизнес)" reference entry with the same name into
    // this account, right as it becomes real (see report-owners.service.ts).
    void this.reportOwners.autoLinkUser(user.fullName, user.id);
    // "Заявитель другой" (see RequestsService.create / EmployeesService) lets staff file a
    // request on behalf of someone pulled from the HR directory who doesn't have a login yet —
    // stored as onBehalfOfName/Email, not a real createdById. The moment that same person shows
    // up here via SSO, re-point those requests at their real account by matching email, so they
    // land in "Мои заявки" and start getting Telegram/in-app notifications like any other
    // request they'd filed themselves — not just email. Idempotent: after the first successful
    // link the on-behalf columns are cleared, so later logins find nothing left to match.
    await this.linkOnBehalfRequests(user);
    // SSO is the primary login path for most accounts — without this, "last login" / inactive
    // user tracking in Analytics → Активность only ever saw local-password logins and showed
    // everyone as "never logged in".
    void this.activityLogs.log({
      event: ActivityEvent.LOGIN_SUCCESS,
      userId: user.id, userRole: user.role, userName: user.fullName,
    });
    return this.issueToken(user);
  }

  private async linkOnBehalfRequests(user: User): Promise<void> {
    if (!user.email) return;
    const matches: { id: number; number: string; name: string }[] = await this.usersRepo.manager.query(`
      SELECT id, number, name FROM requests
      WHERE "onBehalfOfEmail" IS NOT NULL AND LOWER("onBehalfOfEmail") = LOWER($1)
    `, [user.email]);
    if (!matches.length) return;

    const ids = matches.map(m => m.id);
    await this.usersRepo.manager.query(`
      UPDATE requests SET "createdById" = $1, "onBehalfOfName" = NULL, "onBehalfOfEmail" = NULL
      WHERE id = ANY($2)
    `, [user.id, ids]);

    for (const m of matches) {
      await this.usersRepo.manager.query(`
        INSERT INTO activities ("requestId", "authorId", action)
        VALUES ($1, $2, $3)
      `, [m.id, user.id, `Заявитель связан с профилем «${user.fullName}» через вход по SSO`]);
    }

    void this.activityLogs.log({
      event: ActivityEvent.REQUESTS_LINKED,
      userId: user.id, userRole: user.role, userName: user.fullName,
      meta: { requestNumbers: matches.map(m => m.number) },
    });
  }

  async updateMe(userId: number, dto: {
    fullName?: string;
    email?: string;
    position?: string;
    currentPassword?: string;
    newPassword?: string;
  }) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, passwordHash: true, role: true, position: true,
      },
    });
    if (!user) throw new UnauthorizedException();

    if (dto.newPassword) {
      if (!dto.currentPassword) throw new UnauthorizedException('Укажите текущий пароль');
      if (!user.passwordHash) throw new UnauthorizedException('Смена пароля недоступна для SSO-пользователей');
      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash).catch(() => false);
      if (!valid) throw new UnauthorizedException('Неверный текущий пароль');
      user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.email && dto.email !== user.email) {
      const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
      if (exists) throw new ConflictException('Email уже занят другим пользователем');
      user.email = dto.email;
    }
    if (dto.position !== undefined) user.position = dto.position;

    await this.usersRepo.save(user);
    return { id: user.id, fullName: user.fullName, email: user.email, role: user.role, position: user.position };
  }
}
