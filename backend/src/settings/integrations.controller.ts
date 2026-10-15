import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { IntegrationsService } from './integrations.service';

/** Settings → integrations. Admin only, except /features (any signed-in user). */
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('features')
  features() {
    return this.integrations.getFeatures();
  }

  @Get('sso')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  getSso() { return this.integrations.getSsoForAdmin(); }

  @Put('sso')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  async saveSso(@Body() body: any) { await this.integrations.saveSso(body); return { success: true }; }

  @Get('hr-directory')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  getHr() { return this.integrations.getHrForAdmin(); }

  @Put('hr-directory')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  async saveHr(@Body() body: any) { await this.integrations.saveHr(body); return { success: true }; }

  @Get('smtp')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  getSmtp() { return this.integrations.getSmtpForAdmin(); }

  @Put('smtp')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  async saveSmtp(@Body() body: any) { await this.integrations.saveSmtp(body); return { success: true }; }

  @Get('dashboard-refresh')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  getRefresh() { return this.integrations.getRefreshForAdmin(); }

  @Put('dashboard-refresh')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  async saveRefresh(@Body() body: any) { await this.integrations.saveRefresh(body); return { success: true }; }

  @Post('dashboard-refresh/rotate-secret')
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN)
  async rotateRefreshSecret() { return { secret: await this.integrations.rotateRefreshSecret() }; }
}
