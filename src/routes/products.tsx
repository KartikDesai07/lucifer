import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, Plus, Search, Upload, Download } from "lucide-react";
import { useProducts, useCategories, type Product, type Category, uid, inr, priceAfter } from "@/lib/storage";
import { toast } from "sonner";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Menu — Lucifer Cafe POS" },
      { name: "description", content: "Manage café menu: add, edit and remove products." },
    ],
  }),
  component: ProductsPage,
});



function ProductsPage() {
  const [products, setProducts] = useProducts();
  const [CATS] = useCategories();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = products.filter(
    (p) =>
      (cat === "all" || p.category === cat) &&
      p.name.toLowerCase().includes(search.toLowerCase())
  );

  const startNew = () => {
    setEditing({ id: "", name: "", category: "Coffee", price: 0, discount: 0, stock: 0, modifiers: [] });
    setOpen(true);
  };
  const startEdit = (p: Product) => {
    setEditing({ ...p, modifiers: p.modifiers ?? [] });
    setOpen(true);
  };
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || editing.price <= 0) {
      toast.error("Enter a name and valid price");
      return;
    }
    setProducts((prev) => {
      if (editing.id) return prev.map((p) => (p.id === editing.id ? editing : p));
      return [...prev, { ...editing, id: uid() }];
    });
    toast.success(editing.id ? "Product updated" : "Product added");
    setOpen(false);
  };
  const remove = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success("Deleted");
  };

  const onImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setEditing((e) => (e ? { ...e, image: String(reader.result) } : e));
    reader.readAsDataURL(file);
  };

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result).trim();
        const lines = text.split(/\r?\n/).filter(Boolean);
        const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
        const idx = (k: string) => header.indexOf(k);
        const ni = idx("name"), ci = idx("category"), pi = idx("price"), di = idx("discount"), si = idx("stock"), mi = idx("modifiers");
        if (ni < 0 || pi < 0) return toast.error("CSV must have at least: name, price");
        const added: Product[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const name = cols[ni]?.trim();
          if (!name) continue;
          const category = (CATS.includes(cols[ci]?.trim() as Category) ? cols[ci].trim() : "Other") as Category;
          added.push({
            id: uid(),
            name,
            category,
            price: Number(cols[pi]) || 0,
            discount: di >= 0 ? Number(cols[di]) || 0 : 0,
            stock: si >= 0 ? Number(cols[si]) || 0 : 0,
            modifiers: mi >= 0 && cols[mi] ? cols[mi].split("|").map((s) => s.trim()).filter(Boolean) : [],
          });
        }
        if (!added.length) return toast.error("No rows imported");
        setProducts((prev) => [...prev, ...added]);
        toast.success(`Imported ${added.length} products`);
      } catch {
        toast.error("Failed to parse CSV");
      }
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const csv = "name,category,price,discount,stock,modifiers\nMasala Chai,Coffee,30,0,100,Less Sugar|Extra Sugar\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "products-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="pl-9" />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import CSV</Button>
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}><Plus className="h-4 w-4" /> Add Product</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "Add"} Product</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Category</Label>
                    <Select value={editing.category} onValueChange={(v) => setEditing({ ...editing, category: v as Category })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Price (₹)</Label>
                    <Input type="number" value={editing.price || ""} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Discount %</Label>
                    <Input type="number" value={editing.discount || ""} onChange={(e) => setEditing({ ...editing, discount: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Stock</Label>
                    <Input type="number" value={editing.stock ?? ""} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <Label>Modifiers (comma separated)</Label>
                  <Input
                    value={(editing.modifiers ?? []).join(", ")}
                    onChange={(e) => setEditing({ ...editing, modifiers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    placeholder="Less Sugar, Extra Cheese"
                  />
                </div>
                <div>
                  <Label>Image</Label>
                  <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
                  {editing.image && <img src={editing.image} alt="" className="mt-2 h-20 w-20 rounded-lg object-cover" />}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((p) => {
          const low = (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5;
          const out = (p.stock ?? Infinity) <= 0;
          return (
            <Card key={p.id} className="overflow-hidden p-0">
              <div className="aspect-[4/3] bg-muted flex items-center justify-center text-3xl relative">
                {p.image ? <img src={p.image} alt={p.name} className="h-full w-full object-cover" /> : "🍽️"}
                {p.stock != null && (
                  <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${out ? "bg-destructive text-destructive-foreground" : low ? "bg-yellow-500 text-white" : "bg-background/90"}`}>
                    {out ? "Out of stock" : `Stock: ${p.stock}`}
                  </span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.category}</div>
                  </div>
                  {p.discount > 0 && (
                    <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      -{p.discount}%
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="font-bold">{inr(priceAfter(p))}</span>
                    {p.discount > 0 && (
                      <span className="text-xs text-muted-foreground line-through ml-1">{inr(p.price)}</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="col-span-full p-10 text-center text-sm text-muted-foreground">
            No products found.
          </Card>
        )}
      </div>
    </div>
  );
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
