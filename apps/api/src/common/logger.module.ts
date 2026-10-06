import { Module } from '@nestjs/common';
import { LoggerModule as PinoModule } from 'nestjs-pino';
import { AppConfig } from '../config/config.module';

/** Structured JSON logs (pretty in development); auth headers are redacted. */
@Module({
  imports: [
    PinoModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: { ignore: (req) => req.url === '/health' },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          ...(config.env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
