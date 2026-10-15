import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// The legal entity a piece of work is billed to — e.g. most dashboards go through one company,
// but another line of dashboards bills a different counterparty. Requests and
// reports_ref each carry a nullable billingCompanyId (see request.entity.ts / report-ref.entity.ts)
// pointing here; Acts uses this row's fields for the "Заказчик" side of the document instead of
// the old single global act_customer_* settings, which only ever supported one payer.
@Entity('billing_companies')
export class BillingCompany {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  // The brand people actually recognize (e.g. "Acme") — shown everywhere instead of the
  // full legal `name` (which overflows table cells / detail-card rows). Falls back to `name`
  // itself wherever it's still empty (e.g. right after this column was introduced).
  @Column({ nullable: true, length: 100 })
  shortName: string | null;

  @Column({ nullable: true, length: 100 })
  city: string | null;

  @Column({ nullable: true, length: 255 })
  directorPosition: string | null;

  @Column({ nullable: true, length: 255 })
  directorName: string | null;

  // The fallback every request/report gets when nobody explicitly picked a company — exactly one
  // row should have this set; enforced in BillingCompaniesService, not at the DB level.
  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
