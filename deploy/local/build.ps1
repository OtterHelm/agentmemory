# Modified by OtterHelm for this custom distribution; see deploy/local/README.md.
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path "$PSScriptRoot/../..")
try {
  npx tsdown
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  Copy-Item -LiteralPath iii-config.yaml,iii-config.docker.yaml,docker-compose.yml,.env.example -Destination dist
  New-Item -ItemType Directory -Force dist/viewer | Out-Null
  Copy-Item -LiteralPath src/viewer/index.html,src/viewer/favicon.svg -Destination dist/viewer
  docker build -f deploy/local/Dockerfile -t agentmemory-local:0.9.29-incremental-ko6 .
  if ($LASTEXITCODE -ne 0) { throw 'Docker build failed' }
} finally { Pop-Location }
