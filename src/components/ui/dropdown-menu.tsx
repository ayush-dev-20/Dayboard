"use client";

import * as React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float float-surface",
          "duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex h-11 cursor-default items-center gap-2 rounded-md px-2 type-body-md outline-none md:h-8",
        "data-[disabled]:opacity-60 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2 py-1.5", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  );
}

const itemClasses =
  "type-body-md flex h-11 cursor-default items-center gap-2 rounded-md py-0 pr-2 pl-8 outline-none md:h-8 " +
  "data-[highlighted]:bg-accent data-[disabled]:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0";

/** A row with a check on the left when selected. Pass `onSelect={(e) => e.preventDefault()}` to keep the menu open. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClasses, "relative", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check strokeWidth={1.5} className="text-primary" aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClasses, "relative", className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check strokeWidth={1.5} className="text-primary" aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}
