import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { DictionariesService } from './dictionaries.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

// Only DictionariesPage.tsx (admin-only nav item) ever calls this — SLA thresholds and work-type
// lists aren't read anywhere in an executor/customer-facing flow, so this is safely admin-only
// end to end, unlike contractors/reports-ref/known-errors below which need GET open wider.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly service: DictionariesService) {}

  @Get() findAll(@Query('type') type?: string) { return this.service.findAll(type); }
  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') delete(@Param('id', ParseIntPipe) id: number) { return this.service.delete(id); }
}
