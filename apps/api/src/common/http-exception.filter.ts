import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@boringtalks/shared';
import type { Response } from 'express';

/** Every error leaves the API as `ApiError`: `{ statusCode, message, issues? }`. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    res.status(body.statusCode).json(body);
  }
}

export function toApiError(exception: unknown): ApiError {
  if (!(exception instanceof HttpException)) {
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === 'string') return { statusCode, message: response };
  const r = response as { message?: unknown; issues?: ApiError['issues'] };
  const message = Array.isArray(r.message) ? r.message.join('; ') : typeof r.message === 'string' ? r.message : exception.message;
  return r.issues ? { statusCode, message, issues: r.issues } : { statusCode, message };
}
