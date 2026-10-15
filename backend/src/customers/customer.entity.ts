import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  department: string;

  @Column({ nullable: true, length: 255 })
  responsible: string;

  @Column({ nullable: true, length: 255 })
  contact: string;

  @Column({ nullable: true, length: 50 })
  phone: string;

  @Column({ nullable: true, length: 255 })
  email: string;

  @Column({ default: true })
  isActive: boolean;
}
