import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller('files')
export class FilesController {
  @Get(':filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    // Sanitize: no path traversal
    if (filename.includes('..') || filename.includes('/')) {
      throw new NotFoundException();
    }
    const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    const filePath = join(uploadDir, filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Файл не найден');
    }
    res.sendFile(filePath);
  }
}
