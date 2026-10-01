{ ... }:

{
  perSystem =
    { inputs', ... }:
    {
      packages = {
        inherit (inputs'.flake-collection.packages) compact-midnight compact-toolchain;
      };
    };
}
