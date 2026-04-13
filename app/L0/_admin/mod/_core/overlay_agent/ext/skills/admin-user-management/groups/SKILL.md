---
name: Admin Groups
description: Explain and manage group membership, manager inheritance, special groups, and canonical group.yaml storage as an admin.
metadata:
  when:
    tags:
      - onscreen
---

Use this skill for group creation, membership changes, manager changes, or explaining how `_all` and `_admin` work.

## Canonical Group Tree

- Runtime-managed groups live under `L1/<group>/`.
- `L1/<group>/group.yaml` is the canonical membership and manager file.
- `L1/<group>/mod/` is that group's customware module root.

Do not write group membership into arbitrary files. `group.yaml` is the contract.

## Special Groups

- `_all` is the implicit everyone group.
- Do not create or rely on `L1/_all/group.yaml` for membership. `_all` membership is universal, not file-driven.
- `_admin` is the admin group.
- Adding a user or included group to `_admin` makes those users admins.

## Canonical group.yaml Fields

- `included_users`
- `included_groups`
- `managing_users`
- `managing_groups`

Meaning:

- `included_users`: direct members of the group
- `included_groups`: groups whose members also become members of this group
- `managing_users`: users who may write this group's `L1/<group>/` tree
- `managing_groups`: groups whose members may write this group's `L1/<group>/` tree

Manager inheritance is separate from membership inheritance. Do not treat `included_*` as manager fields or vice versa.

## Create A Group

Runtime-created groups belong in `L1`, not `L0`.

```js
const groupId = "team-red";

return await space.api.fileWrite({
  files: [
    { path: `L1/${groupId}/` },
    { path: `L1/${groupId}/mod/` },
    {
      path: `L1/${groupId}/group.yaml`,
      content: space.utils.yaml.stringify({
        included_groups: [],
        included_users: [],
        managing_groups: [],
        managing_users: []
      })
    }
  ]
});
```

## Update Membership Or Managers

Read, parse, normalize, then write `group.yaml`.

```js
const path = "L1/team-red/group.yaml";
const current = await space.api.fileRead(path);
const config = space.utils.yaml.parse(current.content || "");

config.included_users = [...new Set([...(config.included_users || []), "alice"])].sort();
config.managing_users = [...new Set([...(config.managing_users || []), "alice"])].sort();

return await space.api.fileWrite(path, space.utils.yaml.stringify(config));
```

Use the same pattern for `included_groups` and `managing_groups`.

## Grant Or Remove Admin Access

The canonical way to grant admin access is to edit `L1/_admin/group.yaml`:

- add usernames to `included_users`
- or add groups to `included_groups`

Example:

```js
const path = "L1/_admin/group.yaml";
const current = await space.api.fileRead(path);
const config = space.utils.yaml.parse(current.content || "");
config.included_users = [...new Set([...(config.included_users || []), "alice"])].sort();
return await space.api.fileWrite(path, space.utils.yaml.stringify(config));
```

## Mental Model

- membership answers "which users belong to this group?"
- manager lists answer "which users may write this group's L1 tree?"
- `_admin` membership is stronger than ordinary group management because admins may write any `L1/*` and `L2/*`
- `_all` is readable by everyone, but it is not the place to store membership rules

## CLI Reference

Backend equivalents exist for operators outside the browser:

- `node space group create <group-id>`
- `node space group add <group-id> <user|group> <id> [--manager]`
- `node space group remove <group-id> <user|group> <id> [--manager]`

From the overlay agent, prefer logical app-file edits through `space.api`.
