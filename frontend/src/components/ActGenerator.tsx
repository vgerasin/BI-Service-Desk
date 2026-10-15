import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Select, DatePicker, Input, Button, Table, Typography, Space, Card, Row, Col, Statistic, message,
} from 'antd';
import { DownloadOutlined, FileWordOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import api from '../api/client';
import { downloadFile } from '../api/downloadFile';
import { shortFullName, shortCompanyName } from '../utils/formatName';

// A contractor is either a person ("Фролов Максим Андреевич (ИП)") or a legal entity
// ("ООО «Дата Солюшнс»") — shortFullName's surname-plus-initials logic mangles the latter
// (and chokes on a person's trailing "(ИП)"/"(ООО)" tag), so branch on which one this is first.
function shortContractorLabel(name: string): string {
  if (name.includes('«')) return shortCompanyName(name);
  return shortFullName(name.replace(/\s*\([^)]*\)\s*$/, ''));
}

const { RangePicker } = DatePicker;

interface ActLineItem {
  label: string;
  hours: number;
  rate: number;
  sum: number;
  contractorId: number | null;
  contractorName: string | null;
}

interface ActContractorSummary {
  contractorId: number;
  contractorName: string;
  hours: number;
  sum: number;
}

interface ActPreview {
  contractors: { id: number; name: string }[];
  dateFrom: string;
  dateTo: string;
  items: ActLineItem[];
  byContractor: ActContractorSummary[];
  totalHours: number;
  totalSum: number;
  totalSumWords: string;
  totalKopecks: number;
}

// A synthetic row the grouped table renders in between two contractors' blocks — never sent by
// the API, built client-side from `byContractor` once items are grouped.
interface SubtotalRow {
  __subtotal: true;
  contractorName: string;
  hours: number;
  sum: number;
}

// Only worth grouping when there's more than one person to tell apart — for a single contractor
// (by far the common case: one's own cabinet, or a team lead billing just themselves) an
// "Исполнитель" column and a subtotal identical to the grand total below it would be pure noise.
function buildGroupedRows(preview: ActPreview): any[] | null {
  if (preview.byContractor.length <= 1) return null;

  const rows: any[] = [];
  let n = 0;
  for (const group of preview.byContractor) {
    const groupItems = preview.items.filter((i) => i.contractorId === group.contractorId);
    groupItems.forEach((item, idx) => {
      n += 1;
      rows.push({ ...item, __itemNumber: n, __execRowSpan: idx === 0 ? groupItems.length : 0 });
    });
    rows.push({ __subtotal: true, contractorName: group.contractorName, hours: group.hours, sum: group.sum } as SubtotalRow);
  }
  return rows;
}

interface Props {
  /** Fixed contractor — hides the picker (used in the contractor's own cabinet). */
  contractorId?: number;
  contractorName?: string;
  /** Team lead cabinet: restricts the multi-select to just this list instead of fetching the
   *  full company-wide /contractors (which the picker otherwise uses in the admin page). */
  fixedContractors?: { id: number; name: string }[];
}

export default function ActGenerator({ contractorId: fixedContractorId, contractorName, fixedContractors }: Props) {
  const [selectedContractorIds, setSelectedContractorIds] = useState<number[]>(
    fixedContractorId ? [fixedContractorId] : (fixedContractors?.map(c => c.id) ?? []),
  );
  const [billingCompanyId, setBillingCompanyId] = useState<number | undefined>(undefined);
  const [period, setPeriod] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [actDate, setActDate] = useState<Dayjs>(dayjs());
  const [city, setCity] = useState('');
  const [cityTouched, setCityTouched] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const contractorIds = fixedContractorId ? [fixedContractorId] : selectedContractorIds;
  const contractorIdsParam = contractorIds.join(',');

  // Picking a group's head contractor also pulls in the rest of the group — they're usually
  // billed together (see Contractor.parentContractorId).
  const handleContractorsChange = (ids: number[]) => {
    const newlyAdded = ids.filter((id) => !selectedContractorIds.includes(id));
    const groupMembers = newlyAdded.flatMap((id) =>
      contractors.filter((c: any) => c.parentContractorId === id).map((c: any) => c.id),
    );
    setSelectedContractorIds(Array.from(new Set([...ids, ...groupMembers])));
  };

  const { data: fetchedContractors = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => api.get('/contractors').then(r => r.data),
    enabled: !fixedContractorId && !fixedContractors,
  });
  const contractors = fixedContractors ?? fetchedContractors;

  const { data: billingCompanies = [] } = useQuery({
    queryKey: ['billing-companies'],
    queryFn: () => api.get('/billing-companies').then(r => r.data),
  });

  // Default to whichever company is marked "по умолчанию" once the list loads, and pick up its
  // city too — but only until the admin actually picks a company/types a city themselves.
  useEffect(() => {
    if (billingCompanyId === undefined && billingCompanies.length) {
      const def = billingCompanies.find((c: any) => c.isDefault) || billingCompanies[0];
      setBillingCompanyId(def.id);
    }
  }, [billingCompanies]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cityTouched) return;
    const selected = billingCompanies.find((c: any) => c.id === billingCompanyId);
    if (selected?.city) setCity(selected.city);
  }, [billingCompanyId, billingCompanies]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateFrom = period[0].format('YYYY-MM-DD');
  const dateTo = period[1].format('YYYY-MM-DD');

  const { data: preview, isFetching, error } = useQuery<ActPreview>({
    queryKey: ['act-preview', contractorIdsParam, billingCompanyId, dateFrom, dateTo],
    queryFn: () => api.get('/acts/preview', { params: { contractorIds: contractorIdsParam, billingCompanyId, dateFrom, dateTo } }).then(r => r.data),
    enabled: !!contractorIds.length && !!billingCompanyId,
  });

  const handleDownload = async () => {
    if (!contractorIds.length || !billingCompanyId) return;
    setDownloading(true);
    try {
      const name = (fixedContractorId ? contractorName : preview?.contractors.map(c => c.name).join(', ')) || 'Акт';
      await downloadFile(
        '/acts/download',
        `Акт_${name.replace(/[^\p{L}\p{N}]+/gu, '_')}_${dateFrom}_${dateTo}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        { contractorIds: contractorIdsParam, billingCompanyId, dateFrom, dateTo, actDate: actDate.format('YYYY-MM-DD'), city },
      );
    } catch {
      message.error('Не удалось сформировать акт');
    } finally {
      setDownloading(false);
    }
  };

  const columns = [
    { title: '№', width: 50, render: (_: any, __: any, i: number) => i + 1 },
    { title: 'Наименование выполненных работ', dataIndex: 'label' },
    { title: 'Ед.изм.', width: 80, align: 'center' as const, render: () => 'час' },
    { title: 'Кол-во', dataIndex: 'hours', width: 80, align: 'center' as const },
    {
      title: 'Цена, руб/ч', dataIndex: 'rate', width: 110, align: 'right' as const,
      render: (v: number) => v.toLocaleString('ru-RU'),
    },
    {
      title: 'Сумма, руб.', dataIndex: 'sum', width: 120, align: 'right' as const,
      render: (v: number) => v.toLocaleString('ru-RU'),
    },
  ];

  // Grouped view: an extra "Исполнитель" column (merged down each person's block via rowSpan)
  // plus a subtotal row closing each block — see `buildGroupedRows`. Every other column's
  // `onCell` collapses to a single wide label cell on a subtotal row (colSpan 5, rest colSpan 0),
  // the standard antd pattern for a full-width row inside an otherwise columnar table.
  const groupedColumns = [
    {
      title: '№', width: 50,
      render: (_: any, r: any) => (r.__subtotal ? '' : r.__itemNumber),
      onCell: (r: any) => (r.__subtotal ? { colSpan: 0 } : {}),
    },
    {
      title: 'Исполнитель', width: 130, dataIndex: 'contractorName',
      render: (v: string) => shortContractorLabel(v),
      onCell: (r: any) => (r.__subtotal ? { colSpan: 0 } : { rowSpan: r.__execRowSpan }),
    },
    {
      title: 'Наименование выполненных работ', dataIndex: 'label',
      render: (v: string, r: any) => (r.__subtotal ? <b>{`Подытог: ${r.contractorName}`}</b> : v),
      onCell: (r: any) => (r.__subtotal ? { colSpan: 4 } : {}),
    },
    {
      title: 'Ед.изм.', width: 70, align: 'center' as const, render: () => 'час',
      onCell: (r: any) => (r.__subtotal ? { colSpan: 0 } : {}),
    },
    {
      title: 'Кол-во', dataIndex: 'hours', width: 70, align: 'center' as const,
      render: (v: number, r: any) => (r.__subtotal ? <b>{v}</b> : v),
    },
    {
      title: 'Цена, руб/ч', dataIndex: 'rate', width: 100, align: 'right' as const,
      render: (v: number, r: any) => (r.__subtotal ? '' : v?.toLocaleString('ru-RU')),
    },
    {
      title: 'Сумма, руб.', dataIndex: 'sum', width: 120, align: 'right' as const,
      render: (v: number, r: any) => (r.__subtotal ? <b>{v.toLocaleString('ru-RU')}</b> : v.toLocaleString('ru-RU')),
    },
  ];

  const groupedRows = preview ? buildGroupedRows(preview) : null;

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12} align="start">
          {!fixedContractorId && (
            <Select
              mode="multiple"
              style={{ width: 340 }}
              placeholder="Выберите одного или нескольких подрядчиков"
              value={selectedContractorIds}
              onChange={handleContractorsChange}
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              options={contractors.map((c: any) => ({ value: c.id, label: c.name }))}
            />
          )}
          <Select
            style={{ width: 220 }}
            placeholder="Юрлицо-плательщик"
            value={billingCompanyId}
            onChange={setBillingCompanyId}
            options={billingCompanies.map((c: any) => ({ value: c.id, label: c.shortName || c.name }))}
          />
          <RangePicker
            format="DD.MM.YYYY"
            value={period}
            allowClear={false}
            presets={[
              { label: 'Этот месяц', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
              { label: 'Прошлый месяц', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            ]}
            onChange={(d) => { if (d && d[0] && d[1]) setPeriod([d[0], d[1]]); }}
          />
          <DatePicker
            format="DD.MM.YYYY"
            value={actDate}
            allowClear={false}
            onChange={(d) => d && setActDate(d)}
            placeholder="Дата акта"
          />
          <Input
            style={{ width: 160 }}
            addonBefore="г."
            value={city}
            onChange={(e) => { setCity(e.target.value); setCityTouched(true); }}
            placeholder="Город"
          />
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={downloading}
            disabled={!contractorIds.length || !billingCompanyId || !preview?.items.length}
            onClick={handleDownload}
          >
            Скачать акт (.docx)
          </Button>
        </Space>
      </Card>

      {!contractorIds.length && (
        <Typography.Text type="secondary">Выберите подрядчика, чтобы увидеть предпросмотр акта.</Typography.Text>
      )}

      {error && (
        <Typography.Text type="danger">Не удалось загрузить данные для акта.</Typography.Text>
      )}

      {!!contractorIds.length && preview && (
        <>
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small"><Statistic title="Позиций" value={preview.items.length} /></Card>
            </Col>
            <Col span={8}>
              <Card size="small"><Statistic title="Часов" value={preview.totalHours} /></Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="Сумма" value={preview.totalSum} precision={2} suffix="руб." />
              </Card>
            </Col>
          </Row>

          <Table
            rowKey={(_: any, i?: number) => String(i)}
            dataSource={groupedRows ?? preview.items}
            columns={groupedRows ? groupedColumns : columns}
            loading={isFetching}
            size="small"
            pagination={false}
            locale={{ emptyText: 'Нет трудозатрат за выбранный период' }}
            footer={() => (
              <Typography.Text strong>
                <FileWordOutlined style={{ marginRight: 6 }} />
                Всего выполнено работ на сумму: {preview.totalSum.toLocaleString('ru-RU')} ({preview.totalSumWords})
                руб. {String(preview.totalKopecks).padStart(2, '0')} копеек.
              </Typography.Text>
            )}
          />
        </>
      )}
    </div>
  );
}
