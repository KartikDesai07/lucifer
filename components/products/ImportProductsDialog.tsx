"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import {
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { useImportPreview, useImportProducts } from "@/hooks/use-product-import";
import {
  buildTemplateCsv,
  MAX_IMPORT_ROWS,
  MODIFIER_SEPARATOR,
} from "@/lib/product-import";
import { downloadCsvString } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportPreviewTable } from "@/components/products/ImportPreviewTable";
import type { ImportPreview, ImportResult } from "@/types";

type RawRow = Record<string, unknown>;
type Step = "upload" | "preview" | "result";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportProductsDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resetKey, setResetKey] = useState(0); // remounts the file input

  const previewMutation = useImportPreview();
  const importMutation = useImportProducts();

  // Reset to a clean upload step whenever the dialog OPENS. The dialog stays
  // mounted across open/close, and a request from a previous session can resolve
  // late and fire its per-call onSuccess; resetting on open (not close) makes the
  // fresh state authoritative so reopening never shows a stale preview/result.
  useEffect(() => {
    if (!open) return;
    setStep("upload");
    setFileName("");
    setRows([]);
    setPreview(null);
    setResult(null);
    previewMutation.reset();
    importMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const backToUpload = () => {
    setStep("upload");
    setRows([]);
    setPreview(null);
    setResetKey((k) => k + 1);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        // PapaParse reports structural problems (a stray delimiter / unbalanced
        // quote shifting columns) in res.errors but still passes the rows on.
        // Server re-validation catches most, but a shift into a text column can
        // slip through — warn so a malformed file is visible before commit.
        const structural = res.errors.filter(
          (e) =>
            e.type === "FieldMismatch" ||
            e.type === "Delimiter" ||
            e.type === "Quotes",
        );
        if (structural.length > 0) {
          const rowsHit = new Set(structural.map((e) => e.row)).size;
          toast.warning(
            `${rowsHit} row(s) look malformed (column mismatch) — double-check the file`,
          );
        }

        const parsed = res.data.filter(
          (r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""),
        );
        if (parsed.length === 0) {
          toast.error("No data rows found in the file");
          setResetKey((k) => k + 1);
          return;
        }
        if (parsed.length > MAX_IMPORT_ROWS) {
          toast.error(`Too many rows: ${parsed.length} (max ${MAX_IMPORT_ROWS})`);
          setResetKey((k) => k + 1);
          return;
        }
        setRows(parsed);
        previewMutation.mutate(parsed, {
          onSuccess: (data) => {
            setPreview(data);
            setStep("preview");
          },
          onError: () => setResetKey((k) => k + 1),
        });
      },
      error: () => {
        toast.error("Could not read the CSV file");
        setResetKey((k) => k + 1);
      },
    });
  };

  const commit = () => {
    importMutation.mutate(rows, {
      onSuccess: (data) => {
        setResult(data);
        setStep("result");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" &&
              "Upload a CSV to bulk add or update menu items. Products are matched by name."}
            {step === "preview" && `Reviewing ${fileName}`}
            {step === "result" && "Import complete."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">CSV columns</p>
              <p>
                <span className="font-medium text-foreground">name</span>,{" "}
                <span className="font-medium text-foreground">category</span>,{" "}
                <span className="font-medium text-foreground">price</span> are
                required. Optional: discount (%), image, modifiers, isActive.
              </p>
              <p className="mt-1">
                Put multiple modifiers in one cell separated by{" "}
                <code className="rounded bg-background px-1">
                  {MODIFIER_SEPARATOR}
                </code>{" "}
                (e.g. <code className="rounded bg-background px-1">
                  Extra Cheese|Thin Crust
                </code>
                ). A row whose name already exists overwrites that product with
                every column in the row (omitted optional columns reset to their
                defaults). New categories are created automatically.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                downloadCsvString(buildTemplateCsv(), "lucifer-products-template")
              }
            >
              <Download className="mr-2 h-4 w-4" /> Download template
            </Button>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:bg-muted/40">
              {previewMutation.isPending ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Validating {fileName}…
                  </span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    Choose a CSV file
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Up to {MAX_IMPORT_ROWS} rows
                  </span>
                </>
              )}
              <input
                key={resetKey}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={previewMutation.isPending}
                onChange={handleFile}
              />
            </label>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge className="border-transparent bg-green-100 text-green-700">
                {preview.summary.toCreate} new
              </Badge>
              <Badge className="border-transparent bg-blue-100 text-blue-700">
                {preview.summary.toUpdate} update
              </Badge>
              {preview.summary.duplicates > 0 && (
                <Badge className="border-transparent bg-amber-100 text-amber-700">
                  {preview.summary.duplicates} duplicate
                </Badge>
              )}
              {preview.summary.invalid > 0 && (
                <Badge variant="destructive">
                  {preview.summary.invalid} error
                </Badge>
              )}
            </div>

            {preview.newCategories.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <FileText className="mr-1 inline h-3 w-3" />
                New categories to be created:{" "}
                <span className="font-medium text-foreground">
                  {preview.newCategories.join(", ")}
                </span>
              </p>
            )}

            <ImportPreviewTable rows={preview.rows} />

            {preview.summary.invalid > 0 && (
              <p className="text-xs text-muted-foreground">
                Rows with errors are skipped — only the{" "}
                {preview.summary.valid} valid product(s) will be imported.
              </p>
            )}
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-2 py-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <p className="text-lg font-semibold">
              {result.created} added · {result.updated} updated
            </p>
            <p className="text-sm text-muted-foreground">
              {result.skipped > 0 && `${result.skipped} row(s) skipped. `}
              {result.duplicates > 0 &&
                `${result.duplicates} duplicate row(s) ignored. `}
              {result.newCategories.length > 0 &&
                `Created ${result.newCategories.length} new categor${
                  result.newCategories.length === 1 ? "y" : "ies"
                }.`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "preview" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={backToUpload}
                disabled={importMutation.isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={commit}
                disabled={
                  preview?.summary.valid === 0 || importMutation.isPending
                }
              >
                {importMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Import {preview?.summary.valid ?? 0} product(s)
              </Button>
            </>
          )}
          {step === "result" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
