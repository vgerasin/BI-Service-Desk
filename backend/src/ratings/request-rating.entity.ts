import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export interface CsiAnswer {
  key: string;
  answer: 'yes' | 'no' | 'other';
  text?: string;
}

@Entity('request_ratings')
export class RequestRating {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  requestId: number;

  @Column({ unique: true, length: 100 })
  token: string;

  // Star-rating era (quality/speed/communication/compliance/overall, 1-5 each) — kept only so
  // ratings submitted before the CSI switch keep their original per-criterion breakdown; new
  // submissions leave these null and write `answers` instead.
  @Column({ type: 'smallint', nullable: true })
  quality: number;

  @Column({ type: 'smallint', nullable: true })
  speed: number;

  @Column({ type: 'smallint', nullable: true })
  communication: number;

  @Column({ type: 'smallint', nullable: true })
  compliance: number;

  @Column({ type: 'smallint', nullable: true })
  overall: number;

  // CSI era — 5 yes/no/other answers to the questions in frontend/src/csiQuestions.ts. "other"
  // carries free text and scores the same as "no" (see RatingsService.submitSurvey).
  @Column({ type: 'jsonb', nullable: true })
  answers: CsiAnswer[] | null;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  avgScore: number;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
