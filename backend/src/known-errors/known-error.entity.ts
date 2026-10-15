import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum KnownErrorStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  WONT_FIX = 'wont_fix',
}

@Entity('known_errors')
export class KnownError {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  symptoms: string;

  @Column({ type: 'text', nullable: true })
  workaround: string;

  @Column({ type: 'text', nullable: true })
  rootCause: string;

  @Column({ type: 'text', nullable: true })
  affectedReports: string;

  @Column({ type: 'enum', enum: KnownErrorStatus, default: KnownErrorStatus.OPEN })
  status: KnownErrorStatus;

  @Column({ length: 20, nullable: true })
  priority: string;

  @Column({ nullable: true })
  createdById: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
