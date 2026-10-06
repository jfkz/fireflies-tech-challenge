import { join } from 'node:path';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

process.loadEnvFile(join(__dirname, '..', '.env.test'));
Logger.overrideLogger(false);
