"use client";

import Image from "next/image";
import { Pencil, Archive, ArchiveRestore } from "lucide-react";

import { productImageUrl } from "@/lib/images";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Product } from "@/types";

interface ProductsTableProps {
  products: Product[];
  archived: boolean;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (id: string) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  // Product id whose restore is in flight — disables just that row's Restore
  // button (not every row) to prevent a double-fire (Pattern A, CLAUDE.md §9).
  pendingRestoreId?: string;
  // Product id whose availability toggle is in flight (disables just that row's
  // Switch to prevent a double-fire — Pattern A, CLAUDE.md §9).
  pendingAvailabilityId?: string;
}

// Menu products table. In the active view each row carries an availability
// ("86") toggle + Edit/Archive; in the archived view it shows the archived
// state + Restore.
export function ProductsTable({
  products,
  archived,
  onEdit,
  onArchive,
  onRestore,
  onToggleAvailable,
  pendingRestoreId,
  pendingAvailabilityId,
}: ProductsTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="w-36 text-right">
              {archived ? "Status" : "Availability"}
            </TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const url = productImageUrl(product.image, 80);
            const available = product.available !== false;
            return (
              <TableRow key={product._id}>
                <TableCell>
                  <div className="relative h-10 w-10 overflow-hidden rounded-md bg-muted">
                    {url ? (
                      <Image
                        src={url}
                        alt={product.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-sm font-semibold text-muted-foreground">
                        {product.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {product.name}
                  {product.discount > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {product.discount}% off
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {product.category}
                </TableCell>
                <TableCell className="text-right">
                  {inr(product.price)}
                </TableCell>
                <TableCell className="text-right">
                  {archived ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      {!available && (
                        <span className="text-xs font-medium text-destructive">
                          Out
                        </span>
                      )}
                      <Switch
                        checked={available}
                        disabled={pendingAvailabilityId === product._id}
                        onCheckedChange={(v) => onToggleAvailable(product._id, v)}
                        aria-label={`Toggle availability for ${product.name}`}
                      />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {archived ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRestore(product._id)}
                        disabled={pendingRestoreId === product._id}
                      >
                        <ArchiveRestore className="mr-1.5 h-4 w-4" /> Restore
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(product)}
                          aria-label="Edit product"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onArchive(product)}
                          aria-label="Archive product"
                        >
                          <Archive className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
