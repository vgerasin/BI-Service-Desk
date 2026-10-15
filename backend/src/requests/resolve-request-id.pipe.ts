import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { DataSource } from 'typeorm';

// URLs now show a request's human-facing `number` (e.g. "1050"), not its internal `id` — but
// every link already sent out before this change (email notifications, Telegram messages, old
// bookmarks/browser history) still points at the raw id, and can't be rewritten after the fact.
// This resolves either transparently: `number` is tried first (the canonical form going
// forward — see request.entity.ts, a separate unique sequence from `id`), falling back to a
// literal id match so nothing already shared stops working.
@Injectable()
export class ResolveRequestIdPipe implements PipeTransform<string, Promise<number>> {
  constructor(private dataSource: DataSource) {}

  async transform(value: string): Promise<number> {
    const byNumber = await this.dataSource.query(`SELECT id FROM requests WHERE number = $1`, [value]);
    if (byNumber.length) return byNumber[0].id;

    const asInt = Number(value);
    if (!Number.isInteger(asInt) || asInt <= 0) throw new NotFoundException('Заявка не найдена');
    return asInt;
  }
}
