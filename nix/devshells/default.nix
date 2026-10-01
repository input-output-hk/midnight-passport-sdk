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
          self'.packages.compact-toolchain
        ];

        shellHook = ''
          # Point the `compact` devtool at the pinned, read-only toolchain
          # instead of ~/.compact, so `compact compile` uses compiler 0.31.1.
          export COMPACT_DIRECTORY=${self'.packages.compact-toolchain}
        '';
      };
    };
}
