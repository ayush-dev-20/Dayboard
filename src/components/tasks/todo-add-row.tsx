"use client";

import { toast } from "sonner";
import { createTodo } from "@/actions/todos";
import { AddRow } from "./add-row";

export function TodoAddRow() {
  return (
    <AddRow
      label="Add todo"
      maxLength={300}
      onAdd={async (title) => {
        const result = await createTodo({ title });
        if (!result.ok) {
          toast.error(result.error.fieldErrors?.title ?? "Couldn't add that todo. Try again.");
          return false;
        }
        return true;
      }}
    />
  );
}
