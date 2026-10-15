import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';

export enum UserRole {
  EXECUTOR = 'executor',
  ADMIN = 'admin',
  CUSTOMER = 'customer',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  fullName: string;

  @Column({ unique: true, length: 255 })
  email: string;

  // select:false: never returned by default find()/findOne()/relation-loading, so a hash can't
  // leak through any endpoint that serializes a User (assignee, createdBy, activity author,
  // GET /users, etc.) by accident — call sites that genuinely need it (login, password change)
  // must opt in via an explicit `select`.
  @Column({ length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 32, default: UserRole.EXECUTOR })
  role: UserRole;

  @Column({ nullable: true, length: 255 })
  position: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  customerId: number | null;

  // Stable user id from the SSO provider (see Settings → SSO). Null for local-password accounts.
  @Column({ nullable: true, unique: true, name: 'sso_subject', length: 255 })
  ssoSubject: string | null;

  // Team lead — set by admin only. Grants: visibility into subordinates' costs (Analytics →
  // Затраты) and the ability to generate a combined Act for the team (see acts.controller.ts).
  @Column({ nullable: true })
  managerId: number | null;

  // Resolved once the user completes the Telegram link flow (presses Start on the bot's deep
  // link) — this is the numeric chat id from the bot update, never a @username. The Bot API
  // has no way to message a user by username; without this, personal DMs are impossible. See
  // TelegramService.pollUpdates()/sendToUser().
  @Column({ nullable: true, length: 64 })
  telegramChatId: string | null;

  // One-time token embedded in the deep link (?start=<token>) while a link is pending;
  // cleared once pollUpdates() resolves it into telegramChatId above.
  @Column({ nullable: true, unique: true, length: 64 })
  telegramLinkToken: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
