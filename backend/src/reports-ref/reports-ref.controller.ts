import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ReportsRefService } from './reports-ref.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/user.entity';

// GET stays open to every authenticated role — the dashboard/report picker in the request
// creation form is used by заявитель, исполнитель, and администратор alike (see RequestsPage,
// PortalRequestsPage, RequestDetailPage). Only the registry CRUD (ReportsRegistryPage,
// admin-only nav item) is restricted.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports-ref')
export class ReportsRefController {
  constructor(private readonly service: ReportsRefService) {}

  @Get() findAll() { return this.service.findAll(); }
  @Get(':id/versions') getVersions(@Param('id', ParseIntPipe) id: number) { return this.service.getVersions(id); }
  @Get(':id/status-history') getStatusHistory(@Param('id', ParseIntPipe) id: number) { return this.service.getStatusHistory(id); }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: any) { return this.service.create(dto); }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: User) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
