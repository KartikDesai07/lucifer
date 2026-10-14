"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { FESTIVAL_CARDS_TITLE } from "@pos/shared/reward-campaigns";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { FestivalCardsList } from "@/components/customers/festival/FestivalCardsList";

// CB-7 S6 session 3 — the owner's festival-card campaigns. Admin-only (the routes it calls are too); linked from the
// Customers page header.
export default function FestivalCardsPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <PageHeader
          title={FESTIVAL_CARDS_TITLE}
          eyebrow={
            <Link href="/customers" className="inline-flex min-h-11 items-center gap-1 text-brand-primary underline-offset-2 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Customers
            </Link>
          }
        />
        <FestivalCardsList />
      </MenuPageShell>
    </AdminGuard>
  );
}
