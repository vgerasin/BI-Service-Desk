import {
  Controller, Get, Post, Res, Body, UseGuards,
  HttpCode, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('export')
  async exportAll(@Res() res: Response) {
    const data = await this.backupService.exportAll();
    const filename = `bi-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async importAll(@UploadedFile() file: Express.Multer.File) {
    const backup = JSON.parse(file.buffer.toString('utf-8'));
    await this.backupService.importAll(backup);
    return { message: 'Резервная копия успешно восстановлена' };
  }
}
