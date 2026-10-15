import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get('status')
  status() {
    return this.service.getStatus();
  }

  // Settings → «База сотрудников» → «Проверить подключение» (uses the form values if given).
  @Post('test-connection')
  @HttpCode(200)
  testConnection(@Body() body: any) {
    return this.service.testConnection(body);
  }

  // Powers "Сотрудники" — departments/divisions tree, no employees (see by-department for those).
  @Get('structure')
  structure() {
    return this.service.getStructure();
  }

  // People inside one department node (clicking a tree node) — including those without an email,
  // unlike search/search-all below.
  @Get('by-department')
  byDepartment(@Query('code') code?: string) {
    if (!code) return [];
    return this.service.findByDepartment(code);
  }

  // The right-hand list on "Сотрудники" when the search box has a name in it — substring match,
  // no email requirement (this is "who's in the company", not a contact picker).
  @Get('search-all')
  searchAll(@Query('q') q?: string) {
    if (!q || q.trim().length < 2) return [];
    return this.service.searchAll(q);
  }

  // Also used by the "Заявитель другой" picker on Requests → Новая заявка — any staff member
  // filing a request on a colleague's behalf needs this lookup, not just admins (overrides the
  // controller-level @Roles(ADMIN) above — RolesGuard uses getAllAndOverride, method wins).
  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  search(@Query('q') q?: string) {
    if (!q || q.trim().length < 2) return [];
    return this.service.search(q);
  }

  // Manual patch for someone the HR export has no email for (see employee_email_overrides) —
  // admin-only, same as the rest of this controller (no method-level @Roles override needed).
  @Post(':inn/email')
  async setEmail(@Param('inn') inn: string, @Body('email') email: string) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Некорректный email');
    }
    await this.service.setEmailOverride(inn, email.trim());
    return { success: true };
  }
}
