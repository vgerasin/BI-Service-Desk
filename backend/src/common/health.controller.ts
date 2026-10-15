import { Controller, Get } from '@nestjs/common';

/** Unauthenticated liveness probe used by the Docker healthcheck. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
