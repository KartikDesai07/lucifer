"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface ModifierInputProps {
  value: string[];
  onChange: (next: string[]) => void;
}

// Type a modifier + Enter (or comma) to add it; click × to remove.
export function ModifierInput({ value, onChange }: ModifierInputProps) {
  const [text, setText] = useState("");

  const add = () => {
    const tag = text.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder="e.g. Extra cheese — type and press Enter"
      />
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
