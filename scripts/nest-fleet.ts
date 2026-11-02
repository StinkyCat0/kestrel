#!/usr/bin/env bun
/**
 * Reconciles a list of users to KubeVirt boxes: one owner-pinned managed box and one VM per user.
 *
 * For each user it finds (or creates) a managed box pinned to that user in the control plane, renders the same VM as
 * `scripts/nest-vm.ts`, applies it, waits for the VMI, and activates the box. The control plane then assigns that user
 * to their own box before any shared managed box, so the apps reach the VM automatically.
 *
 * An operator session cookie is required (`KESTREL_OPERATOR_COOKIE` or `--cookie`); obtain it from a signed-in
 * browser. `--apply` is required to touch the cluster or the control plane; without it the script prints what it would
 * do.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { render, type Manifest, type VmOptions } from "./nest-vm"

const DEFAULT_CONTROL_URL = "https://app.kestrel-agent.com"
const DEFAULT_NAMESPACE = "kestrel-nest"
const DEFAULT_IMAGE = "docker://quay.io/containerdisks/ubuntu:26.04"
const DEFAULT_BOX_BINARY =
  "https://github.com/jarenm1/kestrel/releases/latest/download/kestrel-box-linux-x64"
const DEFAULT_PORT = 8787

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const HOST = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/
const SIZE = /^\d+(Mi|Gi|Ti)$/
const MEMORY = /^\d+(Mi|Gi)$/

export interface FleetBox {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly state: "pending" | "active" | "draining"
  readonly users: number
  readonly owner: string | null
  readonly createdAt: string
}

interface CreatedFleetBox {
  readonly box: FleetBox
  readonly secret: string
}

export interface FleetOptions {
  readonly controlUrl: string
  readonly cookie: string
  readonly users: readonly string[]
  readonly domain: string
  readonly namespace: string
  readonly image: string
  readonly osSize: string
  readonly diskSize: string
  readonly storageClass: string | null
  readonly cpus: number
  readonly memory: string
  readonly port: number
  readonly gpuDevice: string | null
  readonly clusterIssuer: string | null
  readonly ingressClass: string
  readonly sshKey: string | null
  readonly boxBinaryUrl: string
  readonly kubectl: string
  readonly apply: boolean
  readonly wait: boolean
}

export interface DeleteFleetOptions {
  readonly controlUrl: string
  readonly cookie: string
  readonly users: readonly string[]
  readonly namespace: string
  readonly purge: boolean
  readonly kubectl: string
}

const required = (value: string | undefined, flag: string): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${flag} is required`)
  return value.trim()
}

const integer = (value: string | undefined, flag: string, min: number, max: number): number => {
  if (value === undefined) throw new Error(`${flag} is required`)
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be an integer from ${min} to ${max}`)
  return n
}

const size = (value: string, flag: string, regex: RegExp): string => {
  if (!regex.test(value)) throw new Error(`${flag} must be a size such as 20Gi`)
  return value
}

/** A Kubernetes-safe name for the user's box. The hash keeps sanitized logins distinct. */
export const boxNameFor = (login: string): string => {
  const base = login
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const hash = createHash("sha1").update(login).digest("hex").slice(0, 6)
  return `${base === "" ? "user" : base}-${hash}`.slice(0, 50).replace(/-+$/g, "")
}

export const hostFor = (login: string, domain: string): string => `${boxNameFor(login)}.${domain}`

export const parseUsers = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))

const cookieHeader = (value: string): string => (value.includes("=") ? value : `session=${value}`)

const readUsers = (values: { users?: string; "users-file"?: string }): string[] => {
  const listed = values.users === undefined ? [] : parseUsers(values.users)
  const filed = values["users-file"] === undefined ? [] : parseUsers(readFileSync(values["users-file"], "utf8"))
  const users = [...new Set([...listed, ...filed])]
  if (users.length === 0) throw new Error("--users or --users-file is required")
  return users
}

export const parseSyncOptions = (argv: readonly string[]): FleetOptions => {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "control-url": { type: "string" },
      cookie: { type: "string" },
      users: { type: "string" },
      "users-file": { type: "string" },
      domain: { type: "string" },
      namespace: { type: "string" },
      image: { type: "string" },
      "os-size": { type: "string" },
      "disk-size": { type: "string" },
      "storage-class": { type: "string" },
      cpus: { type: "string" },
      memory: { type: "string" },
      port: { type: "string" },
      "gpu-device": { type: "string" },
      "cluster-issuer": { type: "string" },
      "ingress-class": { type: "string" },
      "ssh-key-file": { type: "string" },
      "box-binary-url": { type: "string" },
      kubectl: { type: "string" },
      apply: { type: "boolean" },
      wait: { type: "boolean" },
    },
  })
  const domain = required(values.domain, "--domain")
  if (!HOST.test(domain)) throw new Error(`--domain must be a DNS name such as nest.example.com, got "${domain}"`)
  const namespace = values.namespace ?? DEFAULT_NAMESPACE
  if (!NAME.test(namespace) || namespace.length > 50) throw new Error(`--namespace must be a DNS label`)
  const osSize = values["os-size"] ?? "20Gi"
  const diskSize = values["disk-size"] ?? "50Gi"
  const memory = values.memory ?? "8Gi"
  size(osSize, "--os-size", SIZE)
  size(diskSize, "--disk-size", SIZE)
  size(memory, "--memory", MEMORY)
  const sshKey = values["ssh-key-file"] === undefined ? null : readFileSync(values["ssh-key-file"], "utf8").trim()
  if (sshKey !== null && !sshKey.startsWith("ssh-")) throw new Error("--ssh-key-file must contain an SSH public key")
  const gpu = values["gpu-device"]?.trim() || null
  if (gpu !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(gpu)) {
    throw new Error("--gpu-device must be a device plugin resource name such as nvidia.com/TU104GL_Tesla_T4")
  }
  return {
    controlUrl: (values["control-url"] ?? process.env.KESTREL_CONTROL_URL ?? DEFAULT_CONTROL_URL).replace(/\/+$/, ""),
    cookie: cookieHeader(required(values.cookie ?? process.env.KESTREL_OPERATOR_COOKIE, "--cookie")),
    users: readUsers(values),
    domain,
    namespace,
    image: values.image ?? DEFAULT_IMAGE,
    osSize,
    diskSize,
    storageClass: values["storage-class"]?.trim() || null,
    cpus: integer(values.cpus ?? "4", "--cpus", 1, 64),
    memory,
    port: integer(values.port ?? String(DEFAULT_PORT), "--port", 1, 65535),
    gpuDevice: gpu,
    clusterIssuer: values["cluster-issuer"]?.trim() || null,
    ingressClass: values["ingress-class"]?.trim() || "nginx",
    sshKey,
    boxBinaryUrl: values["box-binary-url"] ?? DEFAULT_BOX_BINARY,
    kubectl: values.kubectl ?? "kubectl",
    apply: values.apply === true,
    wait: values.wait === true,
  }
}

export const parseDeleteOptions = (argv: readonly string[]): DeleteFleetOptions => {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "control-url": { type: "string" },
      cookie: { type: "string" },
      users: { type: "string" },
      "users-file": { type: "string" },
      namespace: { type: "string" },
      purge: { type: "boolean" },
      kubectl: { type: "string" },
    },
  })
  const namespace = values.namespace ?? DEFAULT_NAMESPACE
  if (!NAME.test(namespace) || namespace.length > 50) throw new Error(`--namespace must be a DNS label`)
  return {
    controlUrl: (values["control-url"] ?? process.env.KESTREL_CONTROL_URL ?? DEFAULT_CONTROL_URL).replace(/\/+$/, ""),
    cookie: cookieHeader(required(values.cookie ?? process.env.KESTREL_OPERATOR_COOKIE, "--cookie")),
    users: readUsers(values),
    namespace,
    purge: values.purge === true,
    kubectl: values.kubectl ?? "kubectl",
  }
}

const request = async (
  options: { controlUrl: string; cookie: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const response = await fetch(`${options.controlUrl}${path}`, {
    method,
    headers: {
      cookie: options.cookie,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`)
  return text === "" ? undefined : (JSON.parse(text) as unknown)
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("control plane returned an unexpected shape")
  }
  return value as Record<string, unknown>
}

const decodeFleetBox = (value: unknown): FleetBox => {
  const row = record(value)
  const state = row.state
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.url !== "string" ||
    typeof row.createdAt !== "string" ||
    (state !== "pending" && state !== "active" && state !== "draining")
  ) {
    throw new Error("control plane returned an unexpected box")
  }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    state,
    users: typeof row.users === "number" ? row.users : 0,
    owner: typeof row.owner === "string" ? row.owner : null,
    createdAt: row.createdAt,
  }
}

const decodeCreated = (value: unknown): CreatedFleetBox => {
  const row = record(value)
  if (typeof row.secret !== "string") throw new Error("control plane returned no box secret")
  return { box: decodeFleetBox(row.box), secret: row.secret }
}

const listBoxes = async (options: { controlUrl: string; cookie: string }): Promise<readonly FleetBox[]> => {
  const row = record(await request(options, "GET", "/api/fleet/boxes"))
  if (!Array.isArray(row.boxes)) throw new Error("control plane returned an unexpected fleet list")
  return row.boxes.map(decodeFleetBox)
}

const createBox = async (options: FleetOptions, user: string): Promise<CreatedFleetBox> =>
  decodeCreated(
    await request(options, "POST", "/api/fleet/boxes", {
      name: boxNameFor(user),
      url: `https://${hostFor(user, options.domain)}`,
      owner: user,
    }),
  )

const rotateSecret = async (options: FleetOptions, id: string): Promise<CreatedFleetBox> =>
  decodeCreated(await request(options, "POST", `/api/fleet/boxes/${encodeURIComponent(id)}/secret`))

const activateBox = async (options: FleetOptions, id: string): Promise<FleetBox> =>
  decodeFleetBox(await request(options, "PATCH", `/api/fleet/boxes/${encodeURIComponent(id)}`, { state: "active" }))

const removeBox = async (options: DeleteFleetOptions, id: string): Promise<void> => {
  const response = await fetch(`${options.controlUrl}/api/fleet/boxes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { cookie: options.cookie },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`DELETE /api/fleet/boxes/${id}: ${response.status} ${await response.text()}`)
  }
}

const runKubectl = async (options: { kubectl: string }, args: readonly string[], stdin?: string): Promise<void> => {
  const child = Bun.spawn([options.kubectl, ...args], {
    stdin: stdin === undefined ? "inherit" : "pipe",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (stdin !== undefined) {
    const sink = child.stdin
    if (sink === undefined) throw new Error(`${options.kubectl} did not accept stdin`)
    sink.write(stdin)
    sink.end()
  }
  const code = await child.exited
  if (code !== 0) throw new Error(`${options.kubectl} ${args.join(" ")} exited ${code}`)
}

const vmExists = (options: FleetOptions, name: string): boolean => {
  try {
    const child = Bun.spawnSync([options.kubectl, "get", "vm", name, "-n", options.namespace, "-o", "name"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    return child.exitCode === 0
  } catch {
    return false
  }
}

const vmOptions = (options: FleetOptions, user: string, box: { id: string; secret: string }): VmOptions => ({
  name: boxNameFor(user),
  owner: user,
  namespace: options.namespace,
  host: hostFor(user, options.domain),
  boxId: box.id,
  boxSecret: box.secret,
  controlUrl: options.controlUrl,
  managed: true,
  image: options.image,
  osSize: options.osSize,
  diskSize: options.diskSize,
  storageClass: options.storageClass,
  cpus: options.cpus,
  memory: options.memory,
  port: options.port,
  gpuDevice: options.gpuDevice,
  clusterIssuer: options.clusterIssuer,
  ingressClass: options.ingressClass,
  sshKey: options.sshKey,
  boxBinaryUrl: options.boxBinaryUrl,
})

const syncUser = async (options: FleetOptions, user: string, boxes: readonly FleetBox[]): Promise<void> => {
  const name = boxNameFor(user)
  const existing = boxes.find((box) => box.owner === user)

  if (!options.apply) {
    console.log(
      `${user}: would ${existing === undefined ? "create an owner-pinned managed box and" : "use the owned box and"} ` +
        `reconcile VM ${name} at https://${hostFor(user, options.domain)}`,
    )
    return
  }

  let box = existing
  let secret: string | null = null

  if (box === undefined) {
    const created = await createBox(options, user)
    box = created.box
    secret = created.secret
    console.log(`${user}: created managed box ${box.id}`)
  } else if (!vmExists(options, name)) {
    const rotated = await rotateSecret(options, box.id)
    box = rotated.box
    secret = rotated.secret
    console.log(`${user}: box ${box.id} exists; rotated its secret for the missing VM`)
  } else {
    console.log(`${user}: box ${box.id} and VM ${name} already exist`)
    if (box.state === "pending") await activateBox(options, box.id)
    return
  }

  const manifest: Manifest = render(vmOptions(options, user, { id: box.id, secret: secret ?? "" }))
  await runKubectl(options, ["apply", "-f", "-"], JSON.stringify(manifest))
  if (options.wait) {
    await runKubectl(options, [
      "wait",
      "--for=condition=Ready",
      `vmi/${name}`,
      "-n",
      options.namespace,
      "--timeout=15m",
    ])
  }
  await activateBox(options, box.id)
  console.log(`${user}: ${name} is at https://${hostFor(user, options.domain)}`)
}

const sync = async (options: FleetOptions): Promise<void> => {
  for (const user of options.users) {
    await syncUser(options, user, await listBoxes(options))
  }
}

const remove = async (options: DeleteFleetOptions): Promise<void> => {
  const boxes = await listBoxes(options)
  for (const user of options.users) {
    const box = boxes.find((candidate) => candidate.owner === user)
    if (box === undefined) {
      console.log(`${user}: no owned box`)
      continue
    }
    const name = boxNameFor(user)
    await runKubectl(options, [
      "delete",
      "vm,service,ingress,secret",
      "-n",
      options.namespace,
      "-l",
      `kestrel.io/box=${name}`,
      "--ignore-not-found",
    ])
    if (options.purge) {
      await runKubectl(options, [
        "delete",
        "dv,pvc",
        "-n",
        options.namespace,
        "-l",
        `kestrel.io/box=${name}`,
        "--ignore-not-found",
      ])
    }
    await removeBox(options, box.id)
    console.log(`${user}: removed ${name}${options.purge ? " (data deleted)" : " (data kept)"}`)
  }
}

const HELP = `kestrel nest fleet

Usage:
  bun scripts/nest-fleet.ts sync --users alice,bob --domain nest.example.com --cookie SESSION [--apply] [--wait]
  bun scripts/nest-fleet.ts delete --users alice,bob --cookie SESSION [--purge]

Every user gets one owner-pinned managed box and one KubeVirt VM. The control plane assigns a user to their pinned box
before any shared managed box, so the apps reach the VM automatically.

Options:
  --control-url URL        control plane (default: ${DEFAULT_CONTROL_URL})
  --cookie COOKIE          operator session cookie, or KESTREL_OPERATOR_COOKIE
  --users a,b              GitHub logins (repeatable via --users-file)
  --users-file PATH        one login per line; # comments allowed
  --domain NAME            ingress suffix; hosts are <box-name>.<domain>
  --namespace NAME         Kubernetes namespace (default: ${DEFAULT_NAMESPACE})
  --image URL              CDI registry source (default: ${DEFAULT_IMAGE})
  --os-size / --disk-size  disks (default: 20Gi / 50Gi)
  --storage-class NAME     StorageClass for both disks
  --cpus N / --memory SIZE (default: 4 / 8Gi)
  --gpu-device NAME        KubeVirt permitted device
  --cluster-issuer NAME    cert-manager ClusterIssuer
  --ingress-class NAME     Ingress class (default: nginx; use traefik on k3s)
  --ssh-key-file PATH      SSH public key for the kestrel user
  --box-binary-url URL     kestrel-box release asset
  --kubectl PATH           kubectl binary (default: kubectl)
  --apply                  create boxes/VMs (default: dry run)
  --wait                   wait for each VMI to become Ready
  --purge                  delete DataVolumes and PVCs on delete
`

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === "sync") await sync(parseSyncOptions(args))
    else if (command === "delete") await remove(parseDeleteOptions(args))
    else console.log(HELP)
  } catch (error) {
    console.error(`nest-fleet: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
