import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const safeId = /^[a-zA-Z0-9_-]{1,120}$/u;
const digest = /^sha256:[a-f0-9]{64}$/u;

export class DockerRuntimeDriver {
  constructor({ instanceId, chromeImage, egressImage, supervisorContainer, seccompPath = fileURLToPath(new URL('../seccomp.json', import.meta.url)), execute } = {}) {
    if (!safeId.test(instanceId) || !safeId.test(supervisorContainer) || !digest.test(chromeImage) || !digest.test(egressImage)) throw new Error('Pinned runtime images and supervisor identity are required.');
    Object.assign(this, { instanceId, chromeImage, egressImage, supervisorContainer, seccompPath: resolve(seccompPath) });
    this.execute = execute || (async args => (await run('docker', args, { timeout: 20_000, maxBuffer: 1024 * 1024 })).stdout.trim());
  }
  names(runtimeId) {
    if (!safeId.test(runtimeId)) throw new Error('Invalid runtime identity.');
    return { browser: `oddpath-browser-${runtimeId}`, egress: `oddpath-egress-${runtimeId}`, network: `oddpath-private-${runtimeId}` };
  }
  labels(executionId, runtimeId, deadline) {
    if (!safeId.test(executionId)) throw new Error('Invalid execution identity.');
    return ['--label', 'oddpath.runtime=1', '--label', `oddpath.supervisor=${this.instanceId}`,
      '--label', `oddpath.execution=${executionId}`, '--label', `oddpath.allocation=${runtimeId}`, '--label', `oddpath.deadline=${deadline}`];
  }
  async start(input, assertAuthority = () => {}) {
    const step = async operation => {
      assertAuthority();
      const result = await operation();
      assertAuthority();
      return result;
    };
    const execute = args => step(async () => {
      try { return await this.execute(args); }
      catch (error) {
        const createsResources = args[0] === 'create' || args[0] === 'start'
          || (args[0] === 'network' && ['create','connect'].includes(args[1]));
        // A failed CLI process does not establish whether Docker finished an
        // accepted mutation. Numeric exit codes and stderr (including plain EOF)
        // are not a settlement acknowledgement. Keep the creator fence for every
        // failed mutation; current resource absence cannot prove it will stay so.
        if (createsResources) error.allocationSettlementUnknown = true;
        throw error;
      }
    });
    const names = this.names(input.runtimeId), labels = this.labels(input.executionId, input.runtimeId, input.deadline);
    if (!/^[a-f0-9]{64}$/u.test(input.token) || input.leaseUntil <= Date.now() || input.deadline > Date.now() + 900_000) throw new Error('Invalid runtime lease.');
    const serverVersion = await execute(['version', '--format', '{{.Server.Version}}']);
    if (Number(serverVersion.split('.')[0]) < 28 || !/^\d+\./u.test(serverVersion)) throw new Error('Docker Engine 28+ with isolated bridge gateways is required.');
    try {
      // An ordinary internal bridge still has a host address. Isolated gateway
      // mode removes that path to host services as well as external routing.
      await execute(['network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', '--opt', 'com.docker.network.bridge.enable_icc=true', ...labels, names.network]);
      // Only the egress proxy has an external network. The browser cannot route
      // directly to the Internet, the host, or another allocation's network.
      await execute(['create', '--name', names.egress, ...labels, '--network', 'bridge', '--read-only', '--user', '10001:10001',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.25', '--pids-limit', '64',
        '--log-driver', 'none', '--env', `ODDPATH_ALLOWED_ORIGINS=${JSON.stringify(input.origins)}`, '--env', `ODDPATH_DEADLINE_MS=${input.deadline}`, this.egressImage]);
      await execute(['network', 'connect', '--alias', 'egress', names.network, names.egress]);
      await execute(['network', 'connect', names.network, this.supervisorContainer]);
      await execute(['create', '--name', names.browser, ...labels, '--network', names.network,
        '--read-only', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--security-opt', `seccomp=${this.seccompPath}`, '--memory', '1200m', '--memory-swap', '1200m', '--cpus', '1', '--pids-limit', '256',
        '--shm-size', '256m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '--tmpfs', '/home/browser:rw,nosuid,size=128m,uid=10001,gid=10001',
        '--log-driver', 'none', '--env', `ODDPATH_RUNTIME_TOKEN=${input.token}`, '--env', `ODDPATH_DEADLINE_MS=${input.deadline}`,
        '--env', `ODDPATH_LEASE_MS=${input.leaseUntil}`,
        ...(input.manual ? ['--env', input.saved?'ODDPATH_SAVED_LOGIN=1':'ODDPATH_MANUAL_LOGIN=1', '--env', `ODDPATH_PREPARATION_DEADLINE_MS=${input.preparationDeadline}`,
          '--env', `ODDPATH_EXECUTION_TIMEOUT_MS=${input.manual.executionTimeoutMs}`, '--env', `ODDPATH_LOGIN_TARGET_URL=${input.manual.baseUrl}`,
          '--env', `ODDPATH_LOGIN_ORIGINS=${JSON.stringify(input.manual.authenticationOrigins)}`] : []), this.chromeImage]);
      await execute(['start', names.egress, names.browser]);
      const endpoint = await step(() => this.endpoint(input.runtimeId));
      // A running container does not imply Chrome, static noVNC modules or the
      // VNC server are ready. Probe from the trusted supervisor's private network.
      const ready = await execute(['exec', this.supervisorContainer, 'node', '--input-type=module', '-e',
        `const {waitForBrowserServices}=await import('./apps/browser-runtime/src/browser-readiness.mjs');await waitForBrowserServices(${JSON.stringify(endpoint)},${JSON.stringify(input.token)},Math.min(${input.leaseUntil},${input.deadline},Date.now()+15000));console.log('READY');`]);
      if (ready !== 'READY') throw new Error('Browser services did not become ready.');
      return await step(() => this.endpoint(input.runtimeId));
    } catch (error) {
      await this.stop(input.runtimeId).catch(() => {});
      throw error;
    }
  }
  async inspect(name) {
    let output;
    try { output = await this.execute(['inspect', name]); }
    catch (error) {
      // Unavailable Docker is not evidence of process termination.
      if (!/no such (?:object|container)/iu.test(error.stderr || '')) throw error;
      return null;
    }
    const info = JSON.parse(output)[0];
    if (info.Config.Labels?.['oddpath.supervisor'] !== this.instanceId || info.Config.Labels?.['oddpath.runtime'] !== '1') throw new Error('Runtime ownership mismatch.');
    return info;
  }
  async endpoint(runtimeId) {
    const names = this.names(runtimeId), info = await this.inspect(names.browser);
    if (!info?.State.Running) throw new Error('Runtime is not running.');
    const ip = info.NetworkSettings.Networks[names.network]?.IPAddress;
    if (!/^\d+\.\d+\.\d+\.\d+$/u.test(ip || '')) throw new Error('Private runtime endpoint unavailable.');
    return `http://${ip}:8080`;
  }
  async inspectNetwork(name) {
    let output;
    try { output = await this.execute(['network', 'inspect', name]); }
    catch (error) { if (/no such network|network [^\s]+ not found/iu.test(error.stderr || '')) return null; throw error; }
    const info = JSON.parse(output)[0];
    if (info.Labels?.['oddpath.supervisor'] !== this.instanceId || info.Labels?.['oddpath.runtime'] !== '1') throw new Error('Runtime network ownership mismatch.');
    return info;
  }
  async stop(runtimeId) {
    const names = this.names(runtimeId);
    for (const name of [names.browser, names.egress]) {
      const info = await this.inspect(name);
      if (info?.State.Running) {
        try { await this.execute(['kill', name]); await this.execute(['wait', name]); }
        catch (error) { if ((await this.inspect(name))?.State.Running) throw error; }
      }
      const stopped = await this.inspect(name);
      if (stopped?.State.Running) throw new Error('Runtime termination remains unconfirmed.');
      if (stopped) try { await this.execute(['rm', name]); }
      catch (error) { if (await this.inspect(name)) throw error; }
    }
    // A freshly successful inspect/no-such-object for BOTH containers is the
    // proof; cancellation, a timeout, and Docker connection errors are not.
    const proof = { processExited: true, observedAt: Date.now() };
    if (await this.inspectNetwork(names.network)) {
      await this.execute(['network', 'disconnect', names.network, this.supervisorContainer]).catch(() => {});
      try { await this.execute(['network', 'rm', names.network]); }
      catch (error) { if (await this.inspectNetwork(names.network)) throw error; }
    }
    return proof;
  }
  async list() {
    const names = (await this.execute(['ps', '-a', '--filter', 'label=oddpath.runtime=1', '--filter', `label=oddpath.supervisor=${this.instanceId}`, '--format', '{{.Names}}']))
      .split('\n').filter(Boolean);
    const allocations = new Set();
    for (const name of names) { const info = await this.inspect(name); if (info) allocations.add(info.Config.Labels['oddpath.allocation']); }
    const networks = (await this.execute(['network', 'ls', '--filter', 'label=oddpath.runtime=1', '--filter', `label=oddpath.supervisor=${this.instanceId}`, '--format', '{{.Name}}'])).split('\n').filter(Boolean);
    for (const name of networks) { const info = await this.inspectNetwork(name); if (info) allocations.add(info.Labels['oddpath.allocation']); }
    return [...allocations];
  }
}
