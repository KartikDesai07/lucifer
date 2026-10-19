"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// The owner's HTML toast (values 2.8; design 5.4; U0 Task 4): one dark pill at the bottom centre, as wide as its words
// (never past the screen's 16px margins), 24px above the foot from 1024px, 92px below 1024px and 140px on a phone (it
// clears the tab bar and the POS cart bar); --toast, white 13.5px, radius 10, padding 10px 14px, 14px between the words
// and an action ("Undo" in --toast-a, 600). Sonner draws it unstyled, so only these classes paint it; its own sheet
// still places and stacks it (its rules are unlayered, hence the important ones below). A success or an info toast
// reads like the HTML's; an error or a warning keeps sonner's 16px glyph so it never reads like a success.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="bottom-center"
      mobileOffset={0}
      icons={{ success: null, info: null }}
      className="toaster group bottom-[140px]! tab:bottom-[92px]! lg:bottom-[24px]!"
      // The list spans the screen so the centred pill can be as wide as its words.
      style={{ "--width": "100vw" } as CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group toast pointer-events-auto right-0! left-0! mx-auto w-max! max-w-[calc(100vw-32px)] flex items-center gap-[14px] rounded-[10px] bg-toast px-[14px] py-[10px] font-sans text-[13.5px] leading-[normal] text-toast-t [box-shadow:0_8px_24px_rgba(0,0,0,0.2)]",
          title: "font-normal",
          description: "mt-0.5 text-[12.5px] text-toast-t/70",
          icon: "flex size-4 flex-none items-center justify-center [&>svg]:size-4",
          actionButton: "flex-none cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-semibold text-toast-a",
          cancelButton: "flex-none cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-semibold text-toast-t",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
