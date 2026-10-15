import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('in_app_notifications')
export class InAppNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  userId: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string;

  @Column({ nullable: true })
  requestId: number;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
