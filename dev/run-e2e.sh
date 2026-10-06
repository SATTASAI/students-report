#!/bin/sh
# เปิดเซิร์ฟเวอร์ใหม่ (ข้อมูลสะอาด) แล้วรันทดสอบหน้าเว็บ
cd "$(dirname "$0")/.."
PORT=8787
node --no-warnings dev/server.mjs $PORT > "${TMPDIR:-/tmp}/sr-dev.log" 2>&1 &
PID=$!
sleep 2
node dev/e2e.mjs "${1:-/tmp}"
CODE=$?
kill $PID
exit $CODE
