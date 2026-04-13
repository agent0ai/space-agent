---
name: Admin User Management
description: Admin-only router skill for users, groups, passwords, and account storage in the layered Space Agent runtime.
metadata:
  when:
    tags:
      - onscreen
---

Use this skill when the user asks to create or remove users, reset passwords, revoke sessions, manage groups, explain admin membership, or describe where account data is stored.

This skill is shipped from `L0/_admin/...`, so if you can see it you are already in an admin-readable scope. Still confirm with `await space.api.userSelfInfo()` before making changes and make sure `groups.includes("_admin")` is `true`.

## Load These Skills Next

- `admin-user-management/users`
  Load for user roots, `user.yaml`, `password.json`, `logins.json`, password resets, session revocation, and guest-account notes.
- `admin-user-management/groups`
  Load for `group.yaml`, special groups, membership inheritance, manager inheritance, and how `_admin` access is granted.

## Recommended Load Order

### Create or update a user

1. `await space.skills.load("admin-user-management/users")`
2. `await space.skills.load("admin-user-management/groups")` if the task also changes group membership or admin access

### Create or update a group

1. `await space.skills.load("admin-user-management/groups")`
2. `await space.skills.load("admin-user-management/users")` if the task also creates or removes concrete users

## Hard Boundaries

- Use logical app paths such as `L1/team-red/group.yaml` or `L2/alice/user.yaml`, not disk paths.
- `L0` is firmware and not writable from browser file APIs, even for admins.
- Do not edit backend source files just to manage accounts; use the app-file APIs and `password_generate`.
- When account structure or group semantics change, update this skill subtree in the same session.
