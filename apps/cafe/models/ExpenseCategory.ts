import mongoose, { Schema, type Document, type Model } from "mongoose";
import { EXPENSE_CATEGORY_NAME_MAX_LEN } from "@pos/shared/expense";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// The owner's flat, editable expense-category list (Step EXP, D4): 8 defaults
// seeded once, then add / rename / hide / show — never delete, so an old
// expense always still finds its category's name. A small CORE-style registry
// collection, NOT federated (the Area / DuePayment precedent).
export interface IExpenseCategory extends Document {
  name: string;
  displayOrder: number; // the route assigns max + 1 on create
  hidden?: true; // omit-empty: absent = offered when adding
  createdAt: Date;
  updatedAt: Date;
}

// Names are unique CASE-INSENSITIVELY ("Gas" = "gas") through the database's own
// collation (the Area idiom — no second lower-cased key to forget).
export const EXPENSE_CATEGORY_NAME_COLLATION = { locale: "en", strength: 2 } as const;

export const expenseCategorySchema = new Schema<IExpenseCategory>(
  {
    // No field-level `unique`: that would build a second, case-sensitive index
    // beside the collation one below.
    name: { type: String, required: true, trim: true, maxlength: EXPENSE_CATEGORY_NAME_MAX_LEN },
    displayOrder: { type: Number, required: true, min: 0 },
    // omit-empty: NO default — "show" is an $unset, never hidden:false.
    hidden: { type: Boolean },
  },
  { timestamps: true },
);

expenseCategorySchema.index({ name: 1 }, { unique: true, collation: EXPENSE_CATEGORY_NAME_COLLATION });
// Matches the GET /api/expense-categories sort exactly (the name breaks ties).
expenseCategorySchema.index({ displayOrder: 1, name: 1 });

assertSchemaTtlAllowed("ExpenseCategory", expenseCategorySchema);

// Reuse the compiled model across hot reloads / serverless invocations.
export const ExpenseCategory: Model<IExpenseCategory> =
  (mongoose.models.ExpenseCategory as Model<IExpenseCategory>) ??
  mongoose.model<IExpenseCategory>("ExpenseCategory", expenseCategorySchema);
