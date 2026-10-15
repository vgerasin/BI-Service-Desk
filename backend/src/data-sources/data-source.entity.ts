import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToMany } from 'typeorm';
import { ReportRef } from '../reports-ref/report-ref.entity';

export enum DataSourceType {
  DB = 'db',
  EXCEL = 'excel',
  GOOGLE_DOC = 'google_doc',
  API = 'api',
  OTHER = 'other',
}

export enum DbEngine {
  MSSQL = 'mssql',
  POSTGRESQL = 'postgresql',
  ORACLE = 'oracle',
  MYSQL = 'mysql',
  OTHER = 'other',
}

@Entity('data_sources')
export class DataSource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, nullable: true })
  code: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'enum', enum: DataSourceType, default: DataSourceType.DB })
  type: DataSourceType;

  @Column({ type: 'enum', enum: DbEngine, nullable: true })
  dbEngine: DbEngine | null;

  @Column({ length: 255, nullable: true })
  dbServer: string;

  @Column({ length: 255, nullable: true })
  dbName: string;

  @Column({ type: 'text', nullable: true })
  url: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToMany(() => ReportRef, report => report.dataSources)
  reports: ReportRef[];
}
