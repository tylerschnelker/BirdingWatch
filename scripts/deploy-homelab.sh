#!/usr/bin/env bash
# Deploy the latest main to the homelab: pull, rebuild, restart, verify.
# Run by hand when there's a code drop (replaces deploy.yml's old droplet job;
# the homelab has no inbound access from GitHub and no Actions runner).
#
# If docker-compose.yml or scripts/birdingwatch-firewall.* changed, review the
# diff before deploying: those files define the container's isolation from
# the rest of the homelab. A firewall script change also needs reinstalling:
#   sudo install -m 755 scripts/birdingwatch-firewall.sh /usr/local/sbin/
#   sudo systemctl restart birdingwatch-firewall
set -euo pipefail

cd "$(dirname "$0")/.."

before=$(git rev-parse HEAD)
git pull --ff-only --quiet origin main
after=$(git rev-parse HEAD)

if [[ "$before" == "$after" ]]; then
    echo "Already at $(git log --oneline -1); rebuilding anyway."
else
    echo "Updated $(git rev-parse --short "$before") -> $(git log --oneline -1)"
    git diff --stat "$before" "$after"
    if git diff --name-only "$before" "$after" | grep -qE '^(docker-compose\.yml|scripts/birdingwatch-firewall\.)'; then
        echo "WARNING: isolation files changed (docker-compose.yml / firewall). Review before trusting this deploy."
    fi
fi

docker compose up -d --build

echo -n "Waiting for the app to report healthy"
for _ in $(seq 1 30); do
    status=$(docker inspect birdingwatch --format '{{.State.Health.Status}}')
    [[ "$status" == "healthy" ]] && break
    echo -n "."; sleep 5
done
echo " $status"
[[ "$status" == "healthy" ]] || { docker logs --tail 30 birdingwatch; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://marysbackyardbirds.xyz/api/today)
echo "Public site: HTTP $code"
[[ "$code" == "200" ]] || exit 1
