{
  description = "Browser-first AI agent with a thin Node.js server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        space-agent = pkgs.buildNpmPackage {
          pname = "space-agent";
          version = "0.36.0";
          src = ./.;

          npmDeps = pkgs.fetchNpmDeps {
            src = ./.;
            hash = "sha256-GvKSULl2i+6pDjrodxFKgeA0FS/jeGnHS+sas8GVj38=";
          };

          dontNpmBuild = true;

          installPhase = ''
            mkdir -p $out/bin
            mkdir -p $out/lib/node_modules/space-agent

            # Copy all source files
            cp -r . $out/lib/node_modules/space-agent/

            # Create wrapper script
            cat > $out/bin/space <<EOF
    #!${pkgs.bash}/bin/bash
    cd $out/lib/node_modules/space-agent
    exec ${pkgs.nodejs_22}/bin/node space "\$@"
    EOF

            chmod +x $out/bin/space
          '';

          meta = {
            description = "Browser-first AI agent with a thin Node.js server";
            homepage = "https://github.com/agent0ai/space-agent";
            license = pkgs.lib.licenses.mit;
            mainProgram = "space";
          };
        };
      in
      {
        packages.default = space-agent;
        apps.default = {
          type = "app";
          program = "${space-agent}/bin/space";
        };

        overlays.default = final: prev: {
          space-agent = space-agent;
        };

        checks = {
          build = space-agent;
        };
      }
    );
}
