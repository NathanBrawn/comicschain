import { Web3Storage, File } from "web3.storage";

async function putWithPinata(files: File[], jwt: string) {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error("Pinata upload failed");
  const j = await res.json();
  return j.IpfsHash as string;
}

function getClient() {
  const token = process.env.WEB3_STORAGE_TOKEN;
  if (!token) return null;
  return new Web3Storage({ token: token as string });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files: File[] = [];
    for (const [name, value] of formData.entries()) {
      if (value instanceof Blob) {
        files.push(new File([value], name));
      }
    }
    if (files.length === 0) return new Response(JSON.stringify({ error: "no files" }), { status: 400 });

    const client = getClient();
    if (client) {
      const cid = await client.put(files, { wrapWithDirectory: false });
      return new Response(JSON.stringify({ cid }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const pinataJwt = process.env.PINATA_JWT;
    if (pinataJwt) {
      const cid = await putWithPinata(files, pinataJwt);
      return new Response(JSON.stringify({ cid }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Mock 模式：将文件写入本地 .ipfs-mock 目录，返回 mock- 前缀的“cid”
    // 仅用于本地开发
    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const dir = join(process.cwd(), ".ipfs-mock");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const f = files[0];
    const id = (globalThis.crypto?.randomUUID?.() || String(Date.now())) as string;
    const name = `${id}-${f.name}`;
    const buf = Buffer.from(await f.arrayBuffer());
    writeFileSync(join(dir, name), buf);
    const cid = `mock-${name}`;
    return new Response(JSON.stringify({ cid }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500 });
  }
}


export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const uriParam = searchParams.get("uri") || "";
    const cidParam = searchParams.get("cid") || "";
    const pathParam = searchParams.get("path") || "";
    const forceJson = searchParams.get("as") === "json";

    let cidPath = "";
    if (uriParam) {
      if (uriParam.startsWith("ipfs://")) {
        cidPath = uriParam.slice("ipfs://".length);
      } else if (uriParam.startsWith("/ipfs/")) {
        cidPath = uriParam.slice("/ipfs/".length);
      } else {
        cidPath = uriParam;
      }
    } else if (cidParam) {
      cidPath = pathParam ? `${cidParam}/${pathParam}` : cidParam;
    } else {
      return new Response(JSON.stringify({ error: "missing uri or cid" }), { status: 400 });
    }

    // Mock 读取：mock- 前缀直接从 .ipfs-mock 读文件
    if (cidPath.startsWith("mock-")) {
      const { readFileSync, existsSync } = await import("fs");
      const { join } = await import("path");
      const dir = join(process.cwd(), ".ipfs-mock");
      const filePath = join(dir, cidPath.replace(/^mock-/, ""));
      if (!existsSync(filePath)) return new Response("Not found", { status: 404 });
      const data = readFileSync(filePath);
      const isJson = forceJson || /\.json$/i.test(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": isJson ? "application/json" : "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }

    const gateways = [
      "https://ipfs.io/ipfs/",
      "https://w3s.link/ipfs/",
      "https://cloudflare-ipfs.com/ipfs/",
      "https://gateway.pinata.cloud/ipfs/",
    ];

    for (const base of gateways) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(base + cidPath, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;

        const contentType = res.headers.get("content-type") || "";
        if (forceJson || contentType.includes("application/json")) {
          const j = await res.json();
          return new Response(JSON.stringify(j), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=60",
            },
          });
        }

        const buf = await res.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Cache-Control": "public, max-age=60",
          },
        });
      } catch {
        // try next gateway
      }
    }

    return new Response(JSON.stringify({ error: "IPFS fetch failed" }), { status: 502 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500 });
  }
}


