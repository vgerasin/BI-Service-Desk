import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionariesController } from './dictionaries.controller';
import { DictionariesService } from './dictionaries.service';
import { Dictionary } from './dictionary.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Dictionary])],
  controllers: [DictionariesController],
  providers: [DictionariesService],
  exports: [DictionariesService],
})
export class DictionariesModule {}
