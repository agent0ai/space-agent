# AGENTS

## Purpose

`L0/_admin/mod/_core/overlay_agent/` owns admin-only skill content for the onscreen overlay agent.

This module is a scoped skill carrier, not a second overlay runtime. It exists so `_admin`-readable users can load additional operational skills without exposing them to non-admin users.

Documentation is top priority for this module. After any change under this subtree, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/skills/admin-user-management/SKILL.md`: top-level admin user-management router skill
- `ext/skills/admin-user-management/users/SKILL.md`: user-account storage and mutation guidance
- `ext/skills/admin-user-management/groups/SKILL.md`: group membership and manager-graph guidance

## Local Contracts

- this module contributes onscreen skills only through `ext/skills/.../SKILL.md`
- because it lives under `L0/_admin`, its skill files should only be readable through the existing group-based app-file permission model for `_admin` users
- this module's skills are still onscreen-only despite being admin-readable; their frontmatter should require the live `onscreen` skill-context tag so they do not leak into the separate `/admin` agent runtime
- top-level skill ids in this module must stay unique against readable `_all` skills; admin users read both scopes, so id collisions would hide the conflicting skills from the catalog
- this module must not duplicate or fork the shared onscreen-agent runtime; runtime behavior still belongs to `_all/mod/_core/onscreen_agent/`
- this module's skill content should stay aligned with the auth, group, and file-layout contracts documented under `server/lib/auth/`, `server/lib/customware/`, `server/api/`, and `commands/`
- admin-gated skill guidance should verify `_admin` membership through `space.api.userSelfInfo().groups`, not a separate boolean field

## Development Guidance

- keep the top-level skill short and route into deeper task-specific skills when the topic grows
- prefer logical app paths like `L1/<group>/group.yaml` and `L2/<username>/user.yaml`, not disk paths
- describe browser-usable API workflows first; mention CLI equivalents only as reference context
- if auth, user storage, group semantics, or admin visibility rules change, update this module's skill files in the same session
