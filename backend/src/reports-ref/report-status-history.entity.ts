import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { ReportRef } from './report-ref.entity';

@Entity('report_status_history')
export class ReportStatusHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  reportId: number;

  @ManyToOne(() => ReportRef, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportId' })
  report: ReportRef;

  @Column({ length: 50 })
  oldStatus: string;

  @Column({ length: 50 })
  newStatus: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ nullable: true })
  changedById: number;

  @Column({ nullable: true, length: 255 })
  changedByName: string;

  @CreateDateColumn()
  createdAt: Date;
}
