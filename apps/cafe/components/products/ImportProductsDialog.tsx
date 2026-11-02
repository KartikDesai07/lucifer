"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { useImportPreview, useImportProducts } from "@/hooks/use-product-import";
import { MAX_IMPORT_ROWS } from "@/lib/product-import";
import {
  MENU_DIALOG_BODY_CLASS,
  MENU_DIALOG_FOOT_CLASS,
  MENU_DIALOG_WIDE_CLASS,
  MENU_EDITOR_CANCEL_CLASS,
  MENU_EDITOR_SAVE_CLASS,
} from "@/lib/menu-editor-layout";
import { MenuDialog } from "@/components/menu/MenuDialog";
import { ImportUploadStep } from "@/components/products/ImportUploadStep";
import { ImportPreviewStep } from "@/components/products/ImportPreviewStep";
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

  // U5 Task 3: in the HTML's dialog box at today's width (its five-column preview needs it); the steps and their words are today's.
  return (
    <MenuDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import items from CSV"
      sub={
        step === "upload"
          ? "Upload a CSV to bulk add or update menu items. Items are matched by name."
          : step === "preview"
            ? `Reviewing ${fileName}`
            : "Import complete."
      }
      className={MENU_DIALOG_WIDE_CLASS}
    >
      <div className={MENU_DIALOG_BODY_CLASS}>
        {step === "upload" && (
          <ImportUploadStep fileName={fileName} pending={previewMutation.isPending} resetKey={resetKey} onFile={handleFile} />
        )}
        {step === "preview" && preview && <ImportPreviewStep preview={preview} />}
        {step === "result" && result && (
          <div className="space-y-2 py-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-status-ok" />
            <p className="text-lg font-semibold">
              {result.created} added · {result.updated} updated
            </p>
            <p className="text-sm text-muted-foreground">
              {result.skipped > 0 && `${result.skipped} row(s) skipped. `}
              {result.duplicates > 0 && `${result.duplicates} duplicate row(s) ignored. `}
              {result.newCategories.length > 0 &&
                `Created ${result.newCategories.length} new categor${result.newCategories.length === 1 ? "y" : "ies"}.`}
            </p>
          </div>
        )}
      </div>

      {step !== "upload" && (
        <div className={MENU_DIALOG_FOOT_CLASS}>
          {step === "preview" && (
            <>
              <button type="button" className={MENU_EDITOR_CANCEL_CLASS} onClick={backToUpload} disabled={importMutation.isPending}>
                Back
              </button>
              <button
                type="button"
                className={MENU_EDITOR_SAVE_CLASS}
                onClick={commit}
                disabled={preview?.summary.valid === 0 || importMutation.isPending}
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {preview?.summary.valid ?? 0} item(s)
              </button>
            </>
          )}
          {step === "result" && (
            <button type="button" className={MENU_EDITOR_SAVE_CLASS} onClick={() => onOpenChange(false)}>
              Done
            </button>
          )}
        </div>
      )}
    </MenuDialog>
  );
}
