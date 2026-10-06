// The order's token number on Classic paper (print customization S6). ONE file for the legacy receipts AND the
// engine's Classic blocks, so today's slip and a saved Classic design can never print it two ways. Each prints
// only what it is handed: callers render it only when the order has a token (tokens on when it was created).
// Whole literal class names (Tailwind scans source text).

/** The bill's "Token" row: the Bill No. row's own look, right under it. `wrap` = the template-path twin (A4:
 *  at a large size the number drops to its own line instead of off the slip). */
export function BillTokenRow({ tokenNumber, wrap = false }: { tokenNumber: number; wrap?: boolean }) {
  return wrap ? (
    <div className="flex flex-wrap justify-between gap-2 font-bold">
      <span>Token</span>
      <span className="ml-auto text-right">{tokenNumber}</span>
    </div>
  ) : (
    <div className="flex justify-between gap-2 font-bold">
      <span>Token</span>
      <span className="text-right">{tokenNumber}</span>
    </div>
  );
}

/** The KOT's token line, centred under the big ticket number, on every ticket of the order (a new round, a
 *  cancelled item, a table move): the number the counter calls when this food is ready. */
export function KotTokenLine({ tokenNumber }: { tokenNumber: number }) {
  return <div className="text-center text-[1.29em] font-bold">{`TOKEN ${tokenNumber}`}</div>;
}
