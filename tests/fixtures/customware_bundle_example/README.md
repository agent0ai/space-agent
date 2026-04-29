# Customware Bundle Example

This is a tiny reference bundle fixture. Copy it into a normal customware module root to test discovery:

```txt
L1/team/mod/example/customware_bundle_example/
L2/alice/mod/example/customware_bundle_example/
```

The manifest advertises the seams a bundle may use. Executable behavior still enters through normal module files such as `ext/html`, `ext/js`, `ext/skills`, and runtime registration through `space.bundles.actions`.
