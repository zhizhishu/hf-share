#!/usr/bin/env bash
#
# cirrus-rename.sh — idempotent rebrand transform for a mihomo source checkout.
#
# WHAT IT DOES
#   Rewrites the brand "mihomo"/"Mihomo Meta" to "Cirrus" and changes OUR Go
#   module path so the compiled binary stops carrying identifiable
#   `github.com/metacubex/mihomo` import paths (these survive -trimpath because
#   -trimpath only strips the *build machine* filesystem prefix, NOT package
#   import paths, which are baked into the runtime pclntab / type metadata).
#
# WHAT IT DELIBERATELY DOES NOT TOUCH
#   * Third-party deps under `github.com/metacubex/<name>` (age, sing, quic-go,
#     gvisor, tls, utls, ...). Those are real upstream libraries, not ours to
#     rename. Renaming them would break dependency resolution. As a consequence
#     the string "metacubex" REMAINS in the final binary via those deps.
#   * Protobuf message namespaces in *.pb.go (e.g.
#     "mihomo.component.geodata.router") — changing them risks geodata/geosite
#     parsing. Left intact on purpose (a few residual "mihomo" strings).
#   * *_test.go files (not compiled into the binary).
#   * Config field names / protocol names / RESTful API field names other than
#     the cosmetic ones washed below.
#
# IDEMPOTENT: safe to run multiple times. The module edit is guarded; every sed
# is a one-way old->new substitution, so re-runs are no-ops.
#
# USAGE: run from the ROOT of a mihomo source checkout (where go.mod lives):
#     bash scripts/cirrus-rename.sh
#
set -euo pipefail

OLD_MODULE="github.com/metacubex/mihomo"
NEW_MODULE="github.com/zhizhishu/cirrus"

if [ ! -f go.mod ]; then
  echo "ERROR: go.mod not found; run this from the mihomo source root." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: rewrite OUR go module path (go.mod 'module' line).
# ---------------------------------------------------------------------------
echo "[cirrus-rename] step 1/3: module path ${OLD_MODULE} -> ${NEW_MODULE}"
if grep -q "^module ${OLD_MODULE}\$" go.mod; then
  go mod edit -module "${NEW_MODULE}"
  echo "  module line updated"
elif grep -q "^module ${NEW_MODULE}\$" go.mod; then
  echo "  already ${NEW_MODULE} (idempotent skip)"
else
  echo "  WARNING: unexpected module line below; not modifying:"
  grep '^module' go.mod >&2 || true
fi

# ---------------------------------------------------------------------------
# Step 2: rewrite OUR internal import paths in every *.go file.
# The literal "github.com/metacubex/mihomo" is unique to our module: no
# dependency shares that exact prefix (deps are .../age, .../sing, ...), so a
# literal global replace cannot touch upstream import paths.
# ---------------------------------------------------------------------------
echo "[cirrus-rename] step 2/3: internal import paths in *.go"
mapfile -t _files < <(grep -rl --include='*.go' "${OLD_MODULE}" . || true)
if [ "${#_files[@]}" -gt 0 ]; then
  for f in "${_files[@]}"; do
    sed -i "s#${OLD_MODULE}#${NEW_MODULE}#g" "$f"
  done
  echo "  rewrote ${#_files[@]} file(s)"
else
  echo "  no *.go contains ${OLD_MODULE} (idempotent skip)"
fi

# ---------------------------------------------------------------------------
# Step 3: wash cosmetic brand string literals (each is functionally inert in
# the http-meta core-driver flow; see comments). All substitutions are
# one-way, hence idempotent.
# ---------------------------------------------------------------------------
echo "[cirrus-rename] step 3/3: wash brand string literals"

# 3a. `-v` banner: "Mihomo Meta %s ..." -> "Cirrus %s ..."  (main.go)
[ -f main.go ] && sed -i 's#"Mihomo Meta #"Cirrus #' main.go

# 3b. internal app-name constant value (constant/version.go).
#     Used as a cosmetic process/host identifier (tailscale IPNVersion,
#     inner-listener process name). Value only; symbol name unchanged.
[ -f constant/version.go ] && sed -i 's#MihomoName = "mihomo"#MihomoName = "cirrus"#' constant/version.go

# 3c. default app name + executable fallback (constant/path.go).
#     Drives the *default* config home dir (~/.config/mihomo) and an
#     os.Executable() fallback string. http-meta always passes explicit
#     config paths/env, so the default is never used in our flow.
if [ -f constant/path.go ]; then
  sed -i 's#const Name = "mihomo"#const Name = "cirrus"#' constant/path.go
  sed -i 's#return "mihomo"#return "cirrus"#' constant/path.go
fi

# 3d. shutdown log line (hub/executor/executor.go) — pure log text.
[ -f hub/executor/executor.go ] && sed -i 's#"Mihomo shutting down"#"Cirrus shutting down"#' hub/executor/executor.go

# 3e. default outbound User-Agent (config/config.go): "clash.meta/" -> "cirrus/".
#     This is the UA used when the core itself fetches proxy/rule providers.
#     In the http-meta flow proxies are POSTed inline, so the default UA is not
#     exercised. NOTE (reversible): if you later have the core fetch a provider
#     that gates on a "clash"-family UA, revert this line.
[ -f config/config.go ] && sed -i 's#"clash.meta/"#"cirrus/"#' config/config.go

# 3f. RESTful API root greeting (hub/route/server.go): {"hello":"mihomo"}.
#     Informational only; not part of the proxy/test contract http-meta uses.
#     NOTE (reversible): revert if a dashboard/probe insists on "mihomo".
[ -f hub/route/server.go ] && sed -i 's#"hello": "mihomo"#"hello": "cirrus"#' hub/route/server.go

# 3g. core self-update URLs + asset names (component/updater/update_core.go).
#     These power the *binary self-update* feature, which is never invoked when
#     the core is driven by http-meta. Washed so the release-host brand strings
#     ("MetaCubeX/mihomo", "mihomo-<os>-<arch>") do not linger in the binary.
if [ -f component/updater/update_core.go ]; then
  sed -i 's#github.com/MetaCubeX/mihomo#github.com/zhizhishu/cirrus#g' component/updater/update_core.go
  sed -i 's#"mihomo-%s-#"cirrus-%s-#g' component/updater/update_core.go
fi

# 3h. `-v` flag help text (main.go): "show current version of mihomo".
[ -f main.go ] && sed -i 's#show current version of mihomo#show current version of cirrus#' main.go

# 3i. anytls client identifier (transport/anytls/session/session.go): the
#     handshake "client" field value "mihomo/<ver>". Cosmetic peer metadata;
#     anytls servers do not gate on it. NOTE (reversible).
[ -f transport/anytls/session/session.go ] && sed -i 's#"mihomo/"#"cirrus/"#' transport/anytls/session/session.go

# 3j. openvpn IV_VER peer-info string (transport/openvpn/keymethod.go):
#     "IV_VER=mihomo-openvpn". Informational peer-info; servers don't validate.
#     NOTE (reversible).
[ -f transport/openvpn/keymethod.go ] && sed -i 's#IV_VER=mihomo-openvpn#IV_VER=cirrus-openvpn#' transport/openvpn/keymethod.go

# 3k. tproxy iptables chain names (listener/tproxy/tproxy_iptables.go):
#     "mihomo_divert"/"mihomo_prerouting"/"mihomo_output"/"mihomo_dns_output".
#     Self-referential chain names created+used within this one file; renaming
#     all of them together stays internally consistent. Only used on Linux
#     tproxy (not exercised by http-meta), but washed for brand cleanliness.
[ -f listener/tproxy/tproxy_iptables.go ] && sed -i 's#mihomo_#cirrus_#g' listener/tproxy/tproxy_iptables.go

# NOTE — intentionally NOT washed: protobuf message namespace
# "mihomo.component.geodata.router" in component/geodata/router/config.pb.go.
# It is the generated proto type namespace used by geosite/geoip (.dat/.mmdb)
# parsing; renaming it risks geodata decoding. One residual "mihomo" string
# is accepted here in exchange for guaranteed geodata compatibility.

echo "[cirrus-rename] done."
echo "----------------------------------------------------------------------"
echo "Residual *source* 'mihomo' (case-insensitive) outside *.pb.go / *_test.go"
echo "(these are intentionally kept; see header notes):"
grep -rin --include='*.go' mihomo . \
  | grep -v '_test.go:' \
  | grep -v '\.pb\.go:' \
  || echo "  (none)"
echo "----------------------------------------------------------------------"
