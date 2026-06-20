import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useStaff, type Staff, uid } from "@/lib/storage";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "Staff — Lucifer Cafe POS" },
      { name: "description", content: "Manage café staff members." },
    ],
  }),
  component: StaffPage,
});

function StaffPage() {
  const [staff, setStaff] = useStaff();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [open, setOpen] = useState(false);

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("Name required");
    setStaff((prev) => {
      if (editing.id) return prev.map((s) => (s.id === editing.id ? editing : s));
      return [...prev, { ...editing, id: uid() }];
    });
    toast.success("Saved");
    setOpen(false);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing({ id: "", name: "", mobile: "" }); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "Add"} Staff</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div><Label>Mobile</Label><Input value={editing.mobile} onChange={(e) => setEditing({ ...editing, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Mobile</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-muted-foreground">{s.mobile || "—"}</td>
                <td className="p-3 text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setStaff((p) => p.filter((x) => x.id !== s.id))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr><td colSpan={3} className="p-10 text-center text-muted-foreground">No staff added yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
