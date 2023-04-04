#!/usr/bin/bash
dir="$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")"
alias glenna="docker compose -p scholar-glenna -f \"$dir/docker-compose.yml\""