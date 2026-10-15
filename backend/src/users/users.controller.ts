import {
  Body, Controller, Delete, Get, Param, ParseIntPipe,
  Post, Put, UseGuards,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { UsersService } from './users.service';
import { User, UserRole } from './user.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// "Данные для актов" — mirrors the Подрядчики form, synced to a linked Contractor record
// server-side (see UsersService.syncContractor) so admin doesn't need the other screen.
class ActFieldsDto {
  @IsOptional() @IsString() contractorType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() contractorRate?: number;
  @IsOptional() @IsString() contractorCurrency?: string;
  @IsOptional() @IsString() legalDesignation?: string;
  @IsOptional() @IsString() contractNumber?: string;
  @IsOptional() @IsString() contractDate?: string | null;
}

class CreateUserDto extends ActFieldsDto {
  @IsString() fullName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsEnum(UserRole) role: UserRole;
  @IsOptional() @IsString() position?: string;
}

class UpdateUserDto extends ActFieldsDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsString() position?: string;
  @IsOptional() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @Type(() => Number) @IsNumber() managerId?: number | null;
}

class RateDto {
  @IsOptional() @Type(() => Number) userId?: number;
  @IsOptional() @Type(() => Number) contractorId?: number;
  @IsNumber() @Type(() => Number) rate: number;
  @IsOptional() @IsString() currency?: string;
  @IsString() @IsNotEmpty() dateFrom: string;
  @IsOptional() @IsString() dateTo?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.usersService.findAll();
  }

  // Any authenticated user's own direct reports (users.managerId) — no @Roles, so it's not
  // admin-only: this is what lets a team lead see who they can hand a request off to. Trimmed
  // to id/fullName since, unlike the admin-only endpoints below, the caller isn't an admin.
  // Must stay above @Get(':id') — otherwise ":id" would greedily match "my-subordinates".
  @Get('my-subordinates')
  async mySubordinates(@CurrentUser() user: User) {
    const subordinates = await this.usersService.getSubordinates(user.id);
    return subordinates.map((u) => ({ id: u.id, fullName: u.fullName }));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Get(':id/rates')
  @Roles(UserRole.ADMIN)
  getRates(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getRates(id);
  }

  @Post('rates')
  @Roles(UserRole.ADMIN)
  addRate(@Body() dto: RateDto) {
    return this.usersService.addRate(dto);
  }

  @Delete('rates/:id')
  @Roles(UserRole.ADMIN)
  deleteRate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.deleteRate(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.delete(id);
  }
}
