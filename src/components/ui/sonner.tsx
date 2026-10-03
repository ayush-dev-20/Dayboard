"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Toasts are the one inverted surface (DESIGN.md): on-surface fill, surface text, bottom-left.
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "system"}
      position="bottom-left"
      closeButton={false}
      style={{ zIndex: 60 }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-md !border-0 !bg-foreground !text-background !shadow-float !px-3 !py-3 !text-[13px]",
          actionButton: "!bg-transparent !text-background !font-semibold !underline",
          description: "!text-background/80",
        },
      }}
      {...props}
    />
  );
}
