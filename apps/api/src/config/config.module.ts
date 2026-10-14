import { DynamicModule, Global, Module } from '@nestjs/common';
import { emulatorEnabled, parseEnv, type Env } from './env';

/** Typed, validated configuration. Inject it and read `config.env.X`. */
export class AppConfig {
  constructor(readonly env: Env) {}

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get firebaseEmulator(): boolean {
    return emulatorEnabled(this.env);
  }

  isAdmin(email: string | null): boolean {
    return !!email && this.env.ADMIN_EMAILS.includes(email.toLowerCase());
  }
}

@Global()
@Module({})
export class ConfigModule {
  /** Validates `process.env` (plus overrides, for tests) once at boot. */
  static forRoot(overrides: Record<string, string | undefined> = {}): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: AppConfig, useFactory: () => new AppConfig(parseEnv({ ...process.env, ...overrides })) }],
      exports: [AppConfig],
    };
  }
}
