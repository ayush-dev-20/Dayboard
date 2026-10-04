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
          actionButton:
            "!rounded-md !border !border-background/40 !bg-transparent !px-3 !font-semibold !text-background hover:!bg-background/10",
          description: "!text-background/80",
        },
      }}
      {...props}
    />
  );
}
