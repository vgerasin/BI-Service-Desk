import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dictionary } from './dictionary.entity';

const SEED_DATA = [
  // work_types
  { type: 'work_types', code: 'development', value: 'Разработка' },
  { type: 'work_types', code: 'improvement', value: 'Доработка' },
  { type: 'work_types', code: 'bugfix', value: 'Исправление (баг-фикс)' },
  { type: 'work_types', code: 'consultation', value: 'Консультация' },
  { type: 'work_types', code: 'other', value: 'Прочее' },
  // work_kinds
  { type: 'work_kinds', code: 'analysis', value: 'Анализ требований' },
  { type: 'work_kinds', code: 'modeling', value: 'Моделирование данных' },
  { type: 'work_kinds', code: 'etl', value: 'ETL / подготовка данных' },
  { type: 'work_kinds', code: 'visualization', value: 'Визуализация' },
  { type: 'work_kinds', code: 'testing', value: 'Тестирование' },
  { type: 'work_kinds', code: 'documentation', value: 'Документация' },
  { type: 'work_kinds', code: 'meetings', value: 'Встречи' },
  // priorities
  { type: 'priorities', code: 'critical', value: 'Критический' },
  { type: 'priorities', code: 'high', value: 'Высокий' },
  { type: 'priorities', code: 'medium', value: 'Средний' },
  { type: 'priorities', code: 'low', value: 'Низкий' },
  // data_sources
  { type: 'data_sources', code: 'db', value: 'База данных' },
  { type: 'data_sources', code: 'file', value: 'Файл' },
  { type: 'data_sources', code: 'api', value: 'API' },
  { type: 'data_sources', code: 'service', value: 'Сервис' },
  // sla_days — плановый срок по приоритету (в рабочих днях)
  { type: 'sla_days', code: 'critical', value: '2' },
  { type: 'sla_days', code: 'high', value: '5' },
  { type: 'sla_days', code: 'medium', value: '10' },
  { type: 'sla_days', code: 'low', value: '20' },
];

@Injectable()
export class DictionariesService {
  constructor(@InjectRepository(Dictionary) private repo: Repository<Dictionary>) {}

  async seedDefaults() {
    for (const item of SEED_DATA) {
      const exists = await this.repo.findOne({ where: { type: item.type, code: item.code } });
      if (!exists) {
        await this.repo.save(this.repo.create(item));
      }
    }
  }

  findAll(type?: string) {
    if (type) return this.repo.find({ where: { type, isActive: true }, order: { value: 'ASC' } });
    return this.repo.find({ order: { type: 'ASC', value: 'ASC' } });
  }

  create(dto: { type: string; code: string; value: string }) {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: number, dto: Partial<{ value: string; isActive: boolean }>) {
    await this.repo.update(id, dto);
    return this.repo.findOne({ where: { id } });
  }

  delete(id: number) { return this.repo.delete(id); }
}
