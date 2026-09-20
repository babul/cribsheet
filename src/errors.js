/** Exit codes (spec §7.2, plus USAGE added by review §5). */
export const EXIT = {
  OK: 0,
  STALE: 1,
  REFUSED: 2,
  ERROR: 3,
  USAGE: 4,
};

/** An error carrying the exit code the CLI should terminate with. */
export class CribError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CribError';
    this.code = code;
  }
}

export const error = (msg) => new CribError(EXIT.ERROR, msg);
export const usage = (msg) => new CribError(EXIT.USAGE, msg);
export const refused = (msg) => new CribError(EXIT.REFUSED, msg);
