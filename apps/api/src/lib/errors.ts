// Typed HTTP errors thrown by services/routes and rendered by app.ts's central
// error handler into the canonical `{ error: { code, message, details? } }`
// envelope (04 §1.3). Keeps handlers thin: throw, don't format.
import type { ApiErrorCode, FieldError } from "@assay/shared";
import type { ZodError } from "zod";

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: FieldError[],
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

/** Map a Zod validation failure to a 422 validation_error with per-field details. */
export function fromZod(err: ZodError): ApiHttpError {
  const details: FieldError[] = err.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
    code: issue.code,
  }));
  return new ApiHttpError(422, "validation_error", "Request validation failed.", details);
}
