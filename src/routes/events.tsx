import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Trash2, Pencil, PartyPopper } from "lucide-react";
import { useEvents, type EventBooking, uid, inr } from "@/lib/storage";
import { toast } from "sonner";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Event Bookings — Lucifer Cafe" },
      { name: "description", content: "Manage event bookings, advances and balances." },
    ],
  }),
  component: EventsPage,
});

const STATUSES: EventBooking["status"][] = ["Booked", "Completed", "Cancelled"];
const PAY_MODES: EventBooking["payMode"][] = ["Cash", "Online", "Credit"];

function EventsPage() {
  const [list, setList] = useEvents();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EventBooking | null>(null);
  const [q, setQ] = useState("");

  const sorted = useMemo(
    () =>
      [...list]
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q.toLowerCase()) ||
            e.eventName.toLowerCase().includes(q.toLowerCase()) ||
            e.mobile.includes(q)
        )
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [list, q]
  );

  const startNew = () => {
    setEditing({
      id: "", name: "", mobile: "",
      date: new Date().toISOString().slice(0, 10), time: "18:00",
      eventName: "", notes: "",
      payable: 0, advance: 0, payMode: "Cash", status: "Booked",
    });
    setOpen(true);
  };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.mobile || !editing.eventName.trim())
      return toast.error("Name, mobile and event name are required");
    setList((prev) => {
      if (editing.id) return prev.map((e) => (e.id === editing.id ? editing : e));
      return [...prev, { ...editing, id: uid() }];
    });
    toast.success("Event booking saved");
    setOpen(false);
  };

  const remove = (id: string) => setList((p) => p.filter((e) => e.id !== id));
  const balance = (e: EventBooking) => Math.max(0, (e.payable || 0) - (e.advance || 0));

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bookings" className="pl-9" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}><Plus className="h-4 w-4" /> New Event</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} Event Booking</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Customer Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Phone No.</Label><Input value={editing.mobile} onChange={(e) => setEditing({ ...editing, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Booking Date</Label><Input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></div>
                  <div><Label>Time</Label><Input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} /></div>
                </div>
                <div><Label>Event Name</Label><Input value={editing.eventName} onChange={(e) => setEditing({ ...editing, eventName: e.target.value })} placeholder="Birthday, Anniversary, Corporate..." /></div>
                <div><Label>Note</Label><Textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Payable Amount (₹)</Label><Input type="number" value={editing.payable || ""} onChange={(e) => setEditing({ ...editing, payable: Number(e.target.value) })} /></div>
                  <div><Label>Advance Pay (₹)</Label><Input type="number" value={editing.advance || ""} onChange={(e) => setEditing({ ...editing, advance: Number(e.target.value) })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Payment Mode</Label>
                    <Select value={editing.payMode} onValueChange={(v) => setEditing({ ...editing, payMode: v as EventBooking["payMode"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as EventBooking["status"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Balance Due</span>
                  <span className="text-lg font-bold text-primary">{inr(balance(editing))}</span>
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

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Event</th>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Customer</th>
                <th className="text-right p-3">Payable</th>
                <th className="text-right p-3">Advance</th>
                <th className="text-right p-3">Balance</th>
                <th className="text-left p-3">Mode</th>
                <th className="text-left p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <PartyPopper className="h-4 w-4 text-primary" />
                      <span className="font-medium">{e.eventName}</span>
                    </div>
                  </td>
                  <td className="p-3 text-xs"><div>{e.date}</div><div className="text-muted-foreground">{e.time}</div></td>
                  <td className="p-3"><div className="font-medium">{e.name}</div><div className="text-xs text-muted-foreground">{e.mobile}</div></td>
                  <td className="p-3 text-right">{inr(e.payable)}</td>
                  <td className="p-3 text-right text-muted-foreground">{inr(e.advance)}</td>
                  <td className="p-3 text-right font-semibold text-primary">{inr(balance(e))}</td>
                  <td className="p-3">{e.payMode}</td>
                  <td className="p-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      e.status === "Completed" ? "bg-primary text-primary-foreground" :
                      e.status === "Cancelled" ? "bg-destructive text-destructive-foreground" :
                      "bg-accent text-accent-foreground"
                    }`}>{e.status}</span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(e.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">No event bookings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
