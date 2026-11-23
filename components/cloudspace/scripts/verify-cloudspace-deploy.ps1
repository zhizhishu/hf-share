[CmdletBinding()]
param(
  [string]$GitHubRepo = "zhizhishu/cloudspace",
  [string]$Image = "ghcr.io/zhizhishu/cloudspace",
  [string]$HuggingFaceSpace = "your-account/cloudspace",
  [string]$AppUrl = "https://your-account-cloudspace.hf.space",
  [string]$WorkflowFile = "publish-image.yml",
  [string]$ExpectedCommitSha,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-GitHead {
  try {
    $sha = (& git rev-parse HEAD 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $sha) { return $sha }
  } catch {
    return $null
  }
  return $null
}

function Get-GhcrBearerToken {
  param([string]$Repository)
  $tokenUrl = "https://ghcr.io/token?scope=repository:${Repository}:pull&service=ghcr.io"
  return (Invoke-RestMethod -Uri $tokenUrl -TimeoutSec 30).token
}

function Get-GhcrLatestImage {
  param([string]$ImageRef)

  if ($ImageRef -notmatch "^ghcr\.io/(?<repo>.+)$") {
    throw "Only ghcr.io image references are supported: $ImageRef"
  }

  $repo = $Matches.repo
  $token = Get-GhcrBearerToken -Repository $repo
  $headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"
  }

  $manifestUrl = "https://ghcr.io/v2/$repo/manifests/latest"
  $head = Invoke-WebRequest -Uri $manifestUrl -Headers $headers -Method Head -UseBasicParsing -TimeoutSec 30
  $digest = [string]$head.Headers["Docker-Content-Digest"]

  $manifest = Invoke-RestMethod -Uri "https://ghcr.io/v2/$repo/manifests/$digest" -Headers $headers -TimeoutSec 30
  $created = $null
  if ($manifest.config.digest) {
    $config = Invoke-RestMethod -Uri "https://ghcr.io/v2/$repo/blobs/$($manifest.config.digest)" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30
    $created = $config.created
  }

  [pscustomobject]@{
    image = "$ImageRef`:latest"
    digest = $digest
    created = $created
  }
}

function Get-HfPinnedImage {
  param([string]$SpaceId)

  $dockerfileUrl = "https://huggingface.co/spaces/$SpaceId/raw/main/Dockerfile"
  $dockerfile = (Invoke-WebRequest -Uri $dockerfileUrl -UseBasicParsing -TimeoutSec 30).Content
  $digest = $null
  if ($dockerfile -match "ghcr\.io/zhizhishu/cloudspace@(?<digest>sha256:[a-f0-9]{64})") {
    $digest = $Matches.digest
  }

  [pscustomobject]@{
    space = $SpaceId
    dockerfileUrl = $dockerfileUrl
    digest = $digest
  }
}

function Get-LatestWorkflowRun {
  param(
    [string]$Repo,
    [string]$Workflow
  )

  $url = "https://api.github.com/repos/$Repo/actions/workflows/$Workflow/runs?per_page=1"
  $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "cloudspace-deploy-check" } -TimeoutSec 30
  $run = @($response.workflow_runs)[0]
  if (-not $run) {
    throw "No workflow runs found for $Repo/$Workflow"
  }

  [pscustomobject]@{
    id = $run.id
    number = $run.run_number
    title = $run.display_title
    headSha = $run.head_sha
    status = $run.status
    conclusion = $run.conclusion
    url = $run.html_url
    updatedAt = $run.updated_at
  }
}

function Get-CloudSpaceHealth {
  param([string]$BaseUrl)

  $healthUrl = "$($BaseUrl.TrimEnd('/'))/__cloudspace/health"
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 40
  [pscustomobject]@{
    url = $healthUrl
    ok = [bool]$health.ok
    routeModel = $health.gateway.routeModel
    uptimeSeconds = $health.gateway.uptimeSeconds
    apiOk = [bool]$health.api.ok
    apiProbeMs = $health.api.probe.ms
    httpMetaOk = [bool]$health.httpMeta.ok
    httpMetaProbeMs = $health.httpMeta.probe.ms
    raw = $health
  }
}

if (-not $ExpectedCommitSha) {
  $ExpectedCommitSha = Get-GitHead
}

$workflow = Get-LatestWorkflowRun -Repo $GitHubRepo -Workflow $WorkflowFile
$ghcr = Get-GhcrLatestImage -ImageRef $Image
$hf = Get-HfPinnedImage -SpaceId $HuggingFaceSpace
$health = Get-CloudSpaceHealth -BaseUrl $AppUrl

$checks = [ordered]@{
  workflowCompleted = ($workflow.status -eq "completed")
  workflowSucceeded = ($workflow.conclusion -eq "success")
  workflowMatchesExpectedCommit = (-not $ExpectedCommitSha -or $workflow.headSha -eq $ExpectedCommitSha)
  huggingFacePinsLatestGhcrDigest = ($hf.digest -and $ghcr.digest -and $hf.digest -eq $ghcr.digest)
  liveHealthOk = $health.ok
  liveApiOk = $health.apiOk
  liveHttpMetaOk = $health.httpMetaOk
}

$ok = -not (@($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count)

$result = [pscustomobject]@{
  ok = $ok
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  expectedCommitSha = $ExpectedCommitSha
  github = [pscustomobject]@{
    repo = $GitHubRepo
    workflow = $WorkflowFile
    latestRun = $workflow
  }
  ghcr = $ghcr
  huggingFace = $hf
  live = $health
  checks = [pscustomobject]$checks
}

if ($Json) {
  $result | ConvertTo-Json -Depth 10
} else {
  $statusText = if ($ok) { "OK" } else { "FAILED" }
  "CloudSpace deploy check: $statusText"
  "GitHub Actions: #$($workflow.number) $($workflow.conclusion) $($workflow.headSha.Substring(0, 7)) - $($workflow.title)"
  "GHCR latest: $($ghcr.digest) created=$($ghcr.created)"
  "Hugging Face pin: $($hf.digest)"
  "Live health: ok=$($health.ok) api=$($health.apiOk) httpMeta=$($health.httpMetaOk) uptime=$($health.uptimeSeconds)s"
  "Checks:"
  foreach ($entry in $checks.GetEnumerator()) {
    "  - $($entry.Key): $($entry.Value)"
  }
}

if (-not $ok) {
  exit 1
}
