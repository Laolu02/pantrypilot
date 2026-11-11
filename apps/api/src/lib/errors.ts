export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHENTICATED", message);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);

/** Thrown by repositories to mirror a database unique-constraint violation. */
export class UniqueViolationError extends Error {
  constructor(public constraint: string) {
    super(`Unique constraint violated: ${constraint}`);
  }
}
/** A provider call whose outcome is unknown (timeout, dropped connection). Never retry blindly. */
export class UncertainOutcomeError extends Error {}
export class InvalidTransitionError extends Error {}
