import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable, ManyToOne, JoinColumn } from 'typeorm';
import { DataSource } from '../data-sources/data-source.entity';
import { BillingCompany } from '../billing-companies/billing-company.entity';

@Entity('reports_ref')
export class ReportRef {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  // Владелец дашборда со стороны бизнеса (Паспорт п.2.1) — legacy free-text, kept as a
  // display fallback for entries created before ownerId linking existed.
  @Column({ nullable: true, length: 255 })
  owner: string;

  // Owner linked to a real user account (users.id) — takes priority over `owner` text when set.
  @Column({ nullable: true })
  ownerId: number | null;

  // Which legal entity this dashboard's work bills to — see billing-companies module. Adopted
  // from the request that created it (RequestsService.changeStatus's DONE-transition publish
  // step); every improvement/bugfix request against this dashboard afterwards inherits it, so the
  // executor only has to pick a company once per dashboard, not per request.
  @Column({ nullable: true })
  billingCompanyId: number | null;

  @ManyToOne(() => BillingCompany, { nullable: true })
  @JoinColumn({ name: 'billingCompanyId' })
  billingCompany: BillingCompany | null;

  // Технический владелец — BI-разработчик (Паспорт п.2.2)
  @Column({ nullable: true, length: 255 })
  techOwner: string;

  // Владелец данных (Паспорт п.2.3)
  @Column({ nullable: true, length: 255 })
  dataOwner: string;

  @Column({ nullable: true, length: 500 })
  pbiLink: string;

  @Column({ nullable: true, length: 255 })
  workspace: string;

  // Среда: dev / test / prod (Паспорт п.1.5)
  @Column({ nullable: true, length: 20, default: 'prod' })
  environment: string;

  // Версия отчёта (Паспорт п.1.7)
  @Column({ nullable: true, length: 50 })
  version: string;

  @Column({ nullable: true, length: 255 })
  dataSource: string;

  // Частота обновления данных (Паспорт п.4.3)
  @Column({ nullable: true, length: 255 })
  updateFrequency: string;

  // SLA на восстановление обновления в часах (Паспорт п.4.5)
  @Column({ nullable: true })
  slaRefreshHours: number;

  // Настроен RLS (Паспорт п.5.2)
  @Column({ default: false })
  hasRLS: boolean;

  // Целевая аудитория (Паспорт п.3.1)
  @Column({ nullable: true, type: 'text' })
  targetAudience: string;

  // Количество пользователей (Паспорт п.3.2)
  @Column({ nullable: true })
  userCount: number;

  // Сценарий использования (Паспорт п.3.3)
  @Column({ nullable: true, length: 500 })
  useCase: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ default: 'active', length: 50 })
  status: string;

  // Чек-лист качества пройден (Паспорт п.6.2)
  @Column({ default: false })
  checklistDone: boolean;

  // Протокол тестирования подписан (Паспорт п.6.3)
  @Column({ default: false })
  protocolSigned: boolean;

  // Дата ввода в эксплуатацию / публикации (Паспорт п.1.6)
  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date;

  // Заявка, по которой создан/обновлён дашборд
  @Column({ nullable: true })
  requestId: number;

  @ManyToMany(() => DataSource, ds => ds.reports, { eager: false })
  @JoinTable({ name: 'report_data_sources' })
  dataSources: DataSource[];
}
