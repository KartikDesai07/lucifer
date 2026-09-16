"use client";

import { Settings2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DeviceAlertSettings } from "@/components/orders/DeviceAlertSettings";

// PH-10b (owner): the per-device toggles used to sit in a card that took up
// half the /requests page — they now live behind this single button, beside
// Refresh. D1: a Dialog, not a Sheet — this is two instant-apply toggles (a
// preferences pop-up), not a form with a Save step; cafe.md's "Dialogs
// confirm, Sheets edit" is about edit FORMS, which this isn't. Precedent:
// components/pos/PaymentModal.tsx's `<Dialog><DialogContent
// className="sm:max-w-md">` usage. D2: Settings2 is deliberately distinct
// from the sidebar's own `Settings` nav icon (first use of Settings2 in the
// repo). Uncontrolled — no open state needed.
export function DeviceAlertSettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Device settings">
          <Settings2 className="mr-2 h-4 w-4" />
          Device settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Device settings</DialogTitle>
          <DialogDescription>
            Alerts and auto-print for this device only — other devices are not affected.
          </DialogDescription>
        </DialogHeader>
        <DeviceAlertSettings />
      </DialogContent>
    </Dialog>
  );
}
