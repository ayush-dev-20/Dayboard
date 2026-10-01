"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FOCUS_ADD_EVENT, isTypingTarget } from "@/lib/shortcuts";

/**
 * Single-key shortcuts: N starts a new task, T a new todo. They do nothing while the person is
 * typing, while a dialog or menu is open, or when any modifier key is held (Shift+N is for notes).
 */
export function AppShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function startNew(view: "tasks" | "todos") {
      const here = new URL(window.location.href);
      const onTasks = here.pathname === "/tasks";
      const currentView = here.searchParams.get("view") === "todos" ? "todos" : "tasks";

      if (onTasks && currentView === view) {
        window.dispatchEvent(new Event(FOCUS_ADD_EVENT));
        return;
      }
      router.push(view === "todos" ? "/tasks?view=todos&focus=add" : "/tasks?focus=add");
    }

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;

      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        startNew("tasks");
      } else if (key === "t") {
        event.preventDefault();
        startNew("todos");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
