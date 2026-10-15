import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SeedService } from './seed/seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    console.log('🌱 Сидирование тестовых данных...\n');
    const result = await app.get(SeedService).run();
    if (result.skipped) {
      console.log(`⚠️  ${result.message}`);
      return;
    }
    console.log(`\n✅ Готово. Создано: ${result.summary}\n`);
    console.log('🔑 Логины для ручного тестирования:');
    console.table(result.credentials);
  } finally {
    await app.close();
  }
}

bootstrap().catch((e) => {
  console.error('❌ Сидирование упало:', e);
  process.exit(1);
});
