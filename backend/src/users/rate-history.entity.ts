import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Contractor } from '../contractors/contractor.entity';

@Entity('rate_history')
export class RateHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  contractorId: number;

  @ManyToOne(() => Contractor, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contractorId' })
  contractor: Contractor;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  rate: number;

  @Column({ default: 'RUB', length: 10 })
  currency: string;

  @Column({ type: 'date' })
  dateFrom: string;

  @Column({ type: 'date', nullable: true })
  dateTo: string;
}
