{ ... }:

{
  perSystem =
    { pkgs, ... }:
    let
      compact = pkgs.callPackage ./compact.nix { };
    in
    {
      packages = {
        inherit (compact)
          compact-midnight
          compact-toolchain
          compact-toolchain-0_31_1
          compact-toolchains
          ;
      };
    };
}
