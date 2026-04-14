#!/bin/bash
# Shopee Video Upload - v4 Smart Engine Test
# Uses wait_for_activity + caption tap at y=800

DEVICE="R9RX501S5KY"
ADB="adb -s $DEVICE"
DIR="$(cd "$(dirname "$0")" && pwd)"

get_activity() {
  $ADB shell dumpsys activity activities 2>/dev/null | grep topResumedActivity | head -1
}

wait_for() {
  local expected=$1 timeout=$2 elapsed=0
  echo "   ⏳ Waiting for $expected..."
  while [ $elapsed -lt $timeout ]; do
    local current=$(get_activity)
    if echo "$current" | grep -q "$expected"; then
      echo "   ✓ Screen: $expected detected!"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo "   ... ($elapsed/${timeout}s)"
  done
  echo "   ✗ Timeout waiting for $expected"
  return 1
}

step=0
ss() {
  step=$((step + 1))
  $ADB exec-out screencap -p > "$DIR/_v4_step_${step}.png" 2>/dev/null
}

echo "🚀 SHOPEE UPLOAD v4 — Smart Engine"
echo ""

# ═══ PREP ═══
echo "━━ STEP 1: Kill Shopee"
$ADB shell am force-stop com.shopee.id
sleep 1

echo "━━ STEP 2: Launch Shopee"
$ADB shell am start -n com.shopee.id/com.shopee.app.ui.home.HomeActivity_
wait_for "HomeActivity" 15
ss

echo "━━ STEP 3: Tap Beranda (reset)"
sleep 2
$ADB shell input tap 108 2178
sleep 2

echo "━━ STEP 4: Tap Saya (Profile)"
$ADB shell input tap 972 2178
sleep 3
ss

echo "━━ STEP 5: Scroll down"
$ADB shell input swipe 540 1800 540 1000 500
sleep 1
ss

echo "━━ STEP 6: Tap Live dan Video"
$ADB shell input tap 287 1240
sleep 3
ss

echo "━━ STEP 7: Tap Video tab"
$ADB shell input tap 540 299
sleep 2
ss

echo "━━ STEP 8: Tap Post Video"
$ADB shell input tap 586 2090
sleep 3
ss

echo "━━ STEP 9: Tap Galeri"
$ADB shell input tap 862 1832
sleep 3
ss

echo "━━ STEP 10: Tap Video filter"
$ADB shell input tap 540 296
sleep 1

echo "━━ STEP 11: Select video #1"
$ADB shell input tap 134 495
sleep 1
ss

echo "━━ STEP 12: Tap Lanjutkan (preview)"
$ADB shell input tap 888 2143
sleep 3
ss

echo "━━ STEP 13: Tap Lanjutkan (editor) → WAIT for PublishVideoActivity"
$ADB shell input tap 905 2130

# Smart wait: keep checking until PublishVideoActivity appears
if ! wait_for "PublishVideoActivity" 25; then
  echo "   → Retry: tap Lanjutkan again..."
  $ADB shell input tap 905 2130
  wait_for "PublishVideoActivity" 15
fi
ss

echo "━━ STEP 14: Tap caption field (y=800, empty space trick)"
echo "   → Testing tap at y=800 (area kosong di bawah form fields)..."
$ADB shell input tap 540 800
sleep 2
ss
echo "   → Cek HP: ada cursor + OK di kanan atas?"

echo "━━ STEP 15: Type caption + hashtags"
$ADB shell input text "Test%sUpload%sShopee"
sleep 0.3
$ADB shell input text "%s"
$ADB shell "input text '#shopee'"
$ADB shell input text "%s"
$ADB shell "input text '#viral'"
sleep 1
ss

echo "━━ STEP 16: Tap OK"
$ADB shell input tap 1020 73
sleep 2
ss

echo "━━ STEP 17: Tap Posting"
echo "   ⚠️  PUBLISH dalam 5 detik... Ctrl+C untuk cancel"
sleep 5
$ADB shell input tap 540 2130
sleep 10
ss

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ FLOW v4 SELESAI!"
echo "  Screenshots: $DIR/_v4_step_*.png"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
