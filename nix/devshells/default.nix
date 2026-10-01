{ ... }:

{
  perSystem =
    { pkgs, self', ... }:
    {
      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          # Node per .nvmrc and package.json engines. pnpm 10 switches itself
          # to the exact `packageManager` version on first use.
          nodejs_22
          pnpm_10

          git
          gh
          jq

          # Local TLS: passkey / WebAuthn PRF flows need a secure context even
          # on localhost (devenv skill, check 2).
          mkcert

          self'.packages.compact-midnight
          self'.packages.compact-toolchains
        ];

        shellHook = ''
          # Point the `compact` devtool at the pinned, read-only toolchains
          # instead of ~/.compact: `compact compile` uses 0.35.0, and
          # `compact compile +0.31.1` the toolchain the prototype binding
          # records.
          export COMPACT_DIRECTORY=${self'.packages.compact-toolchains}
        '';
      };
    };
}
