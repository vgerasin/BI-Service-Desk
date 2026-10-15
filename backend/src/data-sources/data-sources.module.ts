import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from './data-source.entity';
import { DataSourcesService } from './data-sources.service';
import { DataSourcesController } from './data-sources.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DataSource])],
  providers: [DataSourcesService],
  controllers: [DataSourcesController],
  exports: [DataSourcesService],
})
export class DataSourcesModule {}
