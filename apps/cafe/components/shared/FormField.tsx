import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface FormFieldProps {
  label: string;
  // Pairs the label with a native input's `id`. Omit for Radix Select / custom
  // controls that have no focusable input element.
  htmlFor?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

// Label + control + inline error, the repeated building block of every form
// sheet. The control itself (Input/Select/Textarea + its register/Controller
// wiring) is passed as children so per-field props stay local.
export function FormField({
  label,
  htmlFor,
  error,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
