import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { ReportRef } from './report-ref.entity';

@Entity('report_versions')
export class ReportVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  reportId: number;

  @ManyToOne(() => ReportRef, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportId' })
  report: ReportRef;

  /** Заявка, по которой внесено изменение (может отсутствовать для исторических записей) */
  @Column({ nullable: true })
  requestId: number;

  @Column({ nullable: true, length: 50 })
  version: string;

  @Column({ type: 'text', nullable: true })
  changeSummary: string;

  @CreateDateColumn()
  createdAt: Date;
}
