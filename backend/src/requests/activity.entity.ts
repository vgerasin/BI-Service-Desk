import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { BiRequest } from './request.entity';
import { User } from '../users/user.entity';

@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  requestId: number;

  @ManyToOne(() => BiRequest, r => r.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestId' })
  request: BiRequest;

  @Column({ nullable: true })
  authorId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'authorId' })
  author: User;

  @Column({ length: 255 })
  action: string;

  @Column({ nullable: true, type: 'text' })
  details: string;

  @CreateDateColumn()
  createdAt: Date;
}
