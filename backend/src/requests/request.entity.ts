import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Customer } from '../customers/customer.entity';
import { Contractor } from '../contractors/contractor.entity';
import { ReportRef } from '../reports-ref/report-ref.entity';
import { BillingCompany } from '../billing-companies/billing-company.entity';
import { TimeEntry } from '../time-entries/time-entry.entity';
import { Artifact } from './artifact.entity';
import { Activity } from './activity.entity';

export enum RequestStatus {
  NEW = 'new',
  CLARIFICATION = 'clarification',
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  WAITING_CUSTOMER = 'waiting_customer',
  REVIEW = 'review',
  APPROVAL = 'approval',
  REWORK = 'rework',
  DONE = 'done',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum RequestType {
  DEVELOPMENT = 'development',
  IMPROVEMENT = 'improvement',
  BUGFIX = 'bugfix',
  CONSULTATION = 'consultation',
  OTHER = 'other',
}

export enum Priority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ImpactLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('requests')
export class BiRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  number: string;

  @Column({ type: 'enum', enum: RequestType })
  type: RequestType;

  @Column({ length: 500 })
  name: string;

  @Column({ type: 'enum', enum: RequestStatus, default: RequestStatus.NEW })
  status: RequestStatus;

  @Column({ type: 'enum', enum: Priority, default: Priority.MEDIUM })
  priority: Priority;

  @Column({ nullable: true })
  customerId: number;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ nullable: true })
  reportId: number;

  @ManyToOne(() => ReportRef, { nullable: true })
  @JoinColumn({ name: 'reportId' })
  report: ReportRef;

  @Column({ nullable: true })
  assigneeId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigneeId' })
  assignee: User;

  @Column({ nullable: true })
  contractorId: number;

  @ManyToOne(() => Contractor, { nullable: true })
  @JoinColumn({ name: 'contractorId' })
  contractor: Contractor;

  // Which legal entity this work bills to (see billing-companies module) — inherited from the
  // dashboard (report.billingCompanyId) once one exists, or picked by the executor directly when
  // there's no report yet (a brand-new dashboard request). Defaults to the system's default
  // company at creation time so this is always set, not just for the non-default cases.
  @Column({ nullable: true })
  billingCompanyId: number | null;

  @ManyToOne(() => BillingCompany, { nullable: true })
  @JoinColumn({ name: 'billingCompanyId' })
  billingCompany: BillingCompany | null;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  plannedHours: number;

  @Column({ type: 'date', nullable: true })
  plannedDate: string;

  @Column({ nullable: true })
  createdById: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  // "Заявитель другой" — набор через HR-справочник (см. EmployeesService), не обязательно User
  // системы, поэтому имя/email хранятся как есть, а не ссылкой на users. Когда заданы, все
  // адресованные заявителю уведомления (создание, смена статуса) идут сюда, а не createdBy.
  @Column({ nullable: true, length: 255 })
  onBehalfOfName: string | null;

  @Column({ nullable: true, length: 255 })
  onBehalfOfEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date;

  @Column({ length: 100, nullable: true })
  closeReason: string;

  @Column({ type: 'smallint', nullable: true })
  rating: number;

  @Column({ type: 'text', nullable: true })
  ratingComment: string;

  // ── ITIL fields ──────────────────────────────────────────────────────────

  /** Business impact level — set by requester */
  @Column({ length: 20, nullable: true })
  impact: string;

  /** Urgency level — set by requester */
  @Column({ length: 20, nullable: true })
  urgency: string;

  /** Affected users count — for bugs/incidents */
  @Column({ type: 'int', nullable: true })
  affectedUsers: number;

  /** Steps to reproduce — for bugfix type */
  @Column({ type: 'text', nullable: true })
  stepsToReproduce: string;

  /** Expected behavior — for bugfix */
  @Column({ type: 'text', nullable: true })
  expectedBehavior: string;

  /** Actual behavior — for bugfix */
  @Column({ type: 'text', nullable: true })
  actualBehavior: string;

  /** Environment where bug occurs */
  @Column({ length: 100, nullable: true })
  environment: string;

  /** Workaround available (yes/no/partial) */
  @Column({ length: 50, nullable: true })
  workaround: string;

  /** Data sources to use — for development */
  @Column({ type: 'text', nullable: true })
  dataSources: string;

  /** Target audience description — for development */
  @Column({ type: 'text', nullable: true })
  targetAudience: string;

  /** Refresh frequency — for development */
  @Column({ length: 100, nullable: true })
  refreshFrequency: string;

  /** When request entered WAITING_CUSTOMER status — excluded from SLA calculation */
  @Column({ type: 'timestamp', nullable: true })
  waitingForCustomerSince: Date;

  /** Total seconds spent waiting for customer — added back to SLA deadline */
  @Column({ type: 'int', default: 0 })
  waitingForCustomerSeconds: number;

  /** Link to Known Error record */
  @Column({ type: 'int', nullable: true })
  knownErrorId: number;

  /** Accepted by customer at this timestamp */
  @Column({ type: 'timestamp', nullable: true })
  acceptedByCustomerAt: Date;

  @OneToMany(() => TimeEntry, te => te.request, { cascade: true })
  timeEntries: TimeEntry[];

  @OneToMany(() => Artifact, a => a.request, { cascade: true })
  artifacts: Artifact[];

  @OneToMany(() => Activity, a => a.request, { cascade: true })
  activities: Activity[];
}
