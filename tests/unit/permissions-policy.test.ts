import { describe, expect, it } from "vitest";
import { allowed, POLICY, POLICY_SHAPE, SHAREABLE } from "@/modules/permissions/policy";
import {
  ACTIONS,
  RESOURCE_TYPES,
  ROLES,
  ROLE_RANK,
  highestRole,
  type Role,
} from "@/modules/permissions/types";

// V3 feature 04 §2: the policy table is the only place a rule is written. These tests state the spec's sentences as
// cells, and fail if a role, a kind of item or an action has no row.

const can = (
  role: Role,
  type: (typeof RESOURCE_TYPES)[number],
  ...actions: (typeof ACTIONS)[number][]
) => actions.every((a) => POLICY[role][type][a]);

describe("the policy table", () => {
  it("has a cell for every role, kind of item and action", () => {
    expect(Object.keys(POLICY).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      expect(Object.keys(POLICY[role]).sort()).toEqual([...RESOURCE_TYPES].sort());
      for (const type of RESOURCE_TYPES) {
        expect(Object.keys(POLICY[role][type]).sort()).toEqual([...ACTIONS].sort());
        for (const action of ACTIONS) expect(typeof POLICY[role][type][action]).toBe("boolean");
      }
    }
    expect(POLICY_SHAPE.roles).toBe(ROLES);
  });

  it("lets the owner do everything to what can be done to it, including sharing a project or a note", () => {
    for (const type of RESOURCE_TYPES) {
      expect(
        can(
          "OWNER",
          type,
          "read",
          "comment",
          "create",
          "update",
          "complete",
          "archive",
          "trash",
          "restore",
          "delete_forever",
        ),
      ).toBe(true);
    }
    expect(can("OWNER", "PROJECT", "share", "manage_settings")).toBe(true);
    expect(can("OWNER", "NOTE", "share")).toBe(true);
  });

  it("lets an editor read, create, edit, complete, archive, trash and comment inside the shared scope", () => {
    for (const type of ["TASK", "TODO", "NOTE"] as const) {
      expect(
        can("EDITOR", type, "read", "comment", "create", "update", "complete", "archive", "trash"),
      ).toBe(true);
    }
    expect(can("EDITOR", "PROJECT", "read", "comment", "create")).toBe(true);
  });

  it("does not let an editor share, restore, delete for good or change the project's own settings", () => {
    for (const type of RESOURCE_TYPES) {
      expect(can("EDITOR", type, "share")).toBe(false);
      expect(can("EDITOR", type, "restore")).toBe(false);
      expect(can("EDITOR", type, "delete_forever")).toBe(false);
      expect(can("EDITOR", type, "manage_settings")).toBe(false);
    }
    // The project itself: no rename, status, archive or trash.
    expect(can("EDITOR", "PROJECT", "update")).toBe(false);
    expect(can("EDITOR", "PROJECT", "archive")).toBe(false);
    expect(can("EDITOR", "PROJECT", "trash")).toBe(false);
  });

  it("lets a commenter read and comment and nothing else; a viewer read and nothing else", () => {
    for (const type of RESOURCE_TYPES) {
      for (const action of ACTIONS) {
        expect(POLICY.COMMENTER[type][action], `commenter ${type} ${action}`).toBe(
          action === "read" || action === "comment",
        );
        expect(POLICY.VIEWER[type][action], `viewer ${type} ${action}`).toBe(action === "read");
      }
    }
  });

  it("shares only projects and notes: nobody shares a task or a todo by itself", () => {
    expect(SHAREABLE).toEqual(["PROJECT", "NOTE"]);
    for (const role of ROLES) {
      expect(POLICY[role].TASK.share).toBe(false);
      expect(POLICY[role].TODO.share).toBe(false);
    }
  });

  it("only a project has settings of its own", () => {
    for (const type of ["TASK", "TODO", "NOTE"] as const) {
      for (const role of ROLES) expect(POLICY[role][type].manage_settings).toBe(false);
    }
  });

  it("never grants more to a lower role than to a higher one", () => {
    const order: Role[] = ["VIEWER", "COMMENTER", "EDITOR", "OWNER"];
    for (const type of RESOURCE_TYPES) {
      for (const action of ACTIONS) {
        for (let i = 1; i < order.length; i += 1) {
          if (POLICY[order[i - 1]!][type][action]) {
            expect(POLICY[order[i]!][type][action], `${order[i]} ${type} ${action}`).toBe(true);
          }
        }
      }
    }
  });

  it("answers false for a person with no access at all", () => {
    for (const type of RESOURCE_TYPES)
      for (const action of ACTIONS) expect(allowed(null, type, action)).toBe(false);
  });
});

describe("roles", () => {
  it("ranks the owner above editor, commenter and viewer, and picks the highest", () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.EDITOR);
    expect(ROLE_RANK.EDITOR).toBeGreaterThan(ROLE_RANK.COMMENTER);
    expect(ROLE_RANK.COMMENTER).toBeGreaterThan(ROLE_RANK.VIEWER);
    expect(highestRole(["VIEWER", "EDITOR", "COMMENTER"])).toBe("EDITOR");
    expect(highestRole(["VIEWER"])).toBe("VIEWER");
    expect(highestRole([])).toBeNull();
  });
});
