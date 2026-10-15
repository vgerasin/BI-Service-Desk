import {
  Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query, UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KnownErrorsService } from './known-errors.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../users/user.entity';
import { ResolveRequestIdPipe } from '../requests/resolve-request-id.pipe';

// GET stays open to every authenticated role on purpose — RequestDetailPage.tsx fetches the KE
// list for any bug-type request regardless of who's viewing (admin, executor, or a customer in
// the portal), and linking a request to a KE happens from the same shared executor/admin card —
// only the actual KE record CRUD (KnownErrorsPage, admin-only nav item) is admin-restricted.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('known-errors')
export class KnownErrorsController {
  constructor(
    private readonly service: KnownErrorsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('status') status?: string) {
    return this.service.findAll(search, status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(':id/requests')
  getLinkedRequests(@Param('id', ParseIntPipe) id: number) {
    return this.service.getLinkedRequests(id, this.dataSource);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: any, @CurrentUser() user: User) {
    return this.service.create(dto, user.id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Post(':id/link/:requestId')
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  linkRequest(
    @Param('id', ParseIntPipe) id: number,
    @Param('requestId', ResolveRequestIdPipe) requestId: number,
  ) {
    return this.service.linkToRequest(id, requestId, this.dataSource);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
