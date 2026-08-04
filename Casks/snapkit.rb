# Homebrew cask, served straight from this repo as a tap:
#   brew tap simiriva95/snapkit https://github.com/simiriva95/snapkit
#   brew install --cask --no-quarantine snapkit
#
# --no-quarantine is required until the app is notarized: Homebrew quarantines
# cask downloads by default and Gatekeeper rejects unnotarized quarantined apps.
# version/sha256 are bumped automatically by .github/workflows/release.yml.
cask "snapkit" do
  version "0.4.4"
  sha256 "23504f901226e2c29c16eaf4328bebcf8635bb2d3f75376f1fc6bda3897c59df"

  url "https://github.com/simiriva95/snapkit/releases/download/v#{version}/Snapkit-#{version}-arm64-mac.zip"
  name "Snapkit"
  desc "Developer-first screenshot & annotation tool with local secret redaction"
  homepage "https://github.com/simiriva95/snapkit"

  depends_on arch: :arm64
  app "Snapkit.app"

  caveats <<~EOS
    Snapkit is not notarized yet — install with the --no-quarantine flag:
      brew install --cask --no-quarantine snapkit
    If you installed without it and macOS says the app is damaged:
      xattr -cr /Applications/Snapkit.app
  EOS
end
