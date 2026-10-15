import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('dictionaries')
export class Dictionary {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  type: string; // work_types, work_kinds, data_sources, etc.

  @Column({ length: 100 })
  code: string;

  @Column({ length: 255 })
  value: string;

  @Column({ default: true })
  isActive: boolean;
}
