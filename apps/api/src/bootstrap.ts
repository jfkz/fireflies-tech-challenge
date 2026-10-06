import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './config/config.module';

/** HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get(AppConfig);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '25mb' });
  app.enableCors({
    origin: config.env.WEB_ORIGINS.length > 0 ? config.env.WEB_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}
