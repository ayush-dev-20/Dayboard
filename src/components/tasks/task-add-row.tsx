"use client";

import { toast } from "sonner";
import { createTask } from "@/actions/tasks";
import { AddRow } from "./add-row";

export function TaskAddRow() {
  return (
    <AddRow
      label="Add task"
      maxLength={500}
      onAdd={async (title) => {
        const result = await createTask({ title });
        if (!result.ok) {
          toast.error(result.error.fieldErrors?.title ?? "Couldn't add that task. Try again.");
          return false;
        }
        return true;
      }}
    />
  );
}
