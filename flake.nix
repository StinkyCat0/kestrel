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
          # Agent sandbox: every agent run and MCP exec runs inside bubblewrap
          bubblewrap
          # Remote desktop stack (one virtual X display per task)
          xvfb         # virtual X server (xorg.xvfb is deprecated)
          openbox       # minimal window manager
          xterm         # default app on agent desktops
          xdotool       # input injection (mouse/keyboard) from the web client / MCP
          ffmpeg-full   # x11grab capture -> H.264 -> fragmented MP4 (nixpkgs ffmpeg lacks x11grab)
          # Local control plane (`wrangler dev`); nixpkgs' build runs workerd on NixOS
          wrangler
        ];

        # Toolchain visible inside the agent sandbox; PATH inside the sandbox is exactly this.
        sandboxEnv = pkgs.buildEnv {
          name = "cloudagents-sandbox-env";
          paths = with pkgs; [
            bash
            coreutils
            findutils
            gnugrep
            gnused
            gawk
            which
            procps
            git
            curl
            ripgrep
            nodejs_22
            bun
            claude-code
          ];
        };
        sandboxSsl = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
      in
      {
        devShells.default = pkgs.mkShell {
          packages = systemDeps;

          shellHook = ''
            export CLOUDAGENTS_ROOT="$PWD"
            export CLOUDAGENTS_DATA_DIR="''${CLOUDAGENTS_DATA_DIR:-$PWD/.data}"
            export CLOUDAGENTS_SANDBOX_PATH="${sandboxEnv}/bin"
            export CLOUDAGENTS_SANDBOX_SSL="${sandboxSsl}"
            export PATH="$PWD/node_modules/.bin:$PATH"
            echo "cloudagents dev shell: bun $(bun --version), ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3)"
          '';
        };

        # `nix run`: full local stack with no cloud dependency: Worker control plane via `wrangler dev`
        #   (http://127.0.0.1:8788, dev sign-in), a box connected to it, and Vite on http://localhost:5173.
        # `nix run .#box`: box only, sandboxed agents. Sources ./.box.env (gitignored) for the
        #   production control-plane URL and box token.
        apps =
          let
            preflight = ''
              if [ ! -f flake.nix ] || [ ! -f package.json ]; then
                echo "run from the cloudagents repo root" >&2
                exit 1
              fi
              export CLOUDAGENTS_ROOT="$PWD"
              export CLOUDAGENTS_DATA_DIR="''${CLOUDAGENTS_DATA_DIR:-$PWD/.data}"
              export CLOUDAGENTS_SANDBOX_PATH="${sandboxEnv}/bin"
              export CLOUDAGENTS_SANDBOX_SSL="${sandboxSsl}"
              if [ ! -d node_modules ]; then
                bun install --frozen-lockfile
              fi
            '';
            devRun = pkgs.writeShellApplication {
              name = "cloudagents-dev";
              runtimeInputs = systemDeps;
              text = ''
                ${preflight}
                # Separate from a production box on the same machine.
                export CLOUDAGENTS_DATA_DIR="''${CLOUDAGENTS_DEV_DATA_DIR:-$PWD/.data-dev}"
                export CLOUDAGENTS_PORT="''${CLOUDAGENTS_PORT:-8787}"
                vars=packages/web/.dev.vars
                if [ ! -f "$vars" ]; then
                  token=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
                  printf 'BOX_TOKEN=%s\nDEV_SESSION_LOGIN=dev\nALLOWED_GITHUB_LOGINS=dev\n' "$token" > "$vars"
                  echo "created $vars (dev sign-in as 'dev')"
                fi
                CLOUDAGENTS_BOX_TOKEN=$(sed -n 's/^BOX_TOKEN=//p' "$vars")
                export CLOUDAGENTS_BOX_TOKEN
                export CLOUDAGENTS_CONTROL_URL=http://127.0.0.1:8788
                if [ ! -d packages/web/dist ]; then
                  bun run build:web
                fi
                trap 'kill 0' EXIT
                (cd packages/web && wrangler dev --port 8788 --ip 127.0.0.1) &
                bun run --filter @cloudagents/server dev &
                bun run --filter @cloudagents/web dev &
                echo "open http://localhost:5173/auth/dev-login to sign in" >&2
                wait -n
              '';
            };
            boxRun = pkgs.writeShellApplication {
              name = "cloudagents-box";
              runtimeInputs = systemDeps;
              text = ''
                ${preflight}
                if [ -f .box.env ]; then
                  set -a
                  # shellcheck source=/dev/null
                  . ./.box.env
                  set +a
                fi
                exec bun run --filter @cloudagents/server dev
              '';
            };
          in
          {
            default = {
              type = "app";
              program = "${devRun}/bin/cloudagents-dev";
            };
            box = {
              type = "app";
              program = "${boxRun}/bin/cloudagents-box";
            };
          };

        formatter = pkgs.nixpkgs-fmt;
      });
}
