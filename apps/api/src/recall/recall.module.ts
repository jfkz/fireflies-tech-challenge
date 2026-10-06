import { Global, Module } from '@nestjs/common';
import { RecallClient } from './recall.client';

/** The Recall.ai client, for the API (send, leave) and the worker (import). */
@Global()
@Module({ providers: [RecallClient], exports: [RecallClient] })
export class RecallModule {}
