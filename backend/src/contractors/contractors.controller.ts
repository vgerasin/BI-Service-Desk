import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ContractorsService } from './contractors.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

// Executors need read access too — ActGenerator (their own "Акт" cabinet) and TimeEntriesPage
// both call GET here. Mutations (including rates, which carry cost data) stay admin-only.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('contractors')
export class ContractorsController {
  constructor(private readonly service: ContractorsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  findAll() { return this.service.findAll(); }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.EXECUTOR)
  findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }

  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }
  @Get(':id/rates') getRates(@Param('id', ParseIntPipe) id: number) { return this.service.getRates(id); }
  @Post(':id/rates') addRate(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.addRate({ ...dto, contractorId: id });
  }
  @Delete('rates/:id') deleteRate(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteRate(id);
  }
  @Delete(':id') delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
