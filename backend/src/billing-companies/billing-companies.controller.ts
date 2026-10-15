import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { BillingCompaniesService } from './billing-companies.service';
import { BillingCompany } from './billing-company.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('billing-companies')
export class BillingCompaniesController {
  constructor(private readonly service: BillingCompaniesService) {}

  // Executors need this list too — they're the ones picking a company when taking a new-dashboard
  // request into work (see RequestsPage.tsx).
  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: Partial<BillingCompany>) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<BillingCompany>) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
