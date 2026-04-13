---
name: User Management
description: Create, update, and remove users by editing the canonical L2 user files and related group membership files.
metadata:
  when:
    tags:
      - admin
---

Use this skill when the user asks to create a user, remove a user, change a user's full name, reset a password, revoke sessions, or explain how user account files are organized.

## Canonical User Tree

- `L2/<username>/` is the user's root folder. If this folder is deleted, the local account data and user customware are removed.
- `L2/<username>/user.yaml` stores user metadata. `full_name` belongs here.
- `L2/<username>/meta/password.json` stores the backend-sealed SCRAM verifier used by login.
- `L2/<username>/meta/logins.json` stores signed session verifiers. Writing `{}` here revokes current sessions.
- `L2/<username>/mod/` is the optional user customware root.

There is no separate user registry file. The watched user index is derived from the files under `L2/<username>/`.

## File API Rules

- Create directories by writing a path that ends with `/`, for example `await space.api.fileWrite("L2/alice/")` or `await space.api.fileWrite("L2/alice/mod/")`.
- Delete files or directories with `await space.api.fileDelete(path)`. Directory deletes are recursive.
- Use `await space.api.call("password_generate", { method: "POST", body: { password } })` to create a fresh sealed password record before writing `meta/password.json`.
- Do not hand-roll `meta/password.json` or individual session entries. The backend secret must sign or seal them.
- Use `space.utils.yaml.parse()` and `space.utils.yaml.stringify()` when editing `user.yaml` or `group.yaml`.

## Common Operations

### List users

Use `await space.api.fileList("L2/", false)`. Each direct child directory is one user root.

### Create a user

Use a single path-safe username segment such as `alice` or `qa_bot`. Then:

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

### Change full name

Read `L2/<username>/user.yaml`, parse it, update `full_name`, and write it back.

```js
const path = "L2/alice/user.yaml";
const current = await space.api.fileRead(path);
const config = space.utils.yaml.parse(current.content || "");
config.full_name = "Alice Example";
return await space.api.fileWrite(path, space.utils.yaml.stringify(config));
```

### Reset password

Write a new sealed verifier record to `L2/<username>/meta/password.json`.

```js
const username = "alice";
const verifier = await space.api.call("password_generate", {
  method: "POST",
  body: { password: "new-password" }
});

return await space.api.fileWrite(
  `L2/${username}/meta/password.json`,
  `${JSON.stringify(verifier, null, 2)}\n`
);
```

If the user also wants to sign the user out everywhere, overwrite `L2/<username>/meta/logins.json` with `{}` in the same batch write. Do not attempt to write individual session entries yourself.

### Remove a user

Deleting `L2/<username>/` removes the local account files:

```js
return await space.api.fileDelete("L2/alice/");
```

If the user also wants membership cleanup, inspect writable `L1/*/group.yaml` files and remove that username from:

- `included_users`
- `managing_users`

Those group files are the canonical membership and manager records. Deleting only the user folder does not rewrite group configs automatically.
