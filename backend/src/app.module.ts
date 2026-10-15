import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RequestsModule } from './requests/requests.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { CustomersModule } from './customers/customers.module';
import { ContractorsModule } from './contractors/contractors.module';
import { ReportsRefModule } from './reports-ref/reports-ref.module';
import { DictionariesModule } from './dictionaries/dictionaries.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BackupModule } from './backup/backup.module';
import { RatingsModule } from './ratings/ratings.module';
import { SettingsModule } from './settings/settings.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { FilesModule } from './files/files.module';
import { KnownErrorsModule } from './known-errors/known-errors.module';
import { EscalationModule } from './escalation/escalation.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { SeedModule } from './seed/seed.module';
import { ActsModule } from './acts/acts.module';
import { ReportOwnersModule } from './report-owners/report-owners.module';
import { DashboardRefreshLogsModule } from './dashboard-refresh-logs/dashboard-refresh-logs.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { EmployeesModule } from './employees/employees.module';
import { BillingCompaniesModule } from './billing-companies/billing-companies.module';
import { HealthController } from './common/health.controller';
import { runPreMigrations } from './database/pre-migrations';

@Module({
  controllers: [HealthController],
  providers: [AppService],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api/(.*)'],
      serveStaticOptions: {
        // Vite content-hashes everything under /assets — safe to cache for a year.
        // index.html (and everything else) keeps default headers since its URL never
        // changes between deploys, so it must be revalidated on every request.
        setHeaders: (res, filePath: string) => {
          if (filePath.split(/[/\\]/).includes('assets')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      },
    }),
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        await runPreMigrations(process.env.DATABASE_URL);
        return {
          type: 'postgres' as const,
          url: process.env.DATABASE_URL,
          autoLoadEntities: true,
          // There are no migration files yet: TypeORM keeps the schema in sync with the entities.
          // Set DB_SYNCHRONIZE=false once you manage the schema yourself.
          synchronize: process.env.DB_SYNCHRONIZE !== 'false',
          logging: false,
        };
      },
    }),
    AuthModule,
    UsersModule,
    RequestsModule,
    TimeEntriesModule,
    CustomersModule,
    ContractorsModule,
    ReportsRefModule,
    DictionariesModule,
    AnalyticsModule,
    BackupModule,
    RatingsModule,
    SettingsModule,
    DataSourcesModule,
    FilesModule,
    KnownErrorsModule,
    EscalationModule,
    ActivityLogsModule,
    SeedModule,
    ActsModule,
    ReportOwnersModule,
    DashboardRefreshLogsModule,
    TelegramBotModule,
    EmployeesModule,
    BillingCompaniesModule,
  ],
})
export class AppModule {}
