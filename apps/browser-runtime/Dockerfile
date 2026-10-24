FROM node:24-bookworm-slim AS policy
WORKDIR /opt/policy
COPY package.json package-lock.json ./
COPY apps/runner/package.json apps/runner/package.json
COPY apps/browser-runtime/package.json apps/browser-runtime/package.json
COPY packages/qa-execution-contract/package.json packages/qa-execution-contract/package.json
RUN npm ci --ignore-scripts --workspace=@oddpath/browser-runtime --workspace=@oddpath/runner --workspace=@oddpath/qa-execution-contract --include-workspace-root
COPY packages/qa-execution-contract packages/qa-execution-contract
RUN npm --prefix packages/qa-execution-contract run build
FROM node:24-bookworm-slim
ARG TARGETARCH
RUN case "$TARGETARCH" in amd64|arm64) ;; *) printf 'Unsupported browser runtime architecture: %s (expected amd64 or arm64)\n' "$TARGETARCH" >&2; exit 1 ;; esac \
    && test "$(dpkg --print-architecture)" = "$TARGETARCH" \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini xvfb x11vnc novnc websockify fonts-liberation \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && printf 'deb [arch=%s signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main\n' "$TARGETARCH" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin browser
WORKDIR /opt/oddpath
COPY apps/browser-runtime/src/runtime-main.mjs ./runtime-main.mjs
COPY apps/browser-runtime/src/login-boundary.mjs apps/browser-runtime/src/login-policy.mjs ./
COPY apps/browser-runtime/src/preparation-failure.mjs ./
COPY --from=policy /opt/policy/node_modules/playwright ./node_modules/playwright
COPY --from=policy /opt/policy/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=policy /opt/policy/node_modules/zod ./node_modules/zod
COPY --from=policy /opt/policy/packages/qa-execution-contract/package.json ./node_modules/@oddpath/qa-execution-contract/package.json
COPY --from=policy /opt/policy/packages/qa-execution-contract/dist ./node_modules/@oddpath/qa-execution-contract/dist
USER 10001:10001
ENV HOME=/home/browser DISPLAY=:99
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/oddpath/runtime-main.mjs"]
