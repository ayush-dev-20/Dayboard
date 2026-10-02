"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCommandMenu } from "@/components/command/command-context";
import { FOCUS_ADD_EVENT, isTypingTarget } from "@/lib/shortcuts";

/**
 * Single-key shortcuts: N starts a new task, T a new todo, Shift+N a new note, C a quick capture. They do nothing while
 * the person is typing, while a dialog or menu is open, or when Ctrl, Cmd or Alt is held.
 */
export function AppShortcuts() {
  const router = useRouter();
  const command = useCommandMenu();

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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;

      const key = event.key.toLowerCase();
      // Shift+N is the new note; plain N and T are for tasks and todos.
      if (event.shiftKey) {
        if (key === "n") {
          event.preventDefault();
          router.push("/notes/new");
        }
        return;
      }
      if (key === "n") {
        event.preventDefault();
        startNew("tasks");
      } else if (key === "t") {
        event.preventDefault();
        startNew("todos");
      } else if (key === "c") {
        // Quick capture to the Inbox, from anywhere.
        event.preventDefault();
        command.open("capture");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, command]);

  return null;
}
