# The Compact devtool (`compact`) and compiler toolchains (`compactc`), from
# the official midnightntwrk/compact release binaries, fetched by hash.
#
# Same construction as MediaNoxLabs/flake-collection's compact-midnight and
# compact-toolchain, parameterised by version so that several toolchains can
# sit side by side in one COMPACT_DIRECTORY: the default (newest) one, plus the
# 0.31.1 that packages/contract/acc-versions.generated.json still records for
# the prototype binding (`compact compile +0.31.1 …`).
{
  lib,
  stdenv,
  fetchurl,
  fetchzip,
  unzip,
  runCommand,
}:

let
  system = stdenv.hostPlatform.system;

  cliPlatforms = {
    x86_64-linux = "x86_64-unknown-linux-musl";
    aarch64-darwin = "aarch64-apple-darwin";
  };
  toolchainPlatforms = {
    x86_64-linux = "x86_64-unknown-linux-musl";
    aarch64-darwin = "aarch64-darwin";
  };

  supported =
    lib.assertMsg (cliPlatforms ? ${system})
      "compact: unsupported system ${system}; supported: ${lib.concatStringsSep ", " (lib.attrNames cliPlatforms)}";

  # Release-asset hashes. compactc zips are NAR hashes of the unpacked tree
  # (fetchzip, stripRoot = false); the CLI tarballs are flat file hashes,
  # equal to the release's published `.sha256` files.
  hashes = {
    cli."0.5.3" = {
      x86_64-linux = "sha256-36rszv4NdwlSkyCBcbzvxIUpuNCU2to2cLDgaEky1gU=";
      aarch64-darwin = "sha256-rtkeXKekpsanMIBtdSzvBQNStGFazMIqOyO1c23Pn/o=";
    };
    toolchain."0.31.1" = {
      x86_64-linux = "sha256-75nwiVASCtJQ+wXVe8P5wUDmy3TevYfZ88O+qtH0lJU=";
      aarch64-darwin = "sha256-QKfLjKbOBSIuxJXfYhkPgDJkn4CcsRsV6M1ULSRem9o=";
    };
    toolchain."0.35.0" = {
      x86_64-linux = "sha256-aWALrzEmnXeODkXFRIQSaaOadMuuTIp4ln3B5YNJSk0=";
      aarch64-darwin = "sha256-XK7taJYnQCybajS5ZUIKJLffHTsUWbF2cacW/q9Q8KI=";
    };
  };

  mkCli =
    version:
    assert supported;
    stdenv.mkDerivation {
      pname = "compact-midnight";
      inherit version;
      src = fetchurl {
        url = "https://github.com/midnightntwrk/compact/releases/download/compact-v${version}/compact-${cliPlatforms.${system}}.tar.xz";
        hash = hashes.cli.${version}.${system};
      };
      sourceRoot = "compact-${cliPlatforms.${system}}";
      installPhase = ''
        runHook preInstall
        install -Dm755 compact $out/bin/compact
        runHook postInstall
      '';
      meta = {
        description = "Compact devtool CLI v${version}";
        homepage = "https://github.com/midnightntwrk/compact";
        license = lib.licenses.asl20;
        platforms = lib.attrNames cliPlatforms;
        mainProgram = "compact";
      };
    };

  mkToolchain =
    version:
    assert supported;
    let
      platform = toolchainPlatforms.${system};
    in
    stdenv.mkDerivation {
      pname = "compact-toolchain";
      inherit version;
      src = fetchzip {
        url = "https://github.com/midnightntwrk/compact/releases/download/compactc-v${version}/compactc_v${version}_${platform}.zip";
        hash = hashes.toolchain.${version}.${system};
        stripRoot = false;
      };
      nativeBuildInputs = [ unzip ];

      # The `compact` devtool reads bin/compactc as a symlink and resolves its
      # target string to find the compiler; it cannot follow relative links.
      dontRewriteSymlinks = true;

      installPhase = ''
        runHook preInstall

        compact_dir="$out/versions/${version}/${platform}"
        mkdir -p "$compact_dir"
        cp -r * "$compact_dir"/

        # The upstream wrapper derives its directory from `dirname "$0"`,
        # which is bin/ when invoked through the bin/compactc symlink. Pin it
        # to the (immutable) toolchain directory instead.
        chmod +w "$compact_dir/compactc"
        substituteInPlace "$compact_dir/compactc" \
          --replace-fail 'thisdir="$(cd $(dirname $0) ; pwd -P)"' \
          "thisdir=\"$compact_dir\""

        mkdir -p $out/bin
        for tool in compactc fixup-compact format-compact; do
          ln -s "$compact_dir/$tool" "$out/bin/$tool"
        done

        runHook postInstall
      '';
      meta = {
        description = "Compact compiler toolchain v${version} in the COMPACT_DIRECTORY layout";
        homepage = "https://github.com/midnightntwrk/compact";
        license = lib.licenses.asl20;
        platforms = lib.attrNames toolchainPlatforms;
      };
    };

  # One COMPACT_DIRECTORY holding every toolchain; bin/ is the default's.
  mkToolchains =
    default: others:
    runCommand "compact-toolchains-${default.version}" { } ''
      mkdir -p $out/versions
      ${lib.concatMapStringsSep "\n" (
        tc: "ln -s ${tc}/versions/${tc.version} $out/versions/${tc.version}"
      ) ([ default ] ++ others)}
      ln -s ${default}/bin $out/bin
    '';

  compact-midnight = mkCli "0.5.3";
  compact-toolchain = mkToolchain "0.35.0";
  compact-toolchain-0_31_1 = mkToolchain "0.31.1";
in
{
  inherit compact-midnight compact-toolchain compact-toolchain-0_31_1;
  compact-toolchains = mkToolchains compact-toolchain [ compact-toolchain-0_31_1 ];
}
