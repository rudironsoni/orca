#!/usr/bin/env node
const [version, armSha256, intelSha256, channel = 'stable'] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+-horca\.\d+(?:-beta\.\d+)?$/.test(version ?? '')) {
  throw new Error(`Invalid Horca version: ${version}`)
}
for (const digest of [armSha256, intelSha256]) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) {
    throw new Error(`Invalid SHA-256: ${digest}`)
  }
}
if (channel !== 'stable' && channel !== 'beta') {
  throw new Error(`Invalid channel: ${channel}`)
}

const token = channel === 'beta' ? 'horca@beta' : 'horca'
const betaLines = channel === 'beta' ? `\n  conflicts_with cask: "horca"\n` : ''

process.stdout.write(`cask "${token}" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armSha256}",
         intel: "${intelSha256}"

  url "https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg"
  name "Horca"
  desc "Downstream Orca distribution with additional integrations"
  homepage "https://github.com/rudironsoni/orca"
${betaLines}
  depends_on macos: :big_sur

  app "Horca.app"
  binary "#{appdir}/Horca.app/Contents/Resources/bin/horca"

  zap trash: [
    "~/.horca",
    "~/Library/Application Support/Horca",
    "~/Library/Caches/com.rudironsoni.horca",
    "~/Library/Caches/com.rudironsoni.horca.ShipIt",
    "~/Library/HTTPStorages/com.rudironsoni.horca",
    "~/Library/Preferences/com.rudironsoni.horca.plist",
    "~/Library/Saved Application State/com.rudironsoni.horca.savedState",
  ]
end
`)
