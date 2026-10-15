import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { BiRequest } from './request.entity';
import { User } from '../users/user.entity';

export enum ArtifactType {
  GRIF = 'grif',
  REQUIREMENTS = 'requirements',
  GRAPHICS = 'graphics',
  OTHER = 'other',
}

@Entity('artifacts')
export class Artifact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  requestId: number;

  @ManyToOne(() => BiRequest, r => r.artifacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestId' })
  request: BiRequest;

  @Column({ length: 500 })
  originalFilename: string;

  @Column({ length: 500 })
  storedFilename: string;

  @Column({ nullable: true, length: 100 })
  mimeType: string;

  @Column({ default: 0 })
  size: number;

  @Column({ length: 20, default: 'other' })
  artifactType: ArtifactType;

  @Column({ nullable: true })
  uploadedById: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'uploadedById' })
  uploadedBy: User;

  @CreateDateColumn()
  createdAt: Date;
}
