"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Tags, Loader2 } from "lucide-react";

import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/hooks/use-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => {
    if (formOpen) setName(editing?.name ?? "");
  }, [formOpen, editing]);

  const list = categories.data ?? [];

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (category: Category) => {
    setEditing(category);
    setFormOpen(true);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (editing) {
        await updateCategory.mutateAsync({
          id: editing._id,
          data: { name: trimmed },
        });
      } else {
        await createCategory.mutateAsync({ name: trimmed, order: list.length });
      }
      setFormOpen(false);
    } catch {
      // hook toasts on error
    }
  };

  // Swap a category with its neighbour by persisting both new positions.
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    await Promise.all([
      updateCategory.mutateAsync({ id: a._id, data: { order: target } }),
      updateCategory.mutateAsync({ id: b._id, data: { order: index } }),
    ]);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCategory.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  const reordering = updateCategory.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Categories</h2>
          <p className="text-sm text-muted-foreground">
            Organize the menu. Order here controls the POS layout.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add category
        </Button>
      </div>

      {categories.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-8 w-8" />}
          title="No categories yet"
          description="Add your first category to group menu items."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> Add category
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map((category, i) => (
            <li
              key={category._id}
              className="flex items-center justify-between gap-2 p-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    disabled={i === 0 || reordering}
                    onClick={() => move(i, -1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === list.length - 1 || reordering}
                    onClick={() => move(i, 1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="font-medium">{category.name}</span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(category)}
                  aria-label="Rename category"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(category)}
                  aria-label="Delete category"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Rename category" : "Add category"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Renaming updates this category on all its products."
                : "Categories group menu items in the POS."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-2"
          >
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Beverages"
            />
            <DialogFooter className="pt-2">
              <Button
                type="submit"
                disabled={
                  !name.trim() ||
                  createCategory.isPending ||
                  updateCategory.isPending
                }
              >
                {(createCategory.isPending || updateCategory.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editing ? "Save" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete category?"
        description="Products in this category will be moved to “Uncategorized”, not deleted."
        confirmLabel="Delete"
        isLoading={deleteCategory.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
