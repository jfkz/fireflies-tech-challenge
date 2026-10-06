import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ApiError } from '@boringtalks/shared';
import type { z } from 'zod';

/** Validates a body/query/param with a shared zod schema; failures become a 400 `ApiError`. */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<S> {
    // Express 5 leaves req.body undefined when a request has no body.
    const input = value === undefined && metadata?.type === 'body' ? {} : value;
    const result = this.schema.safeParse(input);
    if (result.success) return result.data;
    throw validationError(result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
}

export function validationError(issues: NonNullable<ApiError['issues']>): BadRequestException {
  const body: ApiError = { statusCode: 400, message: 'Validation failed', issues };
  return new BadRequestException(body);
}
