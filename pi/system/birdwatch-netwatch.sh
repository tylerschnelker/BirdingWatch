#!/bin/bash
# Network watchdog for the BirdWatch Pi. Run once a minute by
# birdwatch-netwatch.timer. The Pi's Wi-Fi has been seen dropping (or getting
# stuck roaming between mesh nodes with DNS dead) and never recovering on its
# own, leaving the Pi offline for days. This escalates until it's back:
#   3 failed minutes  -> bounce the Wi-Fi radio
#   10 failed minutes -> restart NetworkManager
#   20 failed minutes -> reboot (only if up >30 min, so it can't reboot-loop)
# The recorder keeps recording to its local outbox the whole time, so no
# clips are lost while this works.

STATE=/run/birdwatch-netwatch.fails

online() {
    local gw
    gw=$(ip route | awk '/^default/ {print $3; exit}')
    [ -n "$gw" ] || return 1
    ping -c 2 -W 3 "$gw" >/dev/null 2>&1 || return 1
    # Gateway reachable but internet/DNS dead is the other failure seen in practice.
    ping -c 2 -W 3 1.1.1.1 >/dev/null 2>&1 || ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1 || return 1
    getent hosts marysbackyardbirds.xyz >/dev/null 2>&1 || return 1
}

fails=$(cat "$STATE" 2>/dev/null || echo 0)

if online; then
    [ "$fails" -gt 0 ] && echo "network OK again after $fails failed check(s)"
    echo 0 > "$STATE"
    exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE"
echo "network check failed ($fails in a row)"

case "$fails" in
    3)
        echo "bouncing Wi-Fi radio"
        nmcli radio wifi off; sleep 5; nmcli radio wifi on
        ;;
    10)
        echo "restarting NetworkManager"
        systemctl restart NetworkManager
        ;;
    20)
        uptime_s=$(cut -d. -f1 /proc/uptime)
        if [ "$uptime_s" -gt 1800 ]; then
            echo "still offline after 20 min, rebooting"
            systemctl reboot
        else
            echo "offline but booted <30 min ago, not rebooting yet"
            echo 10 > "$STATE"  # try the NetworkManager restart step again later
        fi
        ;;
esac
