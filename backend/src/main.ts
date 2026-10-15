import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { DictionariesService } from './dictionaries/dictionaries.service';

async function bootstrap() {
  // Compression must wrap the underlying Express instance before Nest wires up
  // ServeStaticModule (which registers express.static during module init, i.e. before
  // app.use() calls made later in this function would ever run) — otherwise the static
  // file responses (the multi-MB JS bundle) bypass compression entirely.
  const server = express();
  server.use(compression());
  // Express/body-parser defaults to a 100kb JSON body limit. New-request screenshots have no
  // requestId yet to upload against, so RichEditor embeds them as base64 directly in the
  // description HTML and submits it as part of the create-request JSON body — one screenshot
  // alone routinely blows past 100kb, several guarantees it. bodyParser: false below hands
  // parsing fully to these explicit limits instead of Nest's own (smaller) default.
  server.use(express.json({ limit: '20mb' }));
  server.use(express.urlencoded({ extended: true, limit: '20mb' }));
  // Every /api/* response must reflect the current DB state, never a stale cached one — this bit
  // twice already with no per-route fix in common (a downloaded Act's filename, then the ratings
  // analytics numbers): a GET response with no explicit Cache-Control is fair game for the
  // browser's own heuristic caching, so hitting the same query again — after a deploy, or just
  // after the underlying data changed — can silently show stale data. Scoped to /api only; the
  // static JS/CSS bundle (content-hashed filenames) should stay cacheable.
  server.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(server), { bodyParser: false });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The built frontend is served by this same app, so CORS is only needed for a separately hosted
  // frontend: list its origins in CORS_ORIGIN (comma-separated).
  const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : false });

  // Seed default data
  const usersService = app.get(UsersService);
  await usersService.seedAdmin();

  const dictService = app.get(DictionariesService);
  await dictService.seedDefaults();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API: http://localhost:${port}/api`);
}
bootstrap();
