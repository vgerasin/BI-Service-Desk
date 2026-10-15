import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Delete, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  // Executors need the list too — Analytics → Затраты (CostsTab) reads it, and that tab is
  // one of the few open to executors (see EXECUTOR_TAB_KEYS in AnalyticsPage.tsx).
  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  findAll() { return this.service.findAll(); }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }

  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }

  @Get(':id/portal-info')
  portalInfo(@Param('id', ParseIntPipe) id: number) { return this.service.getPortalInfo(id); }

  @Post(':id/portal-access')
  createPortalAccess(@Param('id', ParseIntPipe) id: number) { return this.service.createPortalAccess(id); }

  @Delete(':id/portal-access')
  revokePortalAccess(@Param('id', ParseIntPipe) id: number) { return this.service.revokePortalAccess(id); }
}
