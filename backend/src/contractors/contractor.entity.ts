import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('contractors')
export class Contractor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ nullable: true, length: 50 })
  type: string; // individual | organization

  @Column({ nullable: true, length: 255 })
  contact: string;

  @Column({ nullable: true, type: 'text' })
  details: string;

  @Column({ default: 'RUB', length: 10 })
  currency: string;

  @Column({ nullable: true, length: 255 })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  // Legal wording used in the "Исполнитель" clause of generated acts,
  // e.g. "Плательщик налога на профессиональный доход Иванов Руслан Андреевич".
  // Free text because self-employed / ИП / ООО phrasing varies too much for an enum.
  @Column({ nullable: true, type: 'text' })
  legalDesignation: string;

  @Column({ nullable: true, length: 100 })
  contractNumber: string;

  @Column({ nullable: true, type: 'date' })
  contractDate: string;

  // Groups several contractor logins under one external counterparty (e.g. a self-employed
  // "Исполнитель" whose 3-4 people each log time under their own contractor login) — set by
  // admin only, shown as a tree on the Подрядчики page, and used to preselect the whole group
  // when generating an Act.
  @Column({ nullable: true })
  parentContractorId: number | null;
}
