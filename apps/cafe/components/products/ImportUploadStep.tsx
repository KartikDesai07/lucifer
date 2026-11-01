"use client";

import { Upload, Download, Loader2 } from "lucide-react";

import { buildTemplateCsv, MAX_IMPORT_ROWS, MODIFIER_SEPARATOR } from "@/lib/product-import";
import { downloadCsvString } from "@/lib/export";
import { MENU_EDITOR_OUTLINE_BUTTON_CLASS } from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";

interface ImportUploadStepProps {
  fileName: string;
  pending: boolean;
  /** Remounts the file input. */
  resetKey: number;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// The import wizard's first step (the CSV columns note, the template, the file drop box), pulled out of
// ImportProductsDialog.tsx (U5 Task 3: under its 300-line budget) with today's words.
export function ImportUploadStep({ fileName, pending, resetKey, onFile }: ImportUploadStepProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">CSV columns</p>
        <p>
          <span className="font-medium text-foreground">name</span>, <span className="font-medium text-foreground">category</span>,{" "}
          <span className="font-medium text-foreground">price</span> are required. Optional: discount (%), image, modifiers, isActive.
        </p>
        <p className="mt-1">
          Put multiple modifiers in one cell separated by <code className="rounded bg-background px-1">{MODIFIER_SEPARATOR}</code> (e.g.{" "}
          <code className="rounded bg-background px-1">Extra Cheese|Thin Crust</code>
          ). A row whose name already exists overwrites that item with every column in the row (omitted optional columns reset to their
          defaults). New categories are created automatically.
        </p>
      </div>

      <button
        type="button"
        className={cn(MENU_EDITOR_OUTLINE_BUTTON_CLASS, "self-start")}
        onClick={() => downloadCsvString(buildTemplateCsv(), "products-template")}
      >
        <Download className="h-4 w-4" /> Download template
      </button>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:bg-muted/40">
        {pending ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Validating {fileName}…</span>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a CSV file</span>
            <span className="text-xs text-muted-foreground">Up to {MAX_IMPORT_ROWS} rows</span>
          </>
        )}
        <input key={resetKey} type="file" accept=".csv,text/csv" className="sr-only" disabled={pending} onChange={onFile} />
      </label>
    </div>
  );
}
