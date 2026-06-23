"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { productImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImageUploadProps {
  value: string; // Cloudinary public_id ("" if none)
  onChange: (publicId: string) => void;
  disabled?: boolean;
}

// Shape returned by POST /api/upload (the signed direct-upload payload).
interface UploadSignature {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2MB (CLAUDE.md §5.9)

// Direct browser → Cloudinary upload using a server-signed payload, so no image
// bytes pass through our API (CLAUDE.md §13). Stores the public_id only.
export function ImageUpload({ value, onChange, disabled }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const storedUrl = productImageUrl(value, 300);
  const shownUrl = preview ?? storedUrl;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be under 2MB");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    setUploading(true);
    try {
      const sig = await apiSend<UploadSignature>("/api/upload", "POST");

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("folder", sig.folder);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: "POST", body: form },
      );
      const json = (await res.json().catch(() => null)) as {
        public_id?: string;
        error?: { message?: string };
      } | null;

      if (!res.ok || !json?.public_id) {
        throw new Error(json?.error?.message || "Upload failed");
      }
      onChange(json.public_id);
      toast.success("Image uploaded");
    } catch (err) {
      setPreview(null);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      URL.revokeObjectURL(localPreview);
      setUploading(false);
    }
  };

  const remove = () => {
    setPreview(null);
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted/40",
          uploading && "opacity-70",
        )}
      >
        {shownUrl ? (
          <Image
            src={shownUrl}
            alt="Product"
            fill
            sizes="80px"
            className="object-cover"
            // Local object-URL previews can't go through the image optimizer;
            // stored Cloudinary URLs (allowlisted) are optimized normally.
            unoptimized={Boolean(preview)}
          />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
        )}
        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {value ? "Change image" : "Upload image"}
        </Button>
        {value && !uploading && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={remove}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
