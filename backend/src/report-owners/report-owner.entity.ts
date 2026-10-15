import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Reference list for "Владелец (бизнес, п.2.1)" in the reports registry — most business owners
// don't have a login yet. `userId` links to a real account once one exists for this person
// (matched by exact fullName in AppService.onModuleInit and on every SSO login), so a name that
// starts as free-standing reference data "collapses" into the same identity once they log in.
@Entity('report_owners')
export class ReportOwner {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 255 })
  fullName: string;

  @Column({ nullable: true })
  userId: number | null;
}
