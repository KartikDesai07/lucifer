import type { FormEventHandler, ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  saving: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>; // pass handleSubmit(onValid)
  // Extra classes for the SheetContent (e.g. "overflow-y-auto" for tall forms).
  contentClassName?: string;
  children: ReactNode; // the form fields
}

// The shared slide-in form shell: header (title + description), a scrollable
// body of fields, and a footer submit button with a pending spinner. Wraps the
// repeated Sheet/form/SheetFooter boilerplate every entity form sheet had.
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  saving,
  onSubmit,
  contentClassName,
  children,
}: FormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex w-full flex-col gap-0 sm:max-w-md",
          contentClassName,
        )}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-1 flex-col gap-4 p-4"
          onSubmit={onSubmit}
          noValidate
        >
          {children}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
