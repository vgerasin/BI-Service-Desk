import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { BiRequest } from '../requests/request.entity';
import { User } from '../users/user.entity';
import { Contractor } from '../contractors/contractor.entity';

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  requestId: number;

  @ManyToOne(() => BiRequest, r => r.timeEntries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestId' })
  request: BiRequest;

  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  contractorId: number;

  @ManyToOne(() => Contractor, { nullable: true })
  @JoinColumn({ name: 'contractorId' })
  contractor: Contractor;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 6, scale: 2 })
  hours: number;

  @Column({ nullable: true, length: 100 })
  workKind: string;

  @Column({ nullable: true, type: 'text' })
  comment: string;

  @Column({ nullable: true, length: 255 })
  workName: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
