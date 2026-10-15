import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { RequestRating, CsiAnswer } from './request-rating.entity';

const CSI_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5'];

interface SurveyAnswers {
  answers: CsiAnswer[];
  comment?: string;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(RequestRating)
    private ratingsRepo: Repository<RequestRating>,
    private dataSource: DataSource,
  ) {}

  async createForRequest(requestId: number): Promise<RequestRating> {
    const existing = await this.ratingsRepo.findOne({ where: { requestId } });
    if (existing) return existing;

    const rating = this.ratingsRepo.create({ requestId, token: randomUUID() });
    return this.ratingsRepo.save(rating);
  }

  async getSurveyByToken(token: string) {
    const rating = await this.ratingsRepo.findOne({ where: { token } });
    if (!rating) throw new NotFoundException('Опрос не найден');

    const rows = await this.dataSource.query(
      `SELECT number, name FROM requests WHERE id = $1 LIMIT 1`,
      [rating.requestId],
    );

    return { ...rating, request: rows[0] || null };
  }

  async submitSurvey(token: string, dto: SurveyAnswers) {
    const rating = await this.ratingsRepo.findOne({ where: { token } });
    if (!rating) throw new NotFoundException('Опрос не найден');
    if (rating.submittedAt) throw new BadRequestException('Опрос уже пройден');

    if (!Array.isArray(dto.answers) || CSI_KEYS.some(k => !dto.answers.find(a => a.key === k))) {
      throw new BadRequestException('Ответьте на все вопросы');
    }
    for (const a of dto.answers) {
      if (!['yes', 'no'].includes(a.answer)) {
        throw new BadRequestException('Некорректный ответ на вопрос');
      }
    }

    // «Да» = 1, «нет» = 0 — Да/Нет обязательны на каждый вопрос, комментарий — опциональная
    // заметка к любому из двух, а не отдельный третий ответ (раньше «свой вариант» тоже считался
    // за 0, даже когда текст комментария был по сути положительным — см. csiQuestions.ts).
    const score = dto.answers.filter(a => a.answer === 'yes').length;

    Object.assign(rating, {
      answers: dto.answers,
      comment: dto.comment || null,
      avgScore: score,
      submittedAt: new Date(),
    });

    await this.ratingsRepo.save(rating);

    await this.dataSource.query(
      `UPDATE requests SET rating = $1, "ratingComment" = $2 WHERE id = $3`,
      [score, dto.comment || null, rating.requestId],
    );

    return rating;
  }

  async getForRequest(requestId: number) {
    return this.ratingsRepo.findOne({ where: { requestId } });
  }

  async getAvgStats() {
    const result = await this.ratingsRepo
      .createQueryBuilder('r')
      .select('ROUND(AVG(r.avgScore)::numeric, 1)', 'avg_rating')
      .addSelect('COUNT(*)', 'rated_count')
      .where('r.submittedAt IS NOT NULL')
      .getRawOne();
    return {
      avgRating: result?.avg_rating ? Number(result.avg_rating) : null,
      ratedCount: Number(result?.rated_count || 0),
    };
  }
}
