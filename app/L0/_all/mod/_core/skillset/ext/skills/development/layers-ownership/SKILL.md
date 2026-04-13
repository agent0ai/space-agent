---
name: Layers And Ownership
description: Understand L0 or L1 or L2 placement, group and user structure, permissions, and layered override order before storing or overriding frontend assets.
---

Use this skill before deciding where new files belong or how readable and writable content resolves across users and groups.

## The Three Layers

- `L0` is firmware. Repo-owned first-party code belongs here.
- `L1` is group customware. It is writable only for group managers and admins.
- `L2` is user customware. It is writable only for that user and admins.

## Group And User Structure

- `L1/_all` is the shared group layer available to everyone.
- `L1/_admin` is the admin group layer.
- `L2/<username>/user.yaml` stores user metadata such as `full_name`.
- `L2/<username>/meta/` holds auth state such as password and login session records.
- `L2/<username>/mod/` is that user's customware module root.
- `L1/<group>/group.yaml` is the canonical group membership and management file.
- When `CUSTOMWARE_GIT_HISTORY` is enabled, each writable `L1/<group>/` and `L2/<username>/` root may have a server-managed local Git history repository.
- L2 history ignores `meta/password.json` and `meta/logins.json`; rollback preserves those current auth files and keeps previous heads listable for forward travel when possible, while revert creates a new inverse commit.

## Permission Model

- Nobody writes `L0`.
- Users may read their own `L2/<username>/`.
- Users may read `L0/<group>/` and `L1/<group>/` for groups they belong to.
- Users may write `L1/<group>/` only when they manage that group directly or through a managing-group include chain.
- `_admin` members may write any `L1/` and `L2/` path.

## Group Config Fields

`group.yaml` uses these canonical fields:

- `included_users`
- `included_groups`
- `managing_users`
- `managing_groups`

## Resolution Order

Readable module and extension resolution is rank-based:

1. `L0/_all`
2. readable `L0/<group>` entries in group order
3. `L1/_all`
4. readable `L1/<group>` entries in group order
5. `L2/<username>`

Higher-ranked exact same module-relative paths override lower-ranked ones. Different filenames under the same extension point compose together.

## Placement Rules For Repo Work

- Put repo-owned first-party development work in `app/L0/_all/mod/_core/...`.
- Use `L1` and `L2` only when the user explicitly wants layered customware or user- or group-specific overrides.
- Do not treat repo-local `app/L1` or `app/L2` as durable framework source; they are transient runtime state and are gitignored.
- Do not read, write, or depend on `.git` paths inside writable layer roots; they are reserved for server-managed history.

## Mandatory Doc Follow-Up

- If layer order, ownership rules, group semantics, or permission rules change, update the mirrored docs and the `development` skill subtree in the same session.
