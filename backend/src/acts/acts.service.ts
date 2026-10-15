import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell,
  TableLayoutType, TableRow, TabStopType, TabStopPosition, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { Contractor } from '../contractors/contractor.entity';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { BillingCompany } from '../billing-companies/billing-company.entity';
import { numberToWordsRu } from '../common/number-to-words-ru';

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatDateQuoted(dateStr: string): string {
  const d = new Date(dateStr);
  return `«${String(d.getUTCDate()).padStart(2, '0')}» ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}г.`;
}

function formatDatePlain(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}г`;
}

// Executors sometimes paste a dashboard/report link into workName or comment for their own
// reference — that has no place in a signed acceptance act, and as one unbroken token it also
// forces the "Наименование" column wider than its fixed width, throwing off every column to its
// right. Stripped before the label is built, not just cosmetically at render time.
function stripLinks(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s*https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export interface ActLineItem {
  label: string;
  hours: number;
  rate: number;
  sum: number;
  contractorId: number | null;
  contractorName: string | null;
}

export interface ActContractorSummary {
  contractorId: number;
  contractorName: string;
  hours: number;
  sum: number;
}

export interface ActContext {
  // Several contractor records can legally represent one counterparty (e.g. a self-employed
  // "Исполнитель" whose 3-4 people each log time under their own contractor login) — an act
  // combines all of them without splitting the work table by person. The first contractor's
  // legal wording/contract reference is used for the "Исполнитель" clause.
  contractors: Contractor[];
  billingCompany: BillingCompany;
  dateFrom: string;
  dateTo: string;
  actDate: string;
  city: string;
  customerName: string;
  customerDirectorPosition: string;
  customerDirectorName: string;
  items: ActLineItem[];
  byContractor: ActContractorSummary[];
  totalHours: number;
  totalSum: number;
  totalRubles: number;
  totalKopecks: number;
  totalSumWords: string;
}

@Injectable()
export class ActsService {
  constructor(
    @InjectRepository(Contractor) private contractorsRepo: Repository<Contractor>,
    @InjectRepository(BillingCompany) private billingCompaniesRepo: Repository<BillingCompany>,
    private timeEntries: TimeEntriesService,
  ) {}

  async findContractorByEmail(email: string): Promise<Contractor | null> {
    return this.contractorsRepo.findOne({ where: { email } });
  }

  async findContractorsByEmails(emails: string[]): Promise<Contractor[]> {
    if (!emails.length) return [];
    return this.contractorsRepo.find({ where: { email: In(emails) } });
  }

  async getContractor(id: number): Promise<Contractor> {
    const contractor = await this.contractorsRepo.findOne({ where: { id } });
    if (!contractor) throw new NotFoundException('Подрядчик не найден');
    return contractor;
  }

  async getContractors(ids: number[]): Promise<Contractor[]> {
    const contractors = await this.contractorsRepo.find({ where: { id: In(ids) } });
    if (contractors.length !== ids.length) throw new NotFoundException('Подрядчик не найден');
    // Preserve the caller's order — contractors[0] drives the "Исполнитель" clause.
    return ids.map((id) => contractors.find((c) => c.id === id)!);
  }

  async buildContext(params: {
    contractorIds: number[]; billingCompanyId: number;
    dateFrom: string; dateTo: string; actDate?: string; city?: string;
  }): Promise<ActContext> {
    const contractors = await this.getContractors(params.contractorIds);
    const billingCompany = await this.billingCompaniesRepo.findOne({ where: { id: params.billingCompanyId } });
    if (!billingCompany) throw new NotFoundException('Юрлицо-плательщик не найдено');

    const rowSets = await Promise.all(params.contractorIds.map((contractorId) => this.timeEntries.findAll({
      contractorId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      billingCompanyId: params.billingCompanyId,
    })));

    const items: ActLineItem[] = rowSets
      .flat()
      // chronological across all selected contractors — te.date comes back as a Date object from pg
      .sort((a: any, b: any) => (new Date(a.date).getTime() - new Date(b.date).getTime()) || a.id - b.id)
      .map((r: any) => {
        // Requests without a linked dashboard (reportId null) fall back to the request's own
        // title. Older entries logged before workName/workKind existed only have a free-text
        // comment — still worth showing, since it's the only thing distinguishing them from
        // sibling entries on the same request.
        const dashboard = stripLinks(r.dashboardName) || stripLinks(r.requestName);
        const work = stripLinks(r.workName) || stripLinks(r.workKind) || stripLinks(r.comment);
        const label = work ? `${dashboard} - ${work}` : dashboard;
        return {
          label,
          hours: Number(r.hours),
          rate: Number(r.rate),
          sum: Number(r.cost),
          // Every row in rowSets[i] was fetched with `contractorId: params.contractorIds[i]`, so
          // this is always the contractor that generated the row — kept per-item (rather than
          // just returned as a summary) so the preview can group/label the same detail table the
          // .docx renders from, without the two ever disagreeing on which row belongs to whom.
          contractorId: r.contractorId ?? null,
          contractorName: r.contractorName ?? null,
        };
      });

    const totalHours = items.reduce((s, i) => s + i.hours, 0);
    const totalSum = Math.round(items.reduce((s, i) => s + i.sum, 0) * 100) / 100;
    const totalRubles = Math.trunc(totalSum);
    const totalKopecks = Math.round((totalSum - totalRubles) * 100);

    // Per-contractor subtotal, in the same order as the picker/act clause (contractors[0] drives
    // the "Исполнитель" wording) — not alphabetical, so it lines up with how the rest of the page
    // already orders people. Kept even for a contractor with zero hours this period (no filter) —
    // dropping them made the grouped view silently fall back to the flat table whenever only one
    // of several *selected* contractors actually logged anything, which looked like "grouping is
    // broken" from picking several people rather than "everyone else logged nothing this period".
    const byContractor: ActContractorSummary[] = contractors.map((c) => {
      const own = items.filter((i) => i.contractorId === c.id);
      return {
        contractorId: c.id,
        contractorName: c.name,
        hours: own.reduce((s, i) => s + i.hours, 0),
        sum: Math.round(own.reduce((s, i) => s + i.sum, 0) * 100) / 100,
      };
    });

    return {
      contractors,
      billingCompany,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      actDate: params.actDate || params.dateTo,
      city: params.city || billingCompany.city || '',
      customerName: billingCompany.name,
      customerDirectorPosition: billingCompany.directorPosition || '',
      customerDirectorName: billingCompany.directorName || '',
      items,
      byContractor,
      totalHours,
      totalSum,
      totalRubles,
      totalKopecks,
      totalSumWords: numberToWordsRu(totalRubles),
    };
  }

  async renderDocx(ctx: ActContext): Promise<Buffer> {
    const primary = ctx.contractors[0];
    const contractNumber = primary.contractNumber || 'б/н';
    const contractDateLine = primary.contractDate
      ? formatDateQuoted(primary.contractDate)
      : '«___» __________ ____г.';
    const executorLine = primary.legalDesignation || primary.name;

    const borders = {
      top: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
    };

    // DXA (twentieths of a point); sums to 9360 = the usable width of a Letter page (12240) under
    // the 1440-twip (1in) margins set below. docx only respects fixed widths in Word when every
    // cell in every row carries its own matching `width` — columnWidths on the Table alone is
    // just a hint that AUTO layout (the default) overrides once a cell's content needs more room,
    // which is exactly what pushed the price/sum columns out of alignment once labels grew longer.
    const COL_WIDTHS = [500, 5560, 700, 700, 900, 1000];
    const cellWidth = (dxa: number) => ({ size: dxa, type: WidthType.DXA });

    const headerCell = (text: string, width: number) => new TableCell({
      borders,
      width: cellWidth(width),
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, size: 18 })],
      })],
    });

    const bodyCell = (text: string, width: number, alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT) => new TableCell({
      borders,
      width: cellWidth(width),
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ alignment, children: [new TextRun({ text, size: 18 })] })],
    });

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('№ п/п', COL_WIDTHS[0]), headerCell('Наименование выполненных работ', COL_WIDTHS[1]),
        headerCell('Ед.изм.', COL_WIDTHS[2]), headerCell('Кол-во', COL_WIDTHS[3]),
        headerCell('Цена, руб/ч', COL_WIDTHS[4]), headerCell('Сумма, руб.', COL_WIDTHS[5]),
      ],
    });

    const itemRows = ctx.items.map((item, idx) => new TableRow({
      children: [
        bodyCell(String(idx + 1), COL_WIDTHS[0], AlignmentType.CENTER),
        bodyCell(item.label, COL_WIDTHS[1]),
        bodyCell('час', COL_WIDTHS[2], AlignmentType.CENTER),
        bodyCell(String(item.hours), COL_WIDTHS[3], AlignmentType.CENTER),
        bodyCell(item.rate.toLocaleString('ru-RU'), COL_WIDTHS[4], AlignmentType.RIGHT),
        bodyCell(item.sum.toLocaleString('ru-RU'), COL_WIDTHS[5], AlignmentType.RIGHT),
      ],
    }));

    const totalRow = new TableRow({
      children: [
        new TableCell({
          borders, columnSpan: 5, verticalAlign: VerticalAlign.CENTER,
          width: cellWidth(COL_WIDTHS[0] + COL_WIDTHS[1] + COL_WIDTHS[2] + COL_WIDTHS[3] + COL_WIDTHS[4]),
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'ИТОГО', bold: true, size: 18 })],
          })],
        }),
        new TableCell({
          borders, verticalAlign: VerticalAlign.CENTER,
          width: cellWidth(COL_WIDTHS[5]),
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: ctx.totalSum.toLocaleString('ru-RU'), bold: true, size: 18 })],
          })],
        }),
      ],
    });

    const doc = new Document({
      sections: [{
        // 1in margins on a Letter page → 9360 twips usable width, matching COL_WIDTHS above.
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'АКТ', bold: true, size: 28 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'приема-передачи оказанных услуг', size: 22 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({
              text: `по договору оказания услуг от ${contractDateLine} № ${contractNumber}`,
              size: 22,
            })],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 200 },
            children: [
              new TextRun({ text: `г. ${ctx.city}`, size: 20 }),
              new TextRun({ text: `\t${formatDatePlain(ctx.actDate)}`, size: 20 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
            children: [new TextRun({
              text: `${ctx.customerName}, именуемое в дальнейшем «Заказчик», в лице ${ctx.customerDirectorPosition} `
                + `${ctx.customerDirectorName}, с одной стороны и ${executorLine}, именуемый в дальнейшем «Исполнитель», `
                + 'с другой стороны составили настоящий акт о нижеследующем.',
              size: 20,
            })],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
            children: [new TextRun({
              text: `Исполнителем выполнены, а Заказчиком приняты по договору оказания услуг от `
                + `${contractDateLine} № ${contractNumber} следующие работы.`,
              size: 20,
            })],
          }),
          new Table({
            width: { size: COL_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            columnWidths: COL_WIDTHS,
            layout: TableLayoutType.FIXED,
            rows: [headerRow, ...itemRows, totalRow],
          }),
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [new TextRun({
              text: `Всего выполнено работ на сумму: ${ctx.totalSum.toLocaleString('ru-RU')} `
                + `(${ctx.totalSumWords}) руб. ${String(ctx.totalKopecks).padStart(2, '0')} копеек.`,
              bold: true, size: 20,
            })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: 'НДС не облагается.', bold: true, size: 20 })],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: 'Вышеперечисленные услуги выполнены полностью и в срок.', size: 20 })],
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [new TextRun({
              text: 'Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.',
              size: 20,
            })],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 600 },
            children: [
              new TextRun({ text: 'Исполнитель', bold: true, size: 20 }),
              new TextRun({ text: '\tЗаказчик', bold: true, size: 20 }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({ text: '__________________/', size: 20 }),
              new TextRun({ text: '\t__________________/', size: 20 }),
            ],
          }),
        ],
      }],
    });

    return Packer.toBuffer(doc);
  }
}
