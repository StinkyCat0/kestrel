import { describe, expect, test } from "bun:test"
import { cloudInit, parseCreateOptions, render, type Manifest, type VmOptions } from "./nest-vm"

const base = (args: string[] = []): VmOptions =>
  parseCreateOptions([
    "--name",
    "alice",
    "--host",
    "alice.nest.example.com",
    "--box-id",
    "box_123",
    "--box-secret",
    "super-secret",
    ...args,
  ])

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected an object")
  return value as Record<string, unknown>
}

const list = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error("expected an array")
  return value
}

const resource = (manifest: Manifest, kind: string): Record<string, unknown> => {
  const found = manifest.items.find((item) => item["kind"] === kind)
  if (found === undefined) throw new Error(`no ${kind} in the manifest`)
  return found
}

describe("nest VM manifest", () => {
  test("renders one VM with persistent OS and data disks", () => {
    const manifest = render(base())
    expect(manifest.kind).toBe("List")
    const vm = resource(manifest, "VirtualMachine")
    const spec = record(vm["spec"])
    const template = record(spec["template"])
    const domain = record(record(template["spec"])["domain"])
    const dvTemplates = list(spec["dataVolumeTemplates"]).map(record)
    expect(record(vm["metadata"])["name"]).toBe("alice")
    expect(record(vm["metadata"])["namespace"]).toBe("kestrel-nest")
    expect(dvTemplates.map((dv) => record(dv["metadata"])["name"])).toEqual(["os-alice", "data-alice"])
    expect(record(record(record(dvTemplates[0]?.["spec"])["source"])["registry"])["url"]).toBe(
      "docker://quay.io/containerdisks/ubuntu:26.04",
    )
    expect(record(dvTemplates[1]?.["spec"])["source"]).toEqual({ blank: {} })
    expect(record(list(record(domain["devices"])["disks"])[2])["disk"]).toEqual({ bus: "virtio" })
    expect(record(domain["cpu"])["cores"]).toBe(4)
    expect(record(domain["memory"])["guest"]).toBe("8Gi")
  })

  test("exposes the box through the ingress and blocks sandbox-only paths", () => {
    const manifest = render(base(["--cluster-issuer", "letsencrypt"]))
    const service = resource(manifest, "Service")
    const serviceSpec = record(service["spec"])
    expect(serviceSpec["selector"]).toEqual({ "kubevirt.io/domain": "alice" })
    expect(record(list(serviceSpec["ports"])[0])["port"]).toBe(8787)
    const ingress = resource(manifest, "Ingress")
    const ingressSpec = record(ingress["spec"])
    expect(ingressSpec["ingressClassName"]).toBe("nginx")
    expect(record(list(ingressSpec["rules"])[0])["host"]).toBe("alice.nest.example.com")
    expect(record(list(ingressSpec["tls"])[0])["secretName"]).toBe("alice-tls")
    const annotations = record(record(ingress["metadata"])["annotations"])
    expect(annotations["cert-manager.io/cluster-issuer"]).toBe("letsencrypt")
    expect(annotations["nginx.ingress.kubernetes.io/server-snippet"]).toContain("^/(mcp|broker|gh)")
  })

  test("uses traefik and HTTP only when no cert-manager issuer is configured", () => {
    const manifest = render(base(["--ingress-class", "traefik"]))
    const ingress = resource(manifest, "Ingress")
    const spec = record(ingress["spec"])
    expect(spec["ingressClassName"]).toBe("traefik")
    expect(spec).not.toHaveProperty("tls")
    const policy = resource(manifest, "NetworkPolicy")
    const policySpec = record(policy["spec"])
    const from = list(record(list(policySpec["ingress"])[0])["from"])
    expect(from).toEqual([
      { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ingress-nginx" } } },
      { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } },
    ])
  })

  test("includes the box identity and data disk setup in cloud-init", () => {
    const userdata = cloudInit(base())
    expect(userdata).toContain('"boxId": "box_123"')
    expect(userdata).toContain('"boxSecret": "super-secret"')
    expect(userdata).toContain('"dataDir": "/var/lib/kestrel"')
    expect(userdata).toContain("virtio-kestrel-data")
    expect(userdata).toContain("mkfs.ext4 -F -L kestrel-data")
    expect(userdata).toContain("kestrel-box install")
    expect(userdata).toContain("npm install -g @anthropic-ai/claude-code @openai/codex")
    expect(userdata).not.toContain("CLOUDAGENTS_BOX_MANAGED")
  })

  test("marks managed-fleet boxes and leaves own boxes unmarked", () => {
    expect(cloudInit(base(["--managed"]))).toContain("Environment=CLOUDAGENTS_BOX_MANAGED=1")
    expect(cloudInit(base())).not.toContain("CLOUDAGENTS_BOX_MANAGED")
  })

  test("adds a GPU only when a permitted device is named", () => {
    const plain = resource(render(base()), "VirtualMachine")
    const plainDomain = record(record(record(plain["spec"])["template"])["spec"])
    expect(record(plainDomain["domain"])["devices"]).not.toHaveProperty("gpus")
    const gpu = resource(render(base(["--gpu-device", "nvidia.com/TU104GL_Tesla_T4"])), "VirtualMachine")
    const gpuDomain = record(record(record(gpu["spec"])["template"])["spec"])
    expect(record(gpuDomain["domain"])["devices"]).toHaveProperty("gpus")
  })

  test("rejects names, hosts and sizes Kubernetes cannot represent", () => {
    expect(() => base(["--name", "Alice"])).toThrow("DNS label")
    expect(() => base(["--host", "http://alice"])).toThrow("DNS hostname")
    expect(() => base(["--disk-size", "50GB"])).toThrow("size such as 50Gi")
    expect(() => base(["--cpus", "0"])).toThrow("--cpus")
  })

  test("defaults to the public control plane and the box release asset", () => {
    const options = base()
    expect(options.controlUrl).toBe("https://app.kestrel-agent.com")
    expect(options.boxBinaryUrl).toBe(
      "https://github.com/jarenm1/kestrel/releases/latest/download/kestrel-box-linux-x64",
    )
    expect(options.storageClass).toBeNull()
  })
})
