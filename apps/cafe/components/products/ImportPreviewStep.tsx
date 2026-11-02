"use client";

import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { STATUS_CLASSES } from "@/lib/ui/status";
import { cn } from "@/lib/utils";
import { ImportPreviewTable } from "@/components/products/ImportPreviewTable";
import type { ImportPreview } from "@/types";

// The import wizard's preview step (the counts, the new categories, the rows), pulled out of ImportProductsDialog.tsx
// (U5 Task 3). The badges wear the status tokens in place of raw palette classes.
export function ImportPreviewStep({ preview }: { preview: ImportPreview }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge className={cn("border-transparent", STATUS_CLASSES.ok.pill)}>{preview.summary.toCreate} new</Badge>
        <Badge className={cn("border-transparent", STATUS_CLASSES.info.pill)}>{preview.summary.toUpdate} update</Badge>
        {preview.summary.duplicates > 0 && (
          <Badge className={cn("border-transparent", STATUS_CLASSES.warn.pill)}>{preview.summary.duplicates} duplicate</Badge>
        )}
        {preview.summary.invalid > 0 && <Badge variant="destructive">{preview.summary.invalid} error</Badge>}
      </div>

      {preview.newCategories.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" />
          New categories to be created: <span className="font-medium text-foreground">{preview.newCategories.join(", ")}</span>
        </p>
      )}

      <ImportPreviewTable rows={preview.rows} />

      {preview.summary.invalid > 0 && (
        <p className="text-xs text-muted-foreground">
          Rows with errors are skipped — only the {preview.summary.valid} valid item(s) will be imported.
        </p>
      )}
    </div>
  );
}
