{
  description = "cloudagents: cloud coding-agent platform MVP (TypeScript / Effect / web client)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Native / system dependencies. npm dependencies are pinned by bun.lock
        # and installed with `bun install` inside the dev shell.
        systemDeps = with pkgs; [
          # JS toolchain
          bun
          nodejs_22 # wrangler + some tooling expect node
          # VCS: git worktrees are the unit of parallel agent work
          git
          # Remote desktop stack (one virtual X display per task)
          xvfb         # virtual X server (xorg.xvfb is deprecated)
          openbox       # minimal window manager
          xterm         # default app on agent desktops
          xdotool       # input injection (mouse/keyboard) from the web client / MCP
          ffmpeg-full   # x11grab capture -> H.264 -> fragmented MP4 (nixpkgs ffmpeg lacks x11grab)
          # Cloudflare demo deploy
          cloudflared
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages = systemDeps;

          shellHook = ''
            export CLOUDAGENTS_ROOT="$PWD"
            export CLOUDAGENTS_DATA_DIR="''${CLOUDAGENTS_DATA_DIR:-$PWD/.data}"
            export PATH="$PWD/node_modules/.bin:$PATH"
            echo "cloudagents dev shell: bun $(bun --version), ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3)"
          '';
        };

        # `nix run`: server on http://127.0.0.1:8787 and web dev server on http://localhost:5173.
        # `nix run .#tunnel`: server plus a cloudflared quick tunnel, for pointing a deployed web build at it.
        apps =
          let
            preflight = ''
              if [ ! -f flake.nix ] || [ ! -f package.json ]; then
                echo "run from the cloudagents repo root" >&2
                exit 1
              fi
              export CLOUDAGENTS_ROOT="$PWD"
              export CLOUDAGENTS_DATA_DIR="''${CLOUDAGENTS_DATA_DIR:-$PWD/.data}"
              if [ ! -d node_modules ]; then
                bun install --frozen-lockfile
              fi
            '';
            devRun = pkgs.writeShellApplication {
              name = "cloudagents-dev";
              runtimeInputs = systemDeps;
              text = ''
                ${preflight}
                trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
                bun run --filter @cloudagents/server dev &
                bun run --filter @cloudagents/web dev &
                wait -n
              '';
            };
            tunnelRun = pkgs.writeShellApplication {
              name = "cloudagents-tunnel";
              runtimeInputs = systemDeps;
              text = ''
                ${preflight}
                trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
                bun run --filter @cloudagents/server dev &
                echo "set VITE_CLOUDAGENTS_SERVER to the https URL printed below, then rebuild the web app" >&2
                cloudflared tunnel --url http://127.0.0.1:8787
              '';
            };
          in
          {
            default = {
              type = "app";
              program = "${devRun}/bin/cloudagents-dev";
            };
            tunnel = {
              type = "app";
              program = "${tunnelRun}/bin/cloudagents-tunnel";
            };
          };

        formatter = pkgs.nixpkgs-fmt;
      });
}
