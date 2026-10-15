import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const ActivityEvent = {
  LOGIN_SUCCESS:    'login_success',
  LOGIN_FAIL:       'login_fail',
  REQUEST_VIEWED:   'request_viewed',
  REQUEST_CREATED:  'request_created',
  STATUS_CHANGED:   'status_changed',
  PORTAL_SUBMIT:    'portal_submit',
  EXPORT_EXCEL:     'export_excel',
  REQUESTS_LINKED:  'requests_linked',
} as const;

export type ActivityEventType = typeof ActivityEvent[keyof typeof ActivityEvent];

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  userRole: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  userName: string;

  @Column({ type: 'varchar', length: 64 })
  event: string;

  @Column({ nullable: true })
  entityId: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  entityType: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  entityLabel: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, any>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string;

  @CreateDateColumn()
  createdAt: Date;
}
