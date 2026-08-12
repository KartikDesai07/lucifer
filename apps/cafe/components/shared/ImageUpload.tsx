"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import {
  IMAGE_MAX_DIMENSION_PX,
  MAX_IMAGE_BYTES,
} from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImageUploadProps {
  value: string; // opaque image ref — "r2:<key>" or a legacy Cloudinary public_id ("" if none)
  onChange: (ref: string) => void;
  disabled?: boolean;
  alt?: string;
}

// Shape returned by POST /api/upload — the direct-upload grant for whichever
// store the runtime targets (the client just follows the `store` tag).
type UploadGrant =
  | {
      store: "r2";
      uploadUrl: string;
      headers: Record<string, string>;
      ref: string;
    }
  | {
      store: "cloudinary";
      signature: string;
      timestamp: number;
      cloudName: string;
      apiKey: string;
      folder: string;
    };

// Generous cap on the ORIGINAL file (decode-memory guard only) — the stored
// image is the resized blob, which MAX_IMAGE_BYTES bounds.
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;

const WEBP_QUALITY = 0.82;

// Downscale + re-encode in the browser: R2 has no transform tier, so images are
// stored pre-sized (F2 §3.7 "pre-sized variants at upload"). webp where the
// browser can encode it; per the canvas spec, an unsupported type falls back to
// png — both are allowlisted server-side. Animated GIFs flatten to one frame
// (fine for menu thumbnails).
async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Unsupported or corrupted image file");
  }
  try {
    const scale = Math.min(
      1,
      IMAGE_MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the image");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    if (!blob) throw new Error("Could not process the image");
    return blob;
  } finally {
    bitmap.close();
  }
}

async function uploadPrepared(blob: Blob): Promise<string> {
  const grant = await apiSend<UploadGrant>("/api/upload", "POST", {
    contentType: blob.type,
    size: blob.size,
  });

  if (grant.store === "r2") {
    // Direct browser → R2 PUT with the presigned URL; the signature pins the
    // exact Content-Type + Content-Length declared above.
    const res = await fetch(grant.uploadUrl, {
      method: "PUT",
      headers: grant.headers,
      body: blob,
    });
    if (!res.ok) throw new Error("Upload failed");
    return grant.ref;
  }

  // Single per-cafe Cloudinary account (never pooled — F2 §2.11): the v1
  // signed direct-upload flow, now fed the pre-resized blob to save credits.
  const form = new FormData();
  form.append("file", blob, blob.type === "image/png" ? "image.png" : "image.webp");
  form.append("api_key", grant.apiKey);
  form.append("timestamp", String(grant.timestamp));
  form.append("signature", grant.signature);
  form.append("folder", grant.folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${grant.cloudName}/image/upload`,
    { method: "POST", body: form },
  );
  const json = (await res.json().catch(() => null)) as {
    public_id?: string;
    error?: { message?: string };
  } | null;

  if (!res.ok || !json?.public_id) {
    throw new Error(json?.error?.message || "Upload failed");
  }
  return json.public_id;
}

// Direct browser → store upload using a server-issued grant, so no image bytes
// pass through our API (CLAUDE.md §13). Stores the opaque ref only.
export function ImageUpload({
  value,
  onChange,
  disabled,
  alt = "Image",
}: ImageUploadProps) {
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
    if (file.size > MAX_ORIGINAL_BYTES) {
      toast.error("Image must be under 20MB");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    setUploading(true);
    try {
      const blob = await prepareImage(file);
      if (blob.size > MAX_IMAGE_BYTES) {
        throw new Error("Image is too large after resizing");
      }
      const ref = await uploadPrepared(blob);
      onChange(ref);
      // Hand display back to the stored ref — the local object URL is revoked
      // below, and rendering the real store URL here surfaces a misconfigured
      // public base at upload time instead of on the next page load.
      setPreview(null);
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
            alt={alt}
            fill
            sizes="80px"
            className="object-cover"
            // Local object-URL previews can't go through the image optimizer;
            // stored image URLs (allowlisted hosts) are optimized normally.
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
