#!/bin/sh
set -eu

# ---- runtime log sanitizer ----
# Route this script's stdout/stderr AND every child engine's (subscription core,
# Cirrus proxy engine / http-meta wrapper, Stratus script lane — they all inherit
# these fds) through cloudspace-log-filter.js before anything reaches the container
# log. The filter neutralizes upstream brand identity and redacts subscription /
# node data (URLs, public IPs, credentials). Disable with
# CLOUDSPACE_LOG_FILTER_ENABLED=false. Fail-open: any setup error -> logs unfiltered
# but the service still starts.
CLOUDSPACE_LOG_FILTER="${CLOUDSPACE_LOG_FILTER:-/opt/app/cloudspace-log-filter.js}"
if [ "${CLOUDSPACE_LOG_FILTER_ENABLED:-true}" = "true" ] \
  && [ -z "${CLOUDSPACE_LOG_FILTER_ACTIVE:-}" ] \
  && [ -f "$CLOUDSPACE_LOG_FILTER" ] \
  && command -v node >/dev/null 2>&1; then
  _cs_log_fifo="${TMPDIR:-/tmp}/cloudspace-log.$$.fifo"
  if mkfifo "$_cs_log_fifo" 2>/dev/null; then
    export CLOUDSPACE_LOG_FILTER_ACTIVE=1
    # Reader first: it inherits the REAL stdout and blocks until a writer attaches.
    node "$CLOUDSPACE_LOG_FILTER" <"$_cs_log_fifo" &
    CLOUDSPACE_LOG_FILTER_PID="$!"
    # Now point our stdout+stderr (inherited by all children) at the fifo.
    exec >"$_cs_log_fifo" 2>&1
    # fds stay valid after unlink; drop the path so nothing else can find it.
    rm -f "$_cs_log_fifo"
  fi
fi

CLOUDSPACE_PRODUCT_NAME="${CLOUDSPACE_PRODUCT_NAME:-CloudSpace}"
export ACCESS_LOCK_ENABLED="${ACCESS_LOCK_ENABLED:-true}"
export ACCESS_LOCK_PORT="${PORT:-${ACCESS_LOCK_PORT:-3000}}"
export CLOUDSPACE_UPSTREAM_HOST="${CLOUDSPACE_UPSTREAM_HOST:-127.0.0.1}"
export CLOUDSPACE_UPSTREAM_PORT="${CLOUDSPACE_UPSTREAM_PORT:-3001}"
export SUB_STORE_UPSTREAM_HOST="${SUB_STORE_UPSTREAM_HOST:-$CLOUDSPACE_UPSTREAM_HOST}"
export SUB_STORE_UPSTREAM_PORT="${SUB_STORE_UPSTREAM_PORT:-$CLOUDSPACE_UPSTREAM_PORT}"

if [ "$ACCESS_LOCK_ENABLED" = "true" ]; then
  export CLOUDSPACE_BACKEND_API_HOST="${CLOUDSPACE_BACKEND_API_HOST:-127.0.0.1}"
  export CLOUDSPACE_BACKEND_API_PORT="${CLOUDSPACE_BACKEND_API_PORT:-$CLOUDSPACE_UPSTREAM_PORT}"
else
  export CLOUDSPACE_BACKEND_API_HOST="${CLOUDSPACE_PUBLIC_HOST:-0.0.0.0}"
  export CLOUDSPACE_BACKEND_API_PORT="${PORT:-${CLOUDSPACE_BACKEND_API_PORT:-3000}}"
fi

export CLOUDSPACE_BACKEND_MERGE="${CLOUDSPACE_BACKEND_MERGE:-true}"
export CLOUDSPACE_BACKEND_PATH="${CLOUDSPACE_BACKEND_PATH:-/2cXaAxRGfddmGz2yx1wA}"
export CLOUDSPACE_FRONTEND_PATH="${CLOUDSPACE_FRONTEND_PATH:-/opt/app/frontend}"
export CLOUDSPACE_DATA_BASE_PATH="${CLOUDSPACE_DATA_BASE_PATH:-/opt/app/data}"
export CLOUDSPACE_INTERNAL_API_BASE="${CLOUDSPACE_INTERNAL_API_BASE:-http://127.0.0.1:${CLOUDSPACE_BACKEND_API_PORT}${CLOUDSPACE_BACKEND_PATH}}"
export CLOUDSPACE_BODY_JSON_LIMIT="${CLOUDSPACE_BODY_JSON_LIMIT:-8mb}"
export CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE="${CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE:-6144}"
export CLOUDSPACE_ACCESS_NODE_MAX_OLD_SPACE_SIZE="${CLOUDSPACE_ACCESS_NODE_MAX_OLD_SPACE_SIZE:-128}"
export HTTP_META_BODY_JSON_LIMIT="${HTTP_META_BODY_JSON_LIMIT:-256mb}"
export HTTP_META_NODE_MAX_OLD_SPACE_SIZE="${HTTP_META_NODE_MAX_OLD_SPACE_SIZE:-8192}"
export CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-10}"
export CURL_MAX_TIME="${CURL_MAX_TIME:-180}"
export SUPABASE_STORAGE_BUCKET="${SUPABASE_STORAGE_BUCKET:-cloudspace}"
export SUPABASE_BACKUP_MAX_BYTES="${SUPABASE_BACKUP_MAX_BYTES:-16777216}"
export SUPABASE_BACKUP_REQUIRE_VALID_STORAGE="${SUPABASE_BACKUP_REQUIRE_VALID_STORAGE:-true}"
export SUPABASE_RESTORE_REQUIRE_VALID_STORAGE="${SUPABASE_RESTORE_REQUIRE_VALID_STORAGE:-true}"
export SUPABASE_DAILY_BACKUP_ENABLED="${SUPABASE_DAILY_BACKUP_ENABLED:-true}"
export SUPABASE_DAILY_BACKUP_PREFIX="${SUPABASE_DAILY_BACKUP_PREFIX:-cloudspace/daily}"
export CLOUDSPACE_CACHE_CLEANUP_ENABLED="${CLOUDSPACE_CACHE_CLEANUP_ENABLED:-true}"
export CLOUDSPACE_CACHE_CLEANUP_INTERVAL_SECONDS="${CLOUDSPACE_CACHE_CLEANUP_INTERVAL_SECONDS:-600}"
export CLOUDSPACE_CACHE_MAX_AGE_MINUTES="${CLOUDSPACE_CACHE_MAX_AGE_MINUTES:-360}"
export CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES="${CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES:-15}"
export CLOUDSPACE_CACHE_MAX_KB="${CLOUDSPACE_CACHE_MAX_KB:-262144}"
export CLOUDSPACE_CACHE_EMERGENCY_PURGE="${CLOUDSPACE_CACHE_EMERGENCY_PURGE:-true}"
export HTTP_META_RESTART_ENABLED="${HTTP_META_RESTART_ENABLED:-true}"
export HTTP_META_RESTART_DELAY_SECONDS="${HTTP_META_RESTART_DELAY_SECONDS:-5}"
# Internal compatibility for the bundled upstream core.
export SUB_STORE_BACKEND_API_HOST="${SUB_STORE_BACKEND_API_HOST:-$CLOUDSPACE_BACKEND_API_HOST}"
export SUB_STORE_BACKEND_API_PORT="${SUB_STORE_BACKEND_API_PORT:-$CLOUDSPACE_BACKEND_API_PORT}"
export SUB_STORE_BACKEND_MERGE="${SUB_STORE_BACKEND_MERGE:-$CLOUDSPACE_BACKEND_MERGE}"
export SUB_STORE_FRONTEND_BACKEND_PATH="${SUB_STORE_FRONTEND_BACKEND_PATH:-$CLOUDSPACE_BACKEND_PATH}"
export SUB_STORE_FRONTEND_PATH="${SUB_STORE_FRONTEND_PATH:-$CLOUDSPACE_FRONTEND_PATH}"
export SUB_STORE_DATA_BASE_PATH="${SUB_STORE_DATA_BASE_PATH:-$CLOUDSPACE_DATA_BASE_PATH}"
export SUB_STORE_INTERNAL_API_BASE="${SUB_STORE_INTERNAL_API_BASE:-$CLOUDSPACE_INTERNAL_API_BASE}"
export SUB_STORE_BODY_JSON_LIMIT="${SUB_STORE_BODY_JSON_LIMIT:-$CLOUDSPACE_BODY_JSON_LIMIT}"
export ACCESS_LOCK_UPSTREAM_HOST="${ACCESS_LOCK_UPSTREAM_HOST:-127.0.0.1}"
export ACCESS_LOCK_UPSTREAM_PORT="${ACCESS_LOCK_UPSTREAM_PORT:-$SUB_STORE_BACKEND_API_PORT}"
export ACCESS_LOCK_DATA_PATH="${ACCESS_LOCK_DATA_PATH:-$CLOUDSPACE_DATA_BASE_PATH/cloudspace-access.json}"

mkdir -p "$CLOUDSPACE_DATA_BASE_PATH"
export CLOUDSPACE_CACHE_PATHS="${CLOUDSPACE_CACHE_PATHS:-${HTTP_META_TEMP_FOLDER:-/tmp/http-meta}:/tmp/cloudspace-cache:${CLOUDSPACE_DATA_BASE_PATH}/cache:${CLOUDSPACE_DATA_BASE_PATH}/tmp:${CLOUDSPACE_DATA_BASE_PATH}/logs}"

curl_with_limits() {
  curl -fsS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    "$@"
}

is_safe_cache_path() {
  case "$1" in
    /tmp/*|"$CLOUDSPACE_DATA_BASE_PATH"/cache|"$CLOUDSPACE_DATA_BASE_PATH"/cache/*|"$CLOUDSPACE_DATA_BASE_PATH"/tmp|"$CLOUDSPACE_DATA_BASE_PATH"/tmp/*|"$CLOUDSPACE_DATA_BASE_PATH"/logs|"$CLOUDSPACE_DATA_BASE_PATH"/logs/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_http_meta_cache_path() {
  [ "$1" = "${HTTP_META_TEMP_FOLDER:-/tmp/http-meta}" ]
}

cleanup_cache_path() {
  dir="$1"
  [ -n "$dir" ] || return 0
  is_safe_cache_path "$dir" || {
    echo "Skipping unsafe cache cleanup path: $dir" >&2
    return 0
  }

  mkdir -p "$dir"

  if [ "${CLOUDSPACE_CACHE_MAX_AGE_MINUTES}" -gt 0 ] 2>/dev/null; then
    find "$dir" -type f -mmin +"$CLOUDSPACE_CACHE_MAX_AGE_MINUTES" -delete 2>/dev/null || true
    find "$dir" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  fi

  current_kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"
  current_kb="${current_kb:-0}"
  if [ "${CLOUDSPACE_CACHE_MAX_KB}" -gt 0 ] 2>/dev/null && [ "$current_kb" -gt "$CLOUDSPACE_CACHE_MAX_KB" ]; then
    echo "Cache path $dir is ${current_kb}KB; trimming files older than ${CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES} minutes"
    find "$dir" -type f -mmin +"$CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES" -delete 2>/dev/null || true
    find "$dir" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  fi

  current_kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"
  current_kb="${current_kb:-0}"
  if [ "${CLOUDSPACE_CACHE_MAX_KB}" -gt 0 ] 2>/dev/null && [ "$current_kb" -gt "$CLOUDSPACE_CACHE_MAX_KB" ]; then
    if is_http_meta_cache_path "$dir"; then
      echo "Cirrus engine cache path $dir is still ${current_kb}KB; keeping active files to avoid dropping the engine" >&2
    elif [ "$CLOUDSPACE_CACHE_EMERGENCY_PURGE" = "true" ]; then
      echo "Cache path $dir is still ${current_kb}KB; emergency purging cache files"
      find "$dir" -type f -delete 2>/dev/null || true
      find "$dir" -mindepth 1 -type d -empty -delete 2>/dev/null || true
    else
      echo "Cache path $dir is still ${current_kb}KB; emergency purge disabled" >&2
    fi
  fi
}

cleanup_cache_once() {
  [ "$CLOUDSPACE_CACHE_CLEANUP_ENABLED" = "true" ] || return 0
  old_ifs="$IFS"
  IFS=":"
  for dir in $CLOUDSPACE_CACHE_PATHS; do
    cleanup_cache_path "$dir"
  done
  IFS="$old_ifs"
}

cache_cleanup_loop() {
  cleanup_cache_once
  while true; do
    sleep "$CLOUDSPACE_CACHE_CLEANUP_INTERVAL_SECONDS"
    cleanup_cache_once
  done
}

start_cache_cleanup() {
  [ "$CLOUDSPACE_CACHE_CLEANUP_ENABLED" = "true" ] || return 0
  cache_cleanup_loop &
  CACHE_CLEANUP_PID="$!"
  echo "Cache cleanup enabled for: $CLOUDSPACE_CACHE_PATHS"
}

curl_to_file_with_limit() {
  output_file="$1"
  shift
  if [ "$SUPABASE_BACKUP_MAX_BYTES" -gt 0 ] 2>/dev/null; then
    curl_with_limits --max-filesize "$SUPABASE_BACKUP_MAX_BYTES" "$@" -o "$output_file"
  else
    curl_with_limits "$@" -o "$output_file"
  fi
}

supabase_backup_enabled() {
  [ "${SUPABASE_BACKUP_ENABLED:-false}" = "true" ] \
    && [ -n "${SUPABASE_URL:-}" ] \
    && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] \
    && [ -n "${SUPABASE_STORAGE_BUCKET:-}" ]
}

supabase_object_path() {
  printf '%s' "${SUPABASE_STORAGE_OBJECT:-cloudspace/storage.json}"
}

supabase_storage_url() {
  supabase_storage_url_for_object "$(supabase_object_path)"
}

supabase_storage_url_for_object() {
  bucket="${SUPABASE_STORAGE_BUCKET}"
  object_path="$1"
  printf '%s/storage/v1/object/%s/%s' "${SUPABASE_URL%/}" "$bucket" "$object_path"
}

supabase_daily_object_path() {
  prefix="${SUPABASE_DAILY_BACKUP_PREFIX:-cloudspace/daily}"
  prefix="${prefix%/}"
  printf '%s/%s.json' "$prefix" "$(date -u +%F)"
}

supabase_bucket_url() {
  printf '%s/storage/v1/bucket/%s' "${SUPABASE_URL%/}" "${SUPABASE_STORAGE_BUCKET}"
}

ensure_supabase_bucket() {
  if curl_with_limits \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    "$(supabase_bucket_url)" >/dev/null 2>&1; then
    return 0
  fi

  bucket="${SUPABASE_STORAGE_BUCKET}"
  if printf '{"id":"%s","name":"%s","public":false}' "$bucket" "$bucket" | curl_with_limits \
    -X POST \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "${SUPABASE_URL%/}/storage/v1/bucket" >/dev/null; then
    echo "Created private Supabase Storage bucket: ${bucket}"
    return 0
  fi

  echo "Failed to verify or create Supabase Storage bucket: ${bucket}" >&2
  return 1
}

wait_for_cloudspace_core() {
  timeout="${CLOUDSPACE_BACKUP_WAIT_SECONDS:-600}"
  i=0
  while [ "$i" -lt "$timeout" ]; do
    # 真凶是 curl 的 -f：core 的 /api/utils/env 直连返回非 2xx(需认证，故经网关带登录态是 200、裸 curl 是 401)，
    # -fsS 把非 2xx 判成"没就绪"、干等到 600s 超时；这个 wait 一卡又连累网关晚起、restore 被跳过。
    # 实证：core 秒起(日志 migrating→listening 一秒内完成)。去掉 -f，只要 core 有任何 HTTP 响应即视为就绪。
    if curl -s -o /dev/null --connect-timeout 2 --max-time 5 "${CLOUDSPACE_INTERNAL_API_BASE}/api/utils/env" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "${CLOUDSPACE_PRODUCT_NAME} core API did not become ready within ${timeout}s" >&2
  return 1
}

validate_cloudspace_storage_file() {
  storage_file="$1"
  min_bytes="${2:-${SUPABASE_BACKUP_MIN_BYTES:-200}}"
  node /opt/app/cloudspace-state.js validate-storage "$storage_file" "$min_bytes" >/dev/null
}

restore_from_supabase() {
  [ "${SUPABASE_RESTORE_ON_START:-true}" = "true" ] || return 0
  wait_for_cloudspace_core || return 0
  ensure_supabase_bucket || return 0

  tmp_state="/tmp/cloudspace-supabase-state.json"
  tmp_storage="/tmp/cloudspace-supabase-storage.json"
  if curl_to_file_with_limit "$tmp_state" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    "$(supabase_storage_url)"; then
    if ! node /opt/app/cloudspace-state.js restore "$tmp_state" "$CLOUDSPACE_DATA_BASE_PATH" "$tmp_storage"; then
      echo "Failed to unpack Supabase state; starting with current local data" >&2
      return 0
    fi

    if [ ! -s "$tmp_storage" ]; then
      echo "Supabase state has no ${CLOUDSPACE_PRODUCT_NAME} storage; skipping restore"
      return 0
    fi

    if [ "$(wc -c < "$tmp_storage" | tr -d ' ')" -lt "${SUPABASE_BACKUP_MIN_BYTES:-200}" ]; then
      echo "Supabase backup is too small; skipping ${CLOUDSPACE_PRODUCT_NAME} storage restore"
      return 0
    fi

    if [ "${SUPABASE_RESTORE_REQUIRE_VALID_STORAGE:-true}" = "true" ] \
      && ! validate_cloudspace_storage_file "$tmp_storage" "${SUPABASE_BACKUP_MIN_BYTES:-200}"; then
      echo "Supabase backup does not contain valid ${CLOUDSPACE_PRODUCT_NAME} storage; skipping restore" >&2
      return 0
    fi

    if { printf '{"content":"'; base64 "$tmp_storage" | tr -d '\n'; printf '"}'; } | curl_with_limits \
      -X POST \
      -H "Content-Type: application/json" \
      --data-binary @- \
      "${CLOUDSPACE_INTERNAL_API_BASE}/api/storage" >/dev/null; then
      echo "Restored ${CLOUDSPACE_PRODUCT_NAME} data from Supabase state"
    else
      echo "Failed to restore ${CLOUDSPACE_PRODUCT_NAME} data from Supabase state" >&2
    fi
  else
    echo "No readable Supabase state found; starting with current local data"
  fi
}

backup_to_supabase_once() {
  wait_for_cloudspace_core || return 0
  ensure_supabase_bucket || return 0

  tmp_storage="/tmp/cloudspace-supabase-storage.json"
  tmp_state="/tmp/cloudspace-supabase-state.json"
  if ! curl_to_file_with_limit "$tmp_storage" "${CLOUDSPACE_INTERNAL_API_BASE}/api/storage"; then
    echo "Failed to export ${CLOUDSPACE_PRODUCT_NAME} storage for Supabase backup, or export exceeded ${SUPABASE_BACKUP_MAX_BYTES} bytes" >&2
    return 0
  fi

  bytes="$(wc -c < "$tmp_storage" | tr -d ' ')"
  if [ "$bytes" -lt "${SUPABASE_BACKUP_MIN_BYTES:-200}" ] && [ "${SUPABASE_BACKUP_ALLOW_EMPTY:-false}" != "true" ]; then
    echo "${CLOUDSPACE_PRODUCT_NAME} export is ${bytes} bytes; skipping backup to avoid overwriting with empty data"
    return 0
  fi

  if [ "${SUPABASE_BACKUP_REQUIRE_VALID_STORAGE:-true}" = "true" ] \
    && ! validate_cloudspace_storage_file "$tmp_storage" "${SUPABASE_BACKUP_MIN_BYTES:-200}"; then
    echo "${CLOUDSPACE_PRODUCT_NAME} export is not valid storage; skipping backup to avoid overwriting good data" >&2
    return 0
  fi

  if ! node /opt/app/cloudspace-state.js backup "$tmp_storage" "$CLOUDSPACE_DATA_BASE_PATH" "$tmp_state"; then
    echo "Failed to pack Supabase state" >&2
    return 0
  fi

  new_hash="$(sha256sum "$tmp_state" | awk '{print $1}')"
  old_hash=""
  [ -f /tmp/cloudspace-supabase-backup.sha256 ] && old_hash="$(cat /tmp/cloudspace-supabase-backup.sha256)"
  if [ "$new_hash" = "$old_hash" ]; then
    uploaded_latest="false"
  elif curl_with_limits \
    -X POST \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "x-upsert: true" \
    -H "Content-Type: application/json" \
    --data-binary @"$tmp_state" \
    "$(supabase_storage_url)" >/dev/null; then
    printf '%s' "$new_hash" > /tmp/cloudspace-supabase-backup.sha256
    echo "Backed up ${CLOUDSPACE_PRODUCT_NAME} state to Supabase Storage (${bytes} storage bytes)"
    uploaded_latest="true"
  else
    echo "Failed to upload ${CLOUDSPACE_PRODUCT_NAME} state to Supabase Storage" >&2
    uploaded_latest="false"
  fi

  if [ "${SUPABASE_DAILY_BACKUP_ENABLED:-true}" = "true" ]; then
    today="$(date -u +%F)"
    last_daily=""
    [ -f /tmp/cloudspace-supabase-daily.date ] && last_daily="$(cat /tmp/cloudspace-supabase-daily.date)"
    # daily 只在当天第一次备份时写(冻结当天首帧)，之后当天不再覆盖——否则当天若有坏数据备份，
    # 会把当天的救命快照也顶掉。真正保命的冻结点是跨天的旧 daily。
    if [ "$today" != "$last_daily" ]; then
      daily_object="$(supabase_daily_object_path)"
      if curl_with_limits \
        -X POST \
        -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "x-upsert: true" \
        -H "Content-Type: application/json" \
        --data-binary @"$tmp_state" \
        "$(supabase_storage_url_for_object "$daily_object")" >/dev/null; then
        printf '%s' "$today" > /tmp/cloudspace-supabase-daily.date
        echo "Backed up ${CLOUDSPACE_PRODUCT_NAME} daily state snapshot to Supabase Storage: ${daily_object}"
      else
        echo "Failed to upload ${CLOUDSPACE_PRODUCT_NAME} daily state snapshot to Supabase Storage: ${daily_object}" >&2
      fi
    fi
  fi
}

supabase_backup_loop() {
  sleep "${SUPABASE_BACKUP_INITIAL_DELAY_SECONDS:-60}"
  while true; do
    backup_to_supabase_once
    sleep "${SUPABASE_BACKUP_INTERVAL_SECONDS:-300}"
  done
}

http_meta_supervisor() {
  while true; do
    META_TEMP_FOLDER="${HTTP_META_TEMP_FOLDER:-/tmp/http-meta}" \
    META_FOLDER="${HTTP_META_FOLDER:-/opt/app/http-meta/meta}" \
    BODY_JSON_LIMIT="${HTTP_META_BODY_JSON_LIMIT}" \
    HOST="${HTTP_META_HOST:-127.0.0.1}" \
    PORT="${HTTP_META_PORT:-9876}" \
    node --max-old-space-size="${HTTP_META_NODE_MAX_OLD_SPACE_SIZE}" /opt/app/http-meta/http-meta.bundle.js &

    child_pid="$!"
    trap 'kill "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; exit 0' INT TERM
    status=0
    wait "$child_pid" || status="$?"
    trap - INT TERM

    if [ "$HTTP_META_RESTART_ENABLED" != "true" ]; then
      echo "Cirrus engine exited with status ${status}; restart disabled"
      return "$status"
    fi

    echo "Cirrus engine exited with status ${status}; restarting in ${HTTP_META_RESTART_DELAY_SECONDS}s" >&2
    sleep "$HTTP_META_RESTART_DELAY_SECONDS"
  done
}

start_http_meta() {
  [ "${HTTP_META_ENABLED:-true}" = "true" ] || return 0
  mkdir -p "${HTTP_META_TEMP_FOLDER:-/tmp/http-meta}"

  http_meta_supervisor &
  HTTP_META_PID="$!"
  sleep "${HTTP_META_START_DELAY_SECONDS:-2}"

  if ! kill -0 "$HTTP_META_PID" 2>/dev/null; then
    echo "Cirrus engine failed to start" >&2
    exit 1
  fi

  echo "Cirrus engine listening on ${HTTP_META_HOST:-127.0.0.1}:${HTTP_META_PORT:-9876}"
}

scripthub_supervisor() {
  while true; do
    (
      cd "${SCRIPTHUB_DIR:-/opt/app/scripthub}" || exit 1
      HOST="${SCRIPTHUB_HOST:-127.0.0.1}" \
      PORT="${SCRIPTHUB_PORT:-9100}" \
      BETA_PORT="${SCRIPTHUB_BETA_PORT:-9101}" \
      BASE_URL="${SCRIPTHUB_BASE_URL:-}" \
      BETA_BASE_URL="${SCRIPTHUB_BETA_BASE_URL:-}" \
      exec node --max-old-space-size="${SCRIPTHUB_NODE_MAX_OLD_SPACE_SIZE:-1024}" service.js
    ) &

    child_pid="$!"
    trap 'kill "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; exit 0' INT TERM
    status=0
    wait "$child_pid" || status="$?"
    trap - INT TERM

    if [ "${SCRIPTHUB_RESTART_ENABLED:-true}" != "true" ]; then
      echo "Stratus exited with status ${status}; restart disabled"
      return "$status"
    fi

    echo "Stratus exited with status ${status}; restarting in ${SCRIPTHUB_RESTART_DELAY_SECONDS:-5}s" >&2
    sleep "${SCRIPTHUB_RESTART_DELAY_SECONDS:-5}"
  done
}

start_scripthub() {
  [ "${SCRIPTHUB_ENABLED:-true}" = "true" ] || return 0

  scripthub_dir="${SCRIPTHUB_DIR:-/opt/app/scripthub}"
  if [ ! -f "${scripthub_dir}/service.js" ]; then
    echo "Stratus service.js not found in ${scripthub_dir}; skipping Stratus" >&2
    return 0
  fi

  # 把 Stratus 的 ./tmp 工作目录指向 /tmp, 避免污染应用目录且便于清理。
  mkdir -p /tmp/scripthub-tmp
  ln -sfn /tmp/scripthub-tmp "${scripthub_dir}/tmp" 2>/dev/null || true

  scripthub_supervisor &
  SCRIPTHUB_PID="$!"
  sleep "${SCRIPTHUB_START_DELAY_SECONDS:-2}"

  if ! kill -0 "$SCRIPTHUB_PID" 2>/dev/null; then
    echo "Stratus failed to start; continuing without it" >&2
    SCRIPTHUB_PID=""
    return 0
  fi

  echo "Stratus listening on ${SCRIPTHUB_HOST:-127.0.0.1}:${SCRIPTHUB_PORT:-9100} (beta ${SCRIPTHUB_BETA_PORT:-9101})"
}

start_cloudspace_core() {
  node --max-old-space-size="${CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE}" /opt/app/cloudspace-core.bundle.js &
  CLOUDSPACE_CORE_PID="$!"
}

start_access_lock() {
  [ "$ACCESS_LOCK_ENABLED" = "true" ] || return 0
  node --max-old-space-size="${CLOUDSPACE_ACCESS_NODE_MAX_OLD_SPACE_SIZE}" /opt/app/cloudspace-access-proxy.js &
  ACCESS_LOCK_PID="$!"
  sleep 1
  if ! kill -0 "$ACCESS_LOCK_PID" 2>/dev/null; then
    echo "Access lock proxy failed to start" >&2
    exit 1
  fi
  echo "Access lock proxy listening on 0.0.0.0:${ACCESS_LOCK_PORT}"
}

stop_children() {
  for pid in "${ACCESS_LOCK_PID:-}" "${SUPABASE_BACKUP_PID:-}" "${CLOUDSPACE_CORE_PID:-}" "${SCRIPTHUB_PID:-}" "${HTTP_META_PID:-}" "${CACHE_CLEANUP_PID:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait "${ACCESS_LOCK_PID:-}" 2>/dev/null || true
  wait "${CLOUDSPACE_CORE_PID:-}" 2>/dev/null || true
  wait "${CACHE_CLEANUP_PID:-}" 2>/dev/null || true
}
trap stop_children INT TERM

HTTP_META_PID=""
CLOUDSPACE_CORE_PID=""
SUPABASE_BACKUP_PID=""
ACCESS_LOCK_PID=""
CACHE_CLEANUP_PID=""
SCRIPTHUB_PID=""

start_http_meta
start_cache_cleanup
start_scripthub

if [ "${SUPABASE_BACKUP_ENABLED:-false}" = "true" ] && [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "WARN: cloudspace Supabase 备份已启用 (SUPABASE_BACKUP_ENABLED=true) 但缺 SUPABASE_SERVICE_ROLE_KEY，备份将静默关闭、数据不会落盘" >&2
fi

if [ "$ACCESS_LOCK_ENABLED" = "true" ] || supabase_backup_enabled; then
  start_cloudspace_core

  if supabase_backup_enabled; then
    restore_from_supabase
    supabase_backup_loop &
    SUPABASE_BACKUP_PID="$!"
  fi

  if [ "$ACCESS_LOCK_ENABLED" = "true" ]; then
    start_access_lock
    wait "$ACCESS_LOCK_PID"
  else
    wait "$CLOUDSPACE_CORE_PID"
  fi
else
  exec node --max-old-space-size="${CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE}" /opt/app/cloudspace-core.bundle.js
fi
