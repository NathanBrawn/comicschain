"use client";
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

type ComicMeta = { title?: string; description?: string; coverCID?: string; price?: string };

export default function ShelfPage() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [items, setItems] = useState<Array<{ tokenId: number; meta: ComicMeta }>>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!window.ethereum) return;
        const p = new ethers.BrowserProvider(window.ethereum);
        setProvider(p);
        try {
          const accts: string[] = await p.send("eth_accounts", []);
          if (accts && accts.length > 0) {
            const s = await p.getSigner();
            setSigner(s);
            try { setAddress((await s.getAddress())?.toLowerCase?.() || ""); } catch {}
          }
        } catch {}
        const n = await p.getNetwork();
        setChainId(Number(n.chainId));
      } catch {}
    })();
  }, []);

  const registry = useMemo(() => {
    if (!signer || chainId == null) return null;
    const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
    return new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);
  }, [signer, chainId]);

  useEffect(() => {
    (async () => {
      if (!address) return;
      try {
        const ids: bigint[] = registry ? await registry.getShelf(address) : [];
        const arr: Array<{ tokenId: number; meta: ComicMeta }> = [];
        const toLoad: number[] = ids.length ? ids.map((v) => Number(v)) : (() => {
          // 链上失败时，尝试从本地书架读取
          try {
            const raw = localStorage.getItem(`shelf:${address.toLowerCase()}`);
            const stored: number[] = raw ? JSON.parse(raw) : [];
            return stored;
          } catch { return []; }
        })();
        for (const id of toLoad) {
          try {
            const info = registry ? await registry.getComicInfo(Number(id)) : [""] as any;
            const uri: string = info[0];
            let meta: ComicMeta = {};
            if (uri) {
              const res = await fetch(`/api/ipfs?uri=${encodeURIComponent(uri)}&as=json`);
              if (res.ok) meta = await res.json();
            }
            arr.push({ tokenId: Number(id), meta });
          } catch {}
        }
        setItems(arr);
      } catch {}
    })();
  }, [registry, address]);

  const removeFromShelf = async (tokenId: number) => {
    if (!address) return;
    setBusy(tokenId);
    try {
      if (registry) {
        const tx = await registry.removeFromShelf(tokenId);
        await tx.wait();
      } else {
        // 本地兜底：移除
        try {
          const k = `shelf:${address.toLowerCase()}`;
          const raw = localStorage.getItem(k);
          const arr: number[] = raw ? JSON.parse(raw) : [];
          localStorage.setItem(k, JSON.stringify(arr.filter((i) => i !== tokenId)));
        } catch {}
      }
      setItems((prev) => prev.filter((i) => i.tokenId !== tokenId));
    } catch (e: any) {
      alert(e?.reason || e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const openReader = async (tokenId: number) => {
    if (!registry || !signer) { window.location.href = `/comic?id=${tokenId}`; return; }
    try {
      const addr = await signer.getAddress();
      const has = await registry.hasAccess(tokenId, addr);
      if (!has) {
        const chain = await signer.provider?.getNetwork();
        const chainIdNum = Number(chain?.chainId || 0);
        // 参考详情页授权流程
        if (chainIdNum === 31337) {
          const { MockFhevmInstance } = await import("@fhevm/mock-utils");
          const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
          const inst = await MockFhevmInstance.create(p, p, {
            aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
            chainId: 31337,
            gatewayChainId: 55815,
            inputVerifierContractAddress: "0x901F8942346f7AB3a01F6D7613119Bca447Bb030",
            kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
            verifyingContractAddressDecryption: "0x5ffdaAB0373E62E2ea2944776209aEf29E631A64",
            verifyingContractAddressInputVerification: "0x812b06e1CDCE800494b79fFE4f925A504a9A9810",
          });
          const buf = inst.createEncryptedInput(await registry.getAddress(), addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const tx = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await tx.wait();
        } else {
          if (!("relayerSDK" in window)) {
            await new Promise<void>((resolve, reject) => {
              const sc = document.createElement("script");
              sc.src = "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs";
              sc.async = true; sc.onload = () => resolve(); sc.onerror = () => reject();
              document.head.appendChild(sc);
            });
          }
          await (window as any).relayerSDK.initSDK();
          const inst = await (window as any).relayerSDK.createInstance({
            ...(window as any).relayerSDK.SepoliaConfig,
            network: (window as any).ethereum,
          });
          const buf = inst.createEncryptedInput(await registry.getAddress(), addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const tx = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await tx.wait();
        }
      }
      window.location.href = `/reader?id=${tokenId}`;
    } catch (e: any) {
      alert(e?.reason || e?.message || String(e));
    }
  };

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="title">My Shelf</div>
        <div className="row" style={{ gap: 8 }}>
          {!address ? <button className="btn" onClick={async () => {
            if (!provider) return;
            try { await provider.send("eth_requestAccounts", []); location.reload(); } catch {}
          }}>连接钱包</button> : null}
          <a className="btn secondary" href="/explore">Explore</a>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="muted">书架为空</div>
      ) : (
        <div className="grid" style={{ gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", display: "grid" }}>
          {items.map(({ tokenId, meta }) => (
            <div key={tokenId} className="card">
              {meta.coverCID ? (
                <img className="cover" src={`/api/ipfs?cid=${encodeURIComponent(meta.coverCID)}`} />
              ) : (
                <div className="muted" style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center" }}>No Cover</div>
              )}
              <div style={{ marginTop: 8, fontWeight: 700 }}>{meta.title || `#${tokenId}`}</div>
              <div className="row">
                <button className={`btn ${busy===tokenId?"loading":""}`} onClick={() => openReader(tokenId)} disabled={busy===tokenId}>打开/解密</button>
                <button className={`btn secondary ${busy===tokenId?"loading":""}`} onClick={() => removeFromShelf(tokenId)} disabled={busy===tokenId}>移除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}


