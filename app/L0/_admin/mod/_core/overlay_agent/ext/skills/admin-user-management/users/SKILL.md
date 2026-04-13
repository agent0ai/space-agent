---
name: Admin Users
description: Create, update, remove, and explain user accounts, password verifiers, sessions, and user-root storage as an admin.
metadata:
  when:
    tags:
      - onscreen
---

Use this skill for concrete user-account work.

## First Check

- Call `const info = await space.api.userSelfInfo()`.
- Confirm `info.groups.includes("_admin") === true`.
- Prefer logical app paths derived from the standard layer rules, not guessed disk paths.

## Canonical User Tree

- `L2/<username>/` is the user's logical root.
- `L2/<username>/user.yaml` stores user metadata such as `full_name`.
- `L2/<username>/meta/password.json` stores the backend-sealed SCRAM verifier.
- `L2/<username>/meta/logins.json` stores signed session verifiers.
- `L2/<username>/mod/` is that user's customware module root.

There is no separate user registry file. The watched user index is derived from files under `L2/<username>/`.

## Path Rules

- Use logical paths such as `L2/alice/user.yaml`.
- When writable storage is relocated under `CUSTOMWARE_PATH`, these logical paths stay the same.
- `fileWrite(".../")` creates a directory because the path ends with `/`.
- Do not hand-craft `meta/password.json` or individual session entries. Use `password_generate` for password records and only write `{}` when revoking sessions.

## Create A User

Use a normalized username segment such as `alice`, `ops_bot`, or `qa-team-1`.

```js
const username = "alice";
const fullName = "Alice Example";
const password = "replace-me";

const verifier = await space.api.call("password_generate", {
  method: "POST",
  body: { password }
});

return await space.api.fileWrite({
  files: [
    { path: `L2/${username}/` },
    { path: `L2/${username}/mod/` },
    {
      path: `L2/${username}/user.yaml`,
      content: space.utils.yaml.stringify({ full_name: fullName })
    },
    {
      path: `L2/${username}/meta/password.json`,
      content: `${JSON.stringify(verifier, null, 2)}\n`
    },
    {
      path: `L2/${username}/meta/logins.json`,
      content: "{}\n"
    }
  ]
});
```

## Update User Metadata

Read `user.yaml`, parse it, mutate the fields you need, and write it back.

```js
const path = "L2/alice/user.yaml";
const current = await space.api.fileRead(path);
const config = space.utils.yaml.parse(current.content || "");
config.full_name = "Alice Example";
return await space.api.fileWrite(path, space.utils.yaml.stringify(config));
```

## Reset A Password

Generate a fresh sealed verifier first, then overwrite `meta/password.json`.

```js
const verifier = await space.api.call("password_generate", {
  method: "POST",
  body: { password: "new-password" }
});

return await space.api.fileWrite(
  "L2/alice/meta/password.json",
  `${JSON.stringify(verifier, null, 2)}\n`
);
```

## Revoke Sessions

Overwrite `L2/<username>/meta/logins.json` with `{}`.

```js
return await space.api.fileWrite("L2/alice/meta/logins.json", "{}\n");
```

When resetting a password, prefer writing the new verifier and clearing `logins.json` in the same batch. Do not attempt to preserve or invent individual session entries.

## Remove A User

Deleting `L2/<username>/` removes the local account tree:

```js
return await space.api.fileDelete("L2/alice/");
```

Deleting a user root does not rewrite `L1/*/group.yaml` automatically. If the user should disappear from memberships or manager lists too, load `admin-user-management/groups` and remove that username from the affected group configs.

## Guest Accounts

- `guest_create` is the dedicated endpoint for guest creation when the runtime allows it.
- Do not hand-roll a `guest_` account unless the user explicitly wants a normal local user whose name happens to start that way.

## CLI Reference

Backend equivalents exist for operators outside the browser:

- `node space user create <username> --password <password> [--full-name <name>]`
- `node space user password <username> --password <password>`

From the overlay agent, prefer the browser APIs above.
