#!/usr/bin/env bun
/**
 * Provisions one KubeVirt VM per Kestrel box owner.
 *
 * The VM boots an Ubuntu cloud image, cloud-init installs `kestrel-box` and its desktop dependencies, mounts a
 * dedicated data disk at `/var/lib/kestrel`, and runs the box as the `kestrel` user's systemd service. The box is then
 * reachable through a Service and an Ingress, exactly like a BYO box.
 *
 * `create` renders a Kubernetes `List` as JSON on stdout; `--apply` sends it to kubectl, `--wait` waits for the VMI.
 */
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const DEFAULT_NAMESPACE = "kestrel-nest"
const DEFAULT_CONTROL_URL = "https://app.kestrel-agent.com"
const DEFAULT_IMAGE = "docker://quay.io/containerdisks/ubuntu:26.04"
const DEFAULT_BOX_BINARY =
  "https://github.com/jarenm1/kestrel/releases/latest/download/kestrel-box-linux-x64"
const DEFAULT_PORT = 8787

/** Ubuntu 26.04 ships weston 15, above the 14 the desktop manager needs, plus the X11 build headers. */
const PACKAGES = [
  "bubblewrap",
  "build-essential",
  "ca-certificates",
  "curl",
  "ffmpeg",
  "git",
  "hsetroot",
  "libx11-dev",
  "libxdamage-dev",
  "libxext-dev",
  "libxfixes-dev",
  "nodejs",
  "npm",
  "openbox",
  "weston",
  "xterm",
  "xdotool",
  "xwayland",
]

export interface VmOptions {
  readonly name: string
  readonly owner: string
  readonly namespace: string
  readonly host: string
  readonly boxId: string
  readonly boxSecret: string
  readonly controlUrl: string
  /** A Kestrel managed-fleet box (`CLOUDAGENTS_BOX_MANAGED=1`) rather than the owner's own box. */
  readonly managed: boolean
  readonly image: string
  readonly osSize: string
  readonly diskSize: string
  readonly storageClass: string | null
  readonly cpus: number
  readonly memory: string
  readonly port: number
  readonly gpuDevice: string | null
  readonly clusterIssuer: string | null
  readonly sshKey: string | null
  readonly boxBinaryUrl: string
}

export interface DeleteOptions {
  readonly name: string
  readonly namespace: string
  readonly purge: boolean
  readonly kubectl: string
}

export interface CreateOptions extends VmOptions {
  readonly apply: boolean
  readonly wait: boolean
  readonly kubectl: string
}

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const HOST = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/
const SIZE = /^\d+(Mi|Gi|Ti)$/
const MEMORY = /^\d+(Mi|Gi)$/
const LABEL_VALUE = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/

const required = (value: string | undefined, flag: string): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${flag} is required`)
  return value.trim()
}

const dnsLabel = (value: string, flag: string): string => {
  if (!NAME.test(value) || value.length > 50) {
    throw new Error(`${flag} must be a DNS label of at most 50 characters, got "${value}"`)
  }
  return value
}

const labelValue = (value: string, flag: string): string => {
  if (!LABEL_VALUE.test(value) || value.length > 63) {
    throw new Error(`${flag} must be a Kubernetes label value of at most 63 characters, got "${value}"`)
  }
  return value
}

const integer = (value: string | undefined, flag: string, min: number, max: number): number => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be an integer from ${min} to ${max}`)
  return n
}

export const parseCreateOptions = (argv: readonly string[]): CreateOptions => {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      name: { type: "string" },
      owner: { type: "string" },
      namespace: { type: "string" },
      host: { type: "string" },
      "box-id": { type: "string" },
      "box-secret": { type: "string" },
      "control-url": { type: "string" },
      managed: { type: "boolean" },
      image: { type: "string" },
      "os-size": { type: "string" },
      "disk-size": { type: "string" },
      "storage-class": { type: "string" },
      cpus: { type: "string" },
      memory: { type: "string" },
      port: { type: "string" },
      "gpu-device": { type: "string" },
      "cluster-issuer": { type: "string" },
      "ssh-key-file": { type: "string" },
      "box-binary-url": { type: "string" },
      kubectl: { type: "string" },
      apply: { type: "boolean" },
      wait: { type: "boolean" },
    },
  })
  const name = dnsLabel(required(values.name, "--name"), "--name")
  const host = required(values.host, "--host")
  if (!HOST.test(host) || host.length > 253) throw new Error(`--host must be a DNS hostname, got "${host}"`)
  const osSize = values["os-size"] ?? "20Gi"
  const diskSize = values["disk-size"] ?? "50Gi"
  if (!SIZE.test(osSize)) throw new Error(`--os-size must be a size such as 20Gi, got "${osSize}"`)
  if (!SIZE.test(diskSize)) throw new Error(`--disk-size must be a size such as 50Gi, got "${diskSize}"`)
  const memory = values.memory ?? "8Gi"
  if (!MEMORY.test(memory)) throw new Error(`--memory must be a size such as 8Gi, got "${memory}"`)
  const gpu = values["gpu-device"]?.trim() || null
  if (gpu !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(gpu)) {
    throw new Error(`--gpu-device must be a device plugin resource name such as nvidia.com/TU104GL_Tesla_T4`)
  }
  const sshKey = values["ssh-key-file"] === undefined ? null : readFileSync(values["ssh-key-file"], "utf8").trim()
  if (sshKey !== null && !sshKey.startsWith("ssh-")) throw new Error("--ssh-key-file must contain an SSH public key")
  return {
    name,
    owner: labelValue(values.owner ?? name, "--owner"),
    namespace: dnsLabel(values.namespace ?? DEFAULT_NAMESPACE, "--namespace"),
    host,
    boxId: required(values["box-id"], "--box-id"),
    boxSecret: required(values["box-secret"], "--box-secret"),
    controlUrl: (values["control-url"] ?? DEFAULT_CONTROL_URL).replace(/\/+$/, ""),
    managed: values.managed === true,
    image: values.image ?? DEFAULT_IMAGE,
    osSize,
    diskSize,
    storageClass: values["storage-class"]?.trim() || null,
    cpus: integer(values.cpus ?? "4", "--cpus", 1, 64),
    memory,
    port: integer(values.port ?? String(DEFAULT_PORT), "--port", 1, 65535),
    gpuDevice: gpu,
    clusterIssuer: values["cluster-issuer"]?.trim() || null,
    sshKey,
    boxBinaryUrl: values["box-binary-url"] ?? DEFAULT_BOX_BINARY,
    kubectl: values.kubectl ?? "kubectl",
    apply: values.apply === true,
    wait: values.wait === true,
  }
}

export const parseDeleteOptions = (argv: readonly string[]): DeleteOptions => {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      name: { type: "string" },
      namespace: { type: "string" },
      purge: { type: "boolean" },
      kubectl: { type: "string" },
    },
  })
  return {
    name: dnsLabel(required(values.name, "--name"), "--name"),
    namespace: dnsLabel(values.namespace ?? DEFAULT_NAMESPACE, "--namespace"),
    purge: values.purge === true,
    kubectl: values.kubectl ?? "kubectl",
  }
}

const indent = (text: string, spaces: number): string =>
  text
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n")

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const boxConfig = (options: VmOptions): string =>
  JSON.stringify(
    {
      controlUrl: options.controlUrl,
      boxId: options.boxId,
      boxSecret: options.boxSecret,
      port: options.port,
      dataDir: "/var/lib/kestrel",
      sandbox: "basic",
      provisioning: {
        mode: "guaranteed",
        taskMemoryMin: "1G",
        taskCpuWeight: 100,
        taskMemoryMax: "4G",
        taskCpuQuota: "200%",
        taskTasksMax: 1024,
        taskDiskMax: "50G",
        boxMemoryMax: "80%",
        boxCpuQuota: null,
        maxConcurrentRuns: null,
      },
    },
    null,
    2,
  )

const overrideConfig = (options: VmOptions): string =>
  [
    "[Service]",
    "Environment=CLOUDAGENTS_HOST=0.0.0.0",
    ...(options.managed ? ["Environment=CLOUDAGENTS_BOX_MANAGED=1"] : []),
    "",
  ].join("\n")

const bootstrapScript = (options: VmOptions): string =>
  [
    "#!/bin/bash",
    "set -euxo pipefail",
    "",
    "DISK=/dev/disk/by-id/virtio-kestrel-data",
    'for _ in $(seq 1 120); do [ -e "$DISK" ] && break; sleep 1; done',
    'if [ ! -e "$DISK" ]; then echo "kestrel data disk is missing" >&2; exit 1; fi',
    'if ! blkid "$DISK" >/dev/null 2>&1; then mkfs.ext4 -F -L kestrel-data "$DISK"; fi',
    "mkdir -p /var/lib/kestrel",
    "grep -q 'LABEL=kestrel-data' /etc/fstab || echo 'LABEL=kestrel-data /var/lib/kestrel ext4 defaults,nofail 0 2' >> /etc/fstab",
    "mount -a",
    "chown kestrel:kestrel /var/lib/kestrel",
    "",
    "# bwrap needs unprivileged user namespaces; Ubuntu's AppArmor restriction blocks them by default.",
    "printf 'kernel.apparmor_restrict_unprivileged_userns=0\\n' > /etc/sysctl.d/99-kestrel-userns.conf",
    "sysctl --system || true",
    "",
    "install -d -o kestrel -g kestrel /home/kestrel/.config/kestrel-box",
    "install -m 600 -o kestrel -g kestrel /etc/kestrel/box.json /home/kestrel/.config/kestrel-box/config.json",
    "install -d -o kestrel -g kestrel /home/kestrel/.config/systemd/user/kestrel-box.service.d",
    "install -m 644 -o kestrel -g kestrel /etc/kestrel/override.conf /home/kestrel/.config/systemd/user/kestrel-box.service.d/override.conf",
    "",
    `curl -fsSL ${shellQuote(options.boxBinaryUrl)} -o /usr/local/bin/kestrel-box`,
    "chmod 0755 /usr/local/bin/kestrel-box",
    "",
    "npm install -g @anthropic-ai/claude-code @openai/codex",
    "",
    "loginctl enable-linger kestrel",
    'for _ in $(seq 1 60); do [ -S "/run/user/$(id -u kestrel)/bus" ] && break; sleep 1; done',
    'runuser -u kestrel -- env HOME=/home/kestrel XDG_RUNTIME_DIR="/run/user/$(id -u kestrel)" /usr/local/bin/kestrel-box install',
    "",
  ].join("\n")

export const cloudInit = (options: VmOptions): string =>
  [
    "#cloud-config",
    `hostname: ${options.name}`,
    "manage_etc_hosts: true",
    "package_update: true",
    "packages:",
    ...PACKAGES.map((name) => `  - ${name}`),
    "users:",
    "  - name: kestrel",
    "    shell: /bin/bash",
    "    groups: [sudo]",
    "    sudo: ALL=(ALL) NOPASSWD:ALL",
    ...(options.sshKey === null
      ? []
      : ["    ssh_authorized_keys:", `      - ${JSON.stringify(options.sshKey)}`]),
    "write_files:",
    "  - path: /etc/kestrel/box.json",
    "    owner: root:root",
    "    permissions: '0600'",
    "    content: |",
    indent(boxConfig(options), 6),
    "  - path: /etc/kestrel/override.conf",
    "    owner: root:root",
    "    permissions: '0644'",
    "    content: |",
    indent(overrideConfig(options), 6),
    "  - path: /usr/local/sbin/kestrel-vm-bootstrap.sh",
    "    owner: root:root",
    "    permissions: '0755'",
    "    content: |",
    indent(bootstrapScript(options), 6),
    "runcmd:",
    "  - /usr/local/sbin/kestrel-vm-bootstrap.sh",
    "final_message: \"Kestrel box VM is ready\"",
    "",
  ].join("\n")

const labels = (options: VmOptions) => ({
  "app.kubernetes.io/name": "kestrel-box",
  "app.kubernetes.io/managed-by": "kestrel-nest",
  "kestrel.io/box": options.name,
  "kestrel.io/owner": options.owner,
})

const dataVolume = (options: VmOptions, name: string, source: Record<string, unknown>, size: string) => ({
  metadata: { name, namespace: options.namespace, labels: labels(options) },
  spec: {
    source,
    storage: {
      ...(options.storageClass === null ? {} : { storageClassName: options.storageClass }),
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: size } },
    },
  },
})

export interface Manifest {
  readonly apiVersion: "v1"
  readonly kind: "List"
  readonly items: ReadonlyArray<Record<string, unknown>>
}

export const render = (options: VmOptions): Manifest => {
  const ns = options.namespace
  const name = options.name
  const tag = labels(options)
  const namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: ns, labels: { "app.kubernetes.io/part-of": "kestrel-nest" } },
  }
  const networkPolicy = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "kestrel-box", namespace: ns },
    spec: {
      podSelector: { matchLabels: { "app.kubernetes.io/name": "kestrel-box" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ingress-nginx" } } }],
          ports: [{ protocol: "TCP", port: options.port }],
        },
      ],
      egress: [{}],
    },
  }
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: `cloudinit-${name}`, namespace: ns, labels: tag },
    type: "Opaque",
    stringData: { userdata: cloudInit(options) },
  }
  const vm = {
    apiVersion: "kubevirt.io/v1",
    kind: "VirtualMachine",
    metadata: { name, namespace: ns, labels: tag },
    spec: {
      runStrategy: "Always",
      template: {
        metadata: { labels: tag },
        spec: {
          domain: {
            cpu: { cores: options.cpus },
            memory: { guest: options.memory },
            devices: {
              disks: [
                { name: "os", disk: { bus: "virtio" } },
                { name: "cloudinit", disk: { bus: "virtio" } },
                { name: "data", disk: { bus: "virtio", serial: "kestrel-data" } },
              ],
              interfaces: [{ name: "default", masquerade: {} }],
              ...(options.gpuDevice === null
                ? {}
                : { gpus: [{ name: "gpu-0", deviceName: options.gpuDevice }] }),
            },
          },
          networks: [{ name: "default", pod: {} }],
          volumes: [
            { name: "os", dataVolume: { name: `os-${name}` } },
            { name: "cloudinit", cloudInitNoCloud: { userDataSecretRef: { name: `cloudinit-${name}` } } },
            { name: "data", dataVolume: { name: `data-${name}` } },
          ],
        },
      },
      dataVolumeTemplates: [
        dataVolume(options, `os-${name}`, { registry: { url: options.image } }, options.osSize),
        dataVolume(options, `data-${name}`, { blank: {} }, options.diskSize),
      ],
    },
  }
  const service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace: ns, labels: tag },
    spec: {
      selector: { "kubevirt.io/domain": name },
      ports: [{ name: "http", protocol: "TCP", port: options.port, targetPort: options.port }],
    },
  }
  const ingress = {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name,
      namespace: ns,
      labels: tag,
      annotations: {
        "nginx.ingress.kubernetes.io/proxy-body-size": "16m",
        "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
        "nginx.ingress.kubernetes.io/proxy-send-timeout": "3600",
        "nginx.ingress.kubernetes.io/server-snippet":
          "location ~ ^/(mcp|broker|gh)(/|$) { return 404; }\n",
        ...(options.clusterIssuer === null ? {} : { "cert-manager.io/cluster-issuer": options.clusterIssuer }),
      },
    },
    spec: {
      ingressClassName: "nginx",
      tls: [{ hosts: [options.host], secretName: `${name}-tls` }],
      rules: [
        {
          host: options.host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: { service: { name, port: { number: options.port } } },
              },
            ],
          },
        },
      ],
    },
  }
  return { apiVersion: "v1", kind: "List", items: [namespace, networkPolicy, secret, vm, service, ingress] }
}

const run = async (command: readonly string[], stdin?: string): Promise<void> => {
  const child = Bun.spawn([...command], {
    stdin: stdin === undefined ? "inherit" : "pipe",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (stdin !== undefined) {
    const sink = child.stdin
    if (sink === undefined) throw new Error(`${command[0] ?? "command"} did not accept stdin`)
    sink.write(stdin)
    sink.end()
  }
  const code = await child.exited
  if (code !== 0) throw new Error(`${command.join(" ")} exited ${code}`)
}

const create = async (options: CreateOptions): Promise<void> => {
  const manifest = JSON.stringify(render(options), null, 2)
  if (!options.apply) {
    process.stdout.write(`${manifest}\n`)
    return
  }
  await run([options.kubectl, "apply", "-f", "-"], manifest)
  if (options.wait) {
    await run([
      options.kubectl,
      "wait",
      "--for=condition=Ready",
      `vmi/${options.name}`,
      "-n",
      options.namespace,
      "--timeout=15m",
    ])
  }
  console.log(`box VM ${options.name} is at https://${options.host}`)
}

const remove = async (options: DeleteOptions): Promise<void> => {
  await run([
    options.kubectl,
    "delete",
    "vm,service,ingress,secret",
    "-n",
    options.namespace,
    "-l",
    `kestrel.io/box=${options.name}`,
    "--ignore-not-found",
  ])
  if (options.purge) {
    await run([
      options.kubectl,
      "delete",
      "dv,pvc",
      "-n",
      options.namespace,
      "-l",
      `kestrel.io/box=${options.name}`,
      "--ignore-not-found",
    ])
  }
}

const HELP = `kestrel nest VM

Usage:
  bun scripts/nest-vm.ts create --name NAME --host DNS --box-id ID --box-secret SECRET [options]
  bun scripts/nest-vm.ts delete --name NAME [--purge]

create options:
  --owner LOGIN            label and ownership marker (default: name)
  --namespace NAME         Kubernetes namespace (default: ${DEFAULT_NAMESPACE})
  --control-url URL        control plane (default: ${DEFAULT_CONTROL_URL})
  --managed                register as a managed-fleet box instead of the owner's own box
  --image URL              CDI registry source (default: ${DEFAULT_IMAGE})
  --os-size SIZE           OS disk (default: 20Gi)
  --disk-size SIZE         data disk (default: 50Gi)
  --storage-class NAME     StorageClass for both disks
  --cpus N                 vCPUs (default: 4)
  --memory SIZE            guest memory (default: 8Gi)
  --port N                 box port (default: ${DEFAULT_PORT})
  --gpu-device NAME        KubeVirt permitted device, e.g. nvidia.com/TU104GL_Tesla_T4
  --cluster-issuer NAME    cert-manager ClusterIssuer for the Ingress
  --ssh-key-file PATH      SSH public key for the kestrel user
  --box-binary-url URL     kestrel-box release asset
  --kubectl PATH           kubectl binary (default: kubectl)
  --apply                  apply with kubectl (default: print JSON)
  --wait                   wait for the VMI to become Ready (implies --apply)

delete options:
  --namespace NAME         Kubernetes namespace (default: ${DEFAULT_NAMESPACE})
  --purge                  also delete the DataVolumes and PVCs (data is lost)
`

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === "create") await create(parseCreateOptions(args))
    else if (command === "delete") await remove(parseDeleteOptions(args))
    else console.log(HELP)
  } catch (error) {
    console.error(`nest-vm: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
