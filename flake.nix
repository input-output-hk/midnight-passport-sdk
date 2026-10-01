{
  description = "Midnight Passport SDK — local development toolset";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";

    # The Compact devtool (`compact`) and compiler (`compactc`) come from this
    # reusable flake, which fetches the official midnightntwrk/compact release
    # binaries by hash. Its pins (CLI 0.5.1, compiler 0.31.1) match the
    # toolchain recorded in packages/contract/acc-versions.generated.json.
    flake-collection.url = "github:MediaNoxLabs/flake-collection";
    flake-collection.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        ./nix/packages
        ./nix/devshells
      ];
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, ... }:
        {
          formatter = pkgs.nixfmt;
        };
    };
}
