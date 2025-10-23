"use client";
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

type ComicMeta = { title?: string; description?: string; coverCID?: string };

export default function Explore() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [rpcProvider, setRpcProvider] = useState<ethers.Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [items, setItems] = useState<Array<{ tokenId: number; meta: ComicMeta }>>([]);
  const [hasWalletAuth, setHasWalletAuth] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        if (window.ethereum) {
          const p = new ethers.BrowserProvider(window.ethereum);
          setProvider(p);
          let detectedChainId: number | null = null;
          try {
            const n = await p.getNetwork();
            detectedChainId = Number(n.chainId);
            setChainId(detectedChainId);
          } catch {}
          try {
            const accts: string[] = await p.send("eth_accounts", []);
            if (accts && accts.length > 0) {
              setHasWalletAuth(true);
              const s = await p.getSigner();
              setSigner(s);
              try { setAddress((await s.getAddress())?.toLowerCase?.() || ""); } catch {}
            } else {
              // 未授权：走只读 RPC，避免 -32006
              const url = detectedChainId === 31337 ? "http://127.0.0.1:8545" : "https://rpc.sepolia.org";
              const rp = new ethers.JsonRpcProvider(url);
              setRpcProvider(rp);
            }
          } catch {
            const url = "https://rpc.sepolia.org";
            const rp = new ethers.JsonRpcProvider(url);
            setRpcProvider(rp);
          }
        } else {
          // 无钱包：使用公共 RPC 只读
          const url = "https://rpc.sepolia.org";
          const rp = new ethers.JsonRpcProvider(url);
          setRpcProvider(rp);
          const n = await rp.getNetwork();
          setChainId(Number(n.chainId));
        }
      } catch {}
    })();
  }, []);

  const registry = useMemo(() => {
    if (chainId == null) return null;
    const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
    // 优先只读 RPC（未授权），否则用 signer
    const conn: any = signer || rpcProvider || provider;
    if (!conn) return null;
    return new ethers.Contract(info.address, MiniComicRegistryABI.abi, conn);
  }, [signer, provider, rpcProvider, chainId]);

  useEffect(() => {
    (async () => {
      if (!registry) return;
      try {
        const next: bigint = await registry.nextTokenId();
        const arr: Array<{ tokenId: number; meta: ComicMeta }> = [];
        for (let i = 1n; i < next; i++) {
          try {
            const info = await registry.getComicInfo(Number(i));
            const uri: string = info[0];
            let meta: ComicMeta = {};
            if (uri) {
              const res = await fetch(`/api/ipfs?uri=${encodeURIComponent(uri)}&as=json`);
              if (res.ok) meta = await res.json();
            }
            arr.push({ tokenId: Number(i), meta });
          } catch {}
        }
        setItems(arr);
      } catch {}
    })();
  }, [registry]);

  const addToShelf = async (tokenId: number) => {
    try {
      if (!signer) {
        if (provider) {
          await provider.send("eth_requestAccounts", []);
          location.reload();
          return;
        }
        alert("请先连接钱包");
        return;
      }
      const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
      const write = new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);
      // 1) 作品存在性校验
      const meta = await write.getComicInfo(tokenId);
      if (!meta || !meta[0]) {
        alert("作品不存在或尚未铸造");
        return;
      }
      // 2) 仅允许已拥有或已解锁访问的用户加入
      const addr = await signer.getAddress();
      const isOwner = (meta[1]?.toLowerCase?.() || "") === addr.toLowerCase();
      let has = false;
      try { has = await write.hasAccess(tokenId, addr); } catch {}
      if (!isOwner && !has) {
        // 自动执行一次访问授权（0 ETH），以避免 require(false)
        try {
          const chain = await write.runner?.provider?.getNetwork?.();
          const chainIdNum = Number(chain?.chainId || 0);
          let instance: any = null;
          if (chainIdNum === 31337) {
            const { MockFhevmInstance } = await import("@fhevm/mock-utils");
            const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
            instance = await MockFhevmInstance.create(p, p, {
              aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
              chainId: 31337,
              gatewayChainId: 55815,
              inputVerifierContractAddress: "0x901F8942346f7AB3a01F6D7613119Bca447Bb030",
              kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
              verifyingContractAddressDecryption: "0x5ffdaAB0373E62E2ea2944776209aEf29E631A64",
              verifyingContractAddressInputVerification: "0x812b06e1CDCE800494b79fFE4f925A504a9A9810",
            });
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
            instance = await (window as any).relayerSDK.createInstance({
              ...(window as any).relayerSDK.SepoliaConfig,
              network: (window as any).ethereum,
            });
          }
          const contractAddress = await write.getAddress();
          const buf = instance.createEncryptedInput(contractAddress, addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const txAcc = await write.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await txAcc.wait();
          has = true;
        } catch {
          alert("仅已购买/拥有后可加入书架");
          return;
        }
      }
      // 拥有者但未授权访问时，自动给自己授权一次
      if (isOwner && !has) {
        try {
          // 对于 Explore，我们无法复用 ensureFhevmInstance，这里按 Home 的本地/远程配置创建实例
          const chain = await write.runner?.provider?.getNetwork?.();
          const chainIdNum = Number(chain?.chainId || 0);
          let instance: any = null;
          if (chainIdNum === 31337) {
            const { MockFhevmInstance } = await import("@fhevm/mock-utils");
            const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
            instance = await MockFhevmInstance.create(p, p, {
              aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
              chainId: 31337,
              gatewayChainId: 55815,
              inputVerifierContractAddress: "0x901F8942346f7AB3a01F6D7613119Bca447Bb030",
              kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
              verifyingContractAddressDecryption: "0x5ffdaAB0373E62E2ea2944776209aEf29E631A64",
              verifyingContractAddressInputVerification: "0x812b06e1CDCE800494b79fFE4f925A504a9A9810",
            });
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
            instance = await (window as any).relayerSDK.createInstance({
              ...(window as any).relayerSDK.SepoliaConfig,
              network: (window as any).ethereum,
            });
          }
          const contractAddress = await write.getAddress();
          const buf = instance.createEncryptedInput(contractAddress, addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const txAcc = await write.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await txAcc.wait();
        } catch {}
      }
      // 3) 重复加入校验
      try {
        const ids: bigint[] = await write.getShelf(addr);
        if (ids?.some?.((id: bigint) => Number(id) === tokenId)) {
          alert("已在书架");
          return;
        }
      } catch {}
      const tx = await write.addToShelf(tokenId);
      await tx.wait();
      alert("已加入书架");
    } catch (e: any) {
      alert(e?.reason || e?.message || String(e));
    }
  };

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="title">Explore</div>
        <a className="btn secondary" href="/shelf">My Shelf</a>
      </div>
      <div className="grid" style={{ gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", display: "grid" }}>
        {items.map(({ tokenId, meta }) => (
          <div key={tokenId} className="card">
            {meta.coverCID ? (
              <img className="cover" src={`/api/ipfs?cid=${encodeURIComponent(meta.coverCID)}`} />
            ) : (
              <div className="muted" style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center" }}>No Cover</div>
            )}
            <div style={{ marginTop: 8, fontWeight: 700 }}>{meta.title || `#${tokenId}`}</div>
            <div className="muted" style={{ minHeight: 40 }}>{meta.description || ""}</div>
            <div className="row">
              <a className="btn secondary" href={`/comic/${tokenId}`}>View</a>
              <button className="btn" onClick={() => addToShelf(tokenId)}>加入书架</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}


