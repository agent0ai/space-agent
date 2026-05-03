# Space Agent — local task runner (https://github.com/casey/just)
# Docker: `just docker-build`, `just docker-run`, `just docker-shell`

# Image ref for `docker build` / `docker run` recipes below.
IMAGE := env_var_or_default("SPACE_DOCKER_IMAGE", "space-agent")
TAG := env_var_or_default("SPACE_DOCKER_TAG", "local")
FULL_IMAGE := IMAGE + ":" + TAG

# Named volume for writable L1/L2 (matches docker-entrypoint default CUSTOMWARE_PATH).
VOLUME := env_var_or_default("SPACE_DOCKER_VOLUME", "space-agent-customware")

# Host port published to container PORT (default 3000 in Dockerfile).
PORT := env_var_or_default("SPACE_DOCKER_PORT", "3000")

default:
    @just --list

# Build the image from the repo root (honors `.dockerignore`).
docker-build:
    docker build -t {{FULL_IMAGE}} .

# Run the default supervised stack: publish HOST:PORT → container :3000 and persist customware.
docker-run:
    docker run --rm -p {{PORT}}:3000 -v {{VOLUME}}:/srv/space/customware {{FULL_IMAGE}}

# Interactive shell in the image (skips entrypoint bootstrap; no server started).
docker-shell:
    docker run --rm -it -e SPACE_DOCKER_SKIP_INIT=1 -v {{VOLUME}}:/srv/space/customware {{FULL_IMAGE}} bash
