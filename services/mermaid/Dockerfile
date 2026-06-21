FROM denoland/deno:2.2.7

# Install Lightpanda browser binary (multi-arch: supports amd64 and arm64)
ARG LIGHTPANDA_VERSION=0.3.1

RUN set -e; \
    arch=$(uname -m); \
    case "$arch" in \
        x86_64|amd64) deb_arch="amd64"; expected_sha="4bb07d34ac74af794f803db70c192d4678b2a45ac2106b5ad5177823fb9aa4e5" ;; \
        aarch64|arm64) deb_arch="arm64"; expected_sha="30b39e7b0bbb7408e3db55be796dee698afe16cbb0694717a4da31751f9fc337" ;; \
        *) echo "Unsupported architecture: $arch"; exit 1 ;; \
    esac; \
    apt-get update && apt-get install -y curl; \
    curl -fsSL -o lightpanda.deb "https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/lightpanda_${LIGHTPANDA_VERSION}_${deb_arch}.deb"; \
    echo "${expected_sha}  lightpanda.deb" | sha256sum -c; \
    dpkg -i lightpanda.deb; \
    rm -f lightpanda.deb; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src/ ./src/

EXPOSE 3000
CMD ["deno", "run", "-A", "src/main.ts"]
