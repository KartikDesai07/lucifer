"use client";

import { useState } from "react";
import { ChefHat } from "lucide-react";
import { toast } from "sonner";

import { STATIONS_MAX, STATION_NAME_MAX_CHARS, type PrinterConfig, type StationConfig } from "@pos/shared/print-printers";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_ACTION_CLASS, PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteStation, useSaveStation } from "@/hooks/use-print-setup";
import { stationDeleteQuestion } from "@/lib/print-setup-text";
import { KITCHEN_PRINTER_SETUP_NOTE } from "@/lib/kitchen-lines";

interface StationsSetupSectionProps {
  stations: readonly StationConfig[];
  printers: readonly PrinterConfig[];
}

const SECTION_DESCRIPTION = `Each category prints at a station; an item can choose its own (Menu → Items). ${KITCHEN_PRINTER_SETUP_NOTE}`;
const DEFAULT_CANT_DELETE = "The default station can't be deleted. Make another station the default first.";


// Printing redesign, Phase 2 Session 2D (spec §11 Stations): add, rename, make default, delete. The default takes
// every category with no station of its own; it can be moved, never deleted (said in words, not a refused tap).
export function StationsSetupSection({ stations, printers }: StationsSetupSectionProps) {
  const save = useSaveStation();
  const remove = useDeleteStation();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const busy = save.isPending || remove.isPending;

  const run = async (write: () => Promise<unknown>, done?: string) => {
    try {
      await write();
      if (done !== undefined) toast.success(done);
    } catch {
      // The hook toasted it.
    }
  };

  const add = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    void run(async () => {
      await save.mutateAsync({ body: { name: trimmed } });
      setName("");
    });
  };

  return (
    <PrinterSection icon={ChefHat} title="Kitchen stations" description={SECTION_DESCRIPTION}>
      {stations.map((station) => (
        <div key={station.id} className="space-y-2 rounded-md border border-brand-rule p-3">
          {renaming?.id === station.id ? (
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Station name" className={`${PRINTER_INPUT_CLASS} min-w-0 flex-1`} maxLength={STATION_NAME_MAX_CHARS} value={renaming.name} onChange={(e) => setRenaming({ id: station.id, name: e.target.value })} />
              <Button className={PRINTER_ACTION_CLASS} disabled={busy || renaming.name.trim() === ""} onClick={() => void run(async () => { await save.mutateAsync({ id: station.id, body: { name: renaming.name.trim() } }); setRenaming(null); })}>
                Save
              </Button>
              <Button variant="outline" className={PRINTER_ACTION_CLASS} onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 break-words font-medium text-brand-ink">{station.name}</p>
              {station.isDefault && <Badge variant="secondary">Default</Badge>}
            </div>
          )}
          {deleting === station.id ? (
            <InlineConfirm question={stationDeleteQuestion(station, printers)} yes="Yes, delete" no="No" disabled={busy} onYes={() => { setDeleting(null); void run(() => remove.mutateAsync(station.id), `${station.name} deleted.`); }} onNo={() => setDeleting(null)} />
          ) : renaming?.id !== station.id && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className={PRINTER_ACTION_CLASS} onClick={() => setRenaming({ id: station.id, name: station.name })}>
                Rename
              </Button>
              {!station.isDefault && (
                <>
                  <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={busy} onClick={() => void run(() => save.mutateAsync({ id: station.id, body: { isDefault: true } }), `${station.name} is the default station.`)}>
                    Make default
                  </Button>
                  <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={busy} onClick={() => setDeleting(station.id)}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          )}
          {station.isDefault && renaming?.id !== station.id && <p className="text-xs text-brand-muted">{DEFAULT_CANT_DELETE}</p>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input aria-label="New station name" className={`${PRINTER_INPUT_CLASS} min-w-0 flex-1`} maxLength={STATION_NAME_MAX_CHARS} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bar" />
        <Button className={PRINTER_ACTION_CLASS} disabled={busy || name.trim() === "" || stations.length >= STATIONS_MAX} onClick={add}>
          Add station
        </Button>
      </div>
    </PrinterSection>
  );
}
