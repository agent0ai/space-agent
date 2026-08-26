# AGENTS

## Purpose

`server/lib/share/` owns the backend-hosted space-share helper.

It stores hosted share ZIP archives outside the logical app tree, validates imported archives before they are installed into a user space, and drives the anonymous guest-clone flow used by public shared-space links.

Documentation is top priority for this subtree. After any change under `server/lib/share/`, update this file and any affected parent or endpoint docs in the same session.

## Ownership

Current files:

- `service.js`: hosted-share token allocation, metadata storage, share URL generation, archive extraction and validation, imported-space naming, authenticated import, and guest-clone installation

## Local Contracts

### Storage And Validation Contract

Hosted shares are backend-owned server state, not app files.

Current storage contract:

- hosted archives live under `CUSTOMWARE_PATH/share/spaces/<token>.zip`
- matching metadata lives under `CUSTOMWARE_PATH/share/spaces/<token>.json`
- the token is an 8-character mixed-case alphanumeric id
- metadata currently stores `token`, `createdAt`, `lastUsedAt`, `sizeBytes`, `encrypted`, and optional browser-side encryption parameters
- hosted uploads are accepted only when `CLOUD_SHARE_ALLOWED=true`, guest users are enabled, and `CUSTOMWARE_PATH` is configured
- upload-time checks stay intentionally narrow: non-empty payload, maximum size `2 MB`, and well-formed optional password-encryption metadata
- upload-time handlers must not unpack or deeply inspect the archive; archive validation belongs to the import and clone path

Current validation contract:

- archives are unpacked only into a unique per-request directory under `server/tmp/`
- ZIP inspection and extraction use the host `unzip` tool through the shared helper, not endpoint-local shell calls
- archive entries must stay relative and must not contain `..`, absolute roots, or drive-qualified paths
- extracted trees must not contain symbolic links
- the archive must contain exactly one space root, either directly or one folder deep
- that extracted space root must include a readable `space.yaml` and at least one non-empty widget file
- YAML widget files must parse and include a non-empty `renderer` field

### Import And Clone Contract

Current install rules:

- authenticated imports and anonymous guest clones both reuse the same extraction and install helper path
- imported destinations ignore any incoming archive id for the destination folder name
- non-replace imports always install into the next free `imported-1`, `imported-2`, and so on for that user
- replace imports require an explicit target space id and overwrite that destination root
- installed manifests are rewritten so the persisted destination `id` and visible `title` both match the installed destination name
- installs always ensure `widgets/`, `data/`, and `assets/` exist after copy
- installs must record the concrete `/app/L2/<username>/spaces/<spaceId>/` mutation so file indexes and local history see the imported tree

Current guest-clone rules:

- public share links are opened by first downloading the hosted ZIP, then decrypting it in the browser when the share is password-protected, then posting the clear ZIP bytes to the clone endpoint
- clone-time validation runs before the guest user is created, so invalid or empty shares do not leave behind orphaned guest accounts
- successful clones create a fresh randomized `guest_...` user, install the shared space as the next `imported-N` destination for that guest, return that guest's temporary credentials to the public share shell for normal background login, and update the hosted share metadata `lastUsedAt`

## Work Guidance

### Local Work Rules

- keep hosted-share storage outside the logical app tree and outside `server/tmp/`; `server/tmp/` is only for request-scoped extraction work
- reuse this helper from endpoints and public share flows instead of duplicating token generation, ZIP validation, or destination naming elsewhere
- keep browser-side password protection limited to opaque ZIP encryption metadata; the backend should treat encrypted uploads as opaque bytes until the browser submits the decrypted archive for clone or import
- if hosted-share storage, archive validation, or install semantics change, update this file plus the matching docs in `server/api/AGENTS.md`, `server/pages/AGENTS.md`, and `app/L0/_all/mod/_core/documentation/docs/server/`

## Verification



## Child DOX Index

- No child DOX docs.
