{ ... }:

{
  perSystem =
    { pkgs, ... }:
    let
      compact = pkgs.callPackage ./compact.nix { };
      keyService = pkgs.runCommand "passport-key-service-app" { } ''
        mkdir -p $out/apps/passport-key-service/src $out/packages/contract/bin $out/packages/contract/resources
        cp ${../../apps/passport-key-service/src}/*.mjs $out/apps/passport-key-service/src/
        cp ${../../packages/contract/bin/restore-acc-keys.mjs} $out/packages/contract/bin/
        cp ${../../packages/contract/resources}/acc-s3r1.1.* $out/packages/contract/resources/
      '';
    in
    {
      packages = {
        inherit (compact)
          compact-midnight
          compact-toolchain
          compact-toolchain-0_31_1
          compact-toolchains
          ;
      }
      // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
        passport-key-service-image = pkgs.dockerTools.buildLayeredImage {
          name = "midnight-passport-keys";
          tag = "build";
          contents = [
            pkgs.nodejs_22
            compact.compact-toolchain
            keyService
          ];
          extraCommands = ''
            mkdir -p data/keys tmp
            chmod 0777 data/keys tmp
          '';
          config = {
            User = "10001:10001";
            Env = [
              "COMPACT_DIRECTORY=${compact.compact-toolchain}"
              "PASSPORT_KEY_DIR=/data/keys"
              "PASSPORT_KEY_HOST=0.0.0.0"
              "PASSPORT_KEY_PORT=8788"
              "NODE_ENV=production"
            ];
            Cmd = [
              "${pkgs.nodejs_22}/bin/node"
              "${keyService}/apps/passport-key-service/src/main.mjs"
            ];
            ExposedPorts."8788/tcp" = { };
            Volumes."/data/keys" = { };
            Labels = {
              "org.opencontainers.image.source" = "https://github.com/input-output-hk/midnight-passport-sdk";
              "org.opencontainers.image.description" =
                "Pinned Midnight Passport ACC key restore and HTTP service";
            };
          };
        };
      };
    };
}
