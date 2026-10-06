import type { ApiError } from '@boringtalks/shared';

// Its own module, free of runtime imports from @boringtalks/shared (a CommonJS
// package that can't be tree-shaken), so the root providers can use it without
// pulling the schemas and zod into every page.
/** A non-2xx answer from the API, or a body that did not match the contract. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiError | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
