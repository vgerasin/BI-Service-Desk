import { Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { SeedService } from './seed.service';

/**
 * Not behind JwtAuthGuard on purpose — there's no admin session available for one-off scripting.
 * Gated by a shared secret instead: fails closed (403) unless SEED_SECRET is set and matches.
 * Meant to be invoked once after a fresh deploy, then SEED_SECRET removed from the environment.
 */
@Controller('admin')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @Post('seed')
  async seed(@Headers('x-seed-secret') secret: string) {
    const expected = process.env.SEED_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException();
    }
    return this.seedService.run();
  }
}
