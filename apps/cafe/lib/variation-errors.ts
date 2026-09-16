// react-hook-form reports an array field's problems in TWO different places, and
// the products form was only rendering one of them:
//   • list-level (`min`/`max`, and the duplicate-name refine) at `.message`
//   • per-ROW (a blank name, a bad price) at `[index].name.message` / `[index].price.message`
// The duplicate-name refine is anchored to `path: ["0","name"]`, so it arrives as a
// ROW error too — meaning a form that only read `.message` showed NOTHING for the
// two most likely mistakes (an empty row and two rows with the same name). Save
// simply did nothing and the operator had no idea why.
//
// Kept out of the component (and out of its ~300-line budget) so the behaviour can
// be tested directly rather than pinned by reading source.

// The shape this needs from RHF, named rather than `any`: an object that may carry
// a list-level message and/or numerically-keyed row errors.
interface RowFieldError {
  message?: unknown;
}
interface VariationRowErrors {
  name?: RowFieldError;
  price?: RowFieldError;
}

const ROW_INDEX_PATTERN = /^\d+$/;

function messageOf(field: RowFieldError | undefined): string | undefined {
  const message = field?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

// The one message to show under the Variations field: the list-level problem if
// there is one, otherwise the FIRST row problem, labelled with the row number the
// operator is looking at (1-based — the array index means nothing to them).
export function variationsErrorMessage(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined;

  const listMessage = messageOf(errors as RowFieldError);
  if (listMessage) return listMessage;

  const rows = errors as Record<string, VariationRowErrors | undefined>;
  const indices = Object.keys(rows)
    .filter((key) => ROW_INDEX_PATTERN.test(key))
    .map(Number)
    .sort((a, b) => a - b);

  for (const index of indices) {
    const row = rows[String(index)];
    const message = messageOf(row?.name) ?? messageOf(row?.price);
    if (message) return `Variation ${index + 1}: ${message}`;
  }
  return undefined;
}
