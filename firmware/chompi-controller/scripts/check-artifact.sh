#!/usr/bin/env bash
# Check a built controller image before it goes on a card.
#
#   scripts/check-artifact.sh build/arm/agent-controller.elf build/arm/04_AGENT.bin
#
# ARM_NM and ARM_SIZE name the toolchain tools (default: arm-none-eabi-*).
set -euo pipefail

elf="${1:?usage: check-artifact.sh <elf> <bin>}"
bin="${2:?usage: check-artifact.sh <elf> <bin>}"
nm_tool="${ARM_NM:-arm-none-eabi-nm}"
size_tool="${ARM_SIZE:-arm-none-eabi-size}"

# The launcher stages up to 512 KiB, but the image must fit the app linker
# script's SRAM_EXEC region (232 KiB at 0x24000000).
readonly SRAM_EXEC_BASE=$((0x24000000))
readonly SRAM_EXEC_SIZE=$((232 * 1024))
readonly LAUNCHER_MAX=$((512 * 1024))
readonly ESTACK=$((0x20020000))
readonly BOOT_INFO_ADDR="38800000"
# Device descriptor head: bLength 18, DEVICE, USB 2.00, class 0/0/0, EP0 64,
# then VID 0x1209 and PID 0x000C little-endian.
readonly DEVICE_DESCRIPTOR_HEX="12010002000000400912""0c00"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

[ -f "$elf" ] || { echo "missing $elf" >&2; exit 2; }
[ -f "$bin" ] || { echo "missing $bin" >&2; exit 2; }

bytes=$(wc -c < "$bin")
if [ "$bytes" -gt 0 ] && [ "$bytes" -le "$SRAM_EXEC_SIZE" ] && [ "$bytes" -le "$LAUNCHER_MAX" ]; then
  pass "image size $bytes bytes (SRAM_EXEC $SRAM_EXEC_SIZE, launcher limit $LAUNCHER_MAX)"
else
  fail "image size $bytes bytes exceeds SRAM_EXEC $SRAM_EXEC_SIZE or launcher limit $LAUNCHER_MAX"
fi

# Vector table: initial MSP and reset handler, as the launcher validates them.
read -r msp entry < <(od -An -t u4 -N 8 -v "$bin")
if [ "$msp" -eq "$ESTACK" ]; then
  pass "initial stack pointer 0x$(printf '%08x' "$msp")"
else
  fail "initial stack pointer 0x$(printf '%08x' "$msp"), expected 0x$(printf '%08x' "$ESTACK")"
fi
if [ "$entry" -ge "$SRAM_EXEC_BASE" ] && [ "$entry" -lt $((SRAM_EXEC_BASE + bytes)) ]; then
  pass "reset handler 0x$(printf '%08x' "$entry") inside the image"
else
  fail "reset handler 0x$(printf '%08x' "$entry") outside the image"
fi

isr=$("$nm_tool" "$elf" | awk '$3 == "g_pfnVectors" { print $1 }')
if [ "$isr" = "24000000" ]; then
  pass "vector table at 0x24000000"
else
  fail "vector table at 0x${isr:-missing}, expected 0x24000000"
fi

# BACKUP_SRAM fix: libDaisy's boot_info must sit where the bootloader writes it.
boot_info=$("$nm_tool" -C "$elf" | awk '!found && ($3 == "daisy::boot_info" || $3 == "boot_info") { print $1; found = 1 }')
if [ "$boot_info" = "$BOOT_INFO_ADDR" ]; then
  pass "boot_info at 0x$boot_info"
else
  fail "boot_info at 0x${boot_info:-missing}, expected 0x$BOOT_INFO_ADDR"
fi

# Every loadable section lives in a region the launcher copies or the app
# initialises: SRAM_EXEC/SRAM (AXI SRAM), RAM_D2, BACKUP_SRAM, or the stack's
# DTCM. Nothing may land in internal flash or QSPI.
bad_sections=""
while read -r name size addr; do
  a=$((addr))
  if ! { [ "$a" -ge $((0x24000000)) ] && [ "$a" -lt $((0x24080000)) ]; } \
     && ! { [ "$a" -ge $((0x30000000)) ] && [ "$a" -lt $((0x30048000)) ]; } \
     && ! { [ "$a" -ge $((0x38800000)) ] && [ "$a" -lt $((0x38801000)) ]; } \
     && ! { [ "$a" -ge $((0x20000000)) ] && [ "$a" -lt $((0x20020000)) ]; }; then
    bad_sections="$bad_sections $name@$addr"
  fi
done < <("$size_tool" -A -x "$elf" | awk 'NR > 2 && NF == 3 && $2 != "0x0" && $1 !~ /^\.(debug|comment|stab|ARM\.attributes)/')
if [ -z "$bad_sections" ]; then
  pass "all allocated sections in AXI SRAM, RAM_D2, DTCM or backup SRAM"
else
  fail "sections outside the allowed regions: $bad_sections"
fi

# USB identity bytes are in the image.
if od -An -v -tx1 "$bin" | tr -d ' \n' | grep -q "$DEVICE_DESCRIPTOR_HEX"; then
  pass "device descriptor with VID:PID 1209:000C present"
else
  fail "device descriptor with VID:PID 1209:000C not found"
fi
for text in "agent-device-hub" "Agent Controller"; do
  if grep -qaF "$text" "$bin"; then
    pass "string \"$text\" present"
  else
    fail "string \"$text\" missing"
  fi
done

# No SD card access, no MIDI, no stock CDC identity.
symbols=$("$nm_tool" -C "$elf")
for forbidden in f_mount f_open BSP_SD_Init HAL_SD_Init USBD_CDC_Init CDC_Init_FS \
                 CDC_Init_HS "daisy::MidiUsbTransport" "daisy::MidiHandler" \
                 "daisy::UsbHandle::Init"; do
  if grep -qF "$forbidden" <<< "$symbols"; then
    fail "forbidden symbol linked: $forbidden"
  else
    pass "no $forbidden"
  fi
done
if od -An -v -tx1 "$bin" | tr -d ' \n' | grep -q "8304""4057"; then
  fail "stock VID:PID 0483:5740 bytes present"
else
  pass "no stock VID:PID 0483:5740 bytes"
fi

echo
echo "Memory:"
"$size_tool" -B "$elf"
"$size_tool" -A -x "$elf" | awk 'NR <= 2 || ($2 != "0x0" && $1 !~ /^\.(debug|comment|stab)/)'

if [ "$failures" -ne 0 ]; then
  echo "check-artifact: $failures check(s) failed" >&2
  exit 1
fi
echo "check-artifact: all checks passed"
