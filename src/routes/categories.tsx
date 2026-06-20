import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCategories, useProducts } from "@/lib/storage";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "Categories — Lucifer Cafe POS" },
      { name: "description", content: "Manage product categories." },
    ],
  }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const [cats, setCats] = useCategories();
  const [products, setProducts] = useProducts();
  const [newCat, setNewCat] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  const add = () => {
    const v = newCat.trim();
    if (!v) return;
    if (cats.some((c) => c.toLowerCase() === v.toLowerCase())) return toast.error("Already exists");
    setCats((p) => [...p, v]);
    setNewCat("");
    toast.success("Category added");
  };

  const saveEdit = (i: number) => {
    const v = editVal.trim();
    if (!v) return;
    const old = cats[i];
    setCats((p) => p.map((c, idx) => (idx === i ? v : c)));
    setProducts((p) => p.map((pr) => (pr.category === old ? { ...pr, category: v } : pr)));
    setEditIdx(null);
    toast.success("Updated");
  };

  const remove = (i: number) => {
    const c = cats[i];
    if (products.some((p) => p.category === c)) return toast.error("In use by products");
    setCats((p) => p.filter((_, idx) => idx !== i));
    toast.success("Deleted");
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4 flex gap-2">
        <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}><Plus className="h-4 w-4" /> Add</Button>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Category</th>
              <th className="text-right p-3">Products</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => {
              const count = products.filter((p) => p.category === c).length;
              return (
                <tr key={c + i} className="border-t">
                  <td className="p-3 font-medium">
                    {editIdx === i ? (
                      <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-8" autoFocus />
                    ) : c}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{count}</td>
                  <td className="p-3 text-right">
                    {editIdx === i ? (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => saveEdit(i)}><Check className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditIdx(null)}><X className="h-3.5 w-3.5" /></Button>
                      </>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => { setEditIdx(i); setEditVal(c); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {cats.length === 0 && (
              <tr><td colSpan={3} className="p-10 text-center text-muted-foreground">No categories.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
