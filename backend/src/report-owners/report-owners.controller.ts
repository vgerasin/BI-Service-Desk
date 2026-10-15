import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ReportOwnersService } from './report-owners.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

// Only ReportEditModal (admin-only context, opened from ReportsRegistryPage) ever calls this —
// safely admin-only end to end.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('report-owners')
export class ReportOwnersController {
  constructor(private readonly service: ReportOwnersService) {}

  @Get() findAll() { return this.service.findAll(); }

  @Post() create(@Body('fullName') fullName: string) { return this.service.create(fullName); }

  @Put(':id/link')
  setLink(@Param('id', ParseIntPipe) id: number, @Body('userId') userId: number | null) {
    return this.service.setUserLink(id, userId);
  }
}
