#!/data/data/com.termux/files/usr/bin/bash
set -eu
termux_home=/data/data/com.termux/files/home
termux_prefix=/data/data/com.termux/files/usr
desired="$termux_home/services/bom-dia/desired.json"
logfile="$termux_home/services/logs/boot.log"

if ! "$termux_prefix/bin/node" -e 'const fs=require("fs");try{const state=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(state.desired==="online"?0:1)}catch{process.exit(1)}' "$desired"; then
  exit 0
fi

for attempt in 1 2 3 4; do
  if HOME="$termux_home" PM2_HOME="$termux_home/.pm2" PREFIX="$termux_prefix" PATH="$termux_prefix/bin:/system/bin" TMPDIR="$termux_prefix/tmp" \
    "$termux_prefix/bin/node" "$termux_prefix/lib/node_modules/pm2/bin/pm2" restart bom-dia --update-env >/dev/null 2>&1; then
    printf '%s restored bom-dia Baileys bridge\n' "$("$termux_prefix/bin/date" -Iseconds)" >> "$logfile"
    exit 0
  fi
  sleep 5
done
printf '%s failed to restore bom-dia Baileys bridge\n' "$("$termux_prefix/bin/date" -Iseconds)" >> "$logfile"
exit 1
