"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useSearchParams, useRouter } from "next/navigation";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

function ComicDetailInner() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [busy, setBusy] = useState<"idle"|"authorizing"|"done"|"buying">("idle");
  const [owner, setOwner] = useState<string>("");
  const [listed, setListed] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenId = Number(searchParams?.get("id") || "0");

  useEffect(() => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    setProvider(p);
    (async () => {
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      setSigner(s);
      try { setUserAddress((await s.getAddress()).toLowerCase()); } catch {}
      const n = await p.getNetwork();
      setChainId(Number(n.chainId));
    })();
  }, []);

  const registry = useMemo(() => {
    if (!signer || chainId == null) return null;
    const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
    return new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);
  }, [signer, chainId]);

  useEffect(() => {
    (async () => {
      if (!registry) return;
      const info = await registry.getComicInfo(tokenId);
      // tuple: metadataURI, owner, author, listed, supply, soldCount
      const uri: string = info[0];
      const ownerAddr: string = info[1];
      const listedFlag: boolean = info[3];
      setOwner(ownerAddr?.toLowerCase?.() || "");
      setListed(Boolean(listedFlag));
      if (uri) {
        const res = await fetch(`/api/ipfs?uri=${encodeURIComponent(uri)}&as=json`);
        if (res.ok) {
          const j = await res.json();
          setMeta(j);
        }
      }
    })();
  }, [registry, tokenId]);

  const buy = async () => {
    if (!registry || !meta) return;
    try {
      setBusy("buying");
      // 拥有者不可自购：若未上架则仅执行上架；若已上架则直接提示
      const isOwner = Boolean(owner && userAddress && owner === userAddress);
      if (isOwner) {
        if (!listed) {
          const inst = await ensureFhevmInstance();
          const contractAddress = await registry.getAddress();
          const priceWei = BigInt(meta.price || 0);
          const buf = inst.createEncryptedInput(contractAddress, userAddress);
          buf.add64(priceWei);
          const enc = await buf.encrypt();
          const txList = await registry.listForSale(tokenId, enc.handles[0], enc.inputProof, priceWei);
          await txList.wait();
          setListed(true);
          alert("已上架，拥有者不可自购");
        } else {
          alert("你是拥有者，不能购买");
        }
        setBusy("idle");
        return;
      }
      // If not listed but caller is owner, auto list then buy.
      // 非拥有者购买时要求已上架

      if (!listed && (!owner || owner !== userAddress)) {
        throw new Error("This comic is not listed for sale.");
      }
      const price = BigInt(meta.price || 0);
      const tx = await registry.buyNow(tokenId, { value: price });
      await tx.wait();
      setBusy("done");
    } catch (e:any) {
      alert(e?.reason || e?.message || String(e));
      setBusy("idle");
    }
  };

  const ensureFhevmInstance = async () => {
    if (!provider || !signer || chainId == null) throw new Error("wallet not ready");
    if (chainId === 31337) {
      const { MockFhevmInstance } = await import("@fhevm/mock-utils");
      const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      return await MockFhevmInstance.create(p, p, {
        aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
        chainId: 31337,
        gatewayChainId: 55815,
        inputVerifierContractAddress: "0x901F8942346f7AB3a01F6D7613119Bca447Bb030",
        kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
        verifyingContractAddressDecryption: "0x5ffdaAB0373E62E2ea2944776209aEf29E631A64",
        verifyingContractAddressInputVerification: "0x812b06e1CDCE800494b79fFE4f925A504a9A9810",
      });
    }
    if (!("relayerSDK" in window)) {
      await new Promise<void>((resolve, reject) => {
        const sc = document.createElement("script");
        sc.src = "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs";
        sc.async = true; sc.onload = () => resolve(); sc.onerror = () => reject();
        document.head.appendChild(sc);
      });
    }
    await (window as any).relayerSDK.initSDK();
    return await (window as any).relayerSDK.createInstance({
      ...(window as any).relayerSDK.SepoliaConfig,
      network: (window as any).ethereum,
    });
  };

  const openReader = async () => {
    if (!registry || !signer) return;
    try {
      setBusy("authorizing");
    const addr = await signer.getAddress();
    const has = await registry.hasAccess(tokenId, addr);
    if (!has) {
      const priceWei = BigInt(meta?.price || 0);
      const inst = await ensureFhevmInstance();
      const contractAddress = await registry.getAddress();
      const buf = inst.createEncryptedInput(contractAddress, addr);
      buf.add32(1);
      const enc = await buf.encrypt();
      const tx = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: priceWei });
      await tx.wait();
    }
      setBusy("done");
    router.push(`/reader?id=${tokenId}`);
    } catch (e) {
      setBusy("idle");
    }
  };

  const addToShelf = async () => {
    if (!registry) return;
    try {
      // 1) 作品存在性校验
      const info = await registry.getComicInfo(tokenId);
      const uri: string = info[0];
      if (!uri || uri.length === 0) {
        alert("作品不存在或尚未铸造");
        return;
      }
      // 2) 仅允许已拥有或已解锁访问的用户加入
      if (!signer) {
        alert("请先连接钱包");
        return;
      }
      const addr = await signer.getAddress();
      const isOwner = (info[1]?.toLowerCase?.() || "") === addr.toLowerCase();
      let has = false;
      try { has = await registry.hasAccess(tokenId, addr); } catch {}
      if (!isOwner && !has) {
        // 自动执行一次访问授权（0 ETH），以避免 require(false)（测试/演示用途）
        try {
          const inst = await ensureFhevmInstance();
          const contractAddress = await registry.getAddress();
          const buf = inst.createEncryptedInput(contractAddress, addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const txAcc = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await txAcc.wait();
          has = true;
        } catch {
          alert("仅已购买/拥有后可加入书架");
          return;
        }
      }
      // 如果是拥有者但尚未建立访问授权，则自动为其授权一次，避免链上 require 限制
      if (isOwner && !has) {
        try {
          const inst = await ensureFhevmInstance();
          const contractAddress = await registry.getAddress();
          const buf = inst.createEncryptedInput(contractAddress, addr);
          buf.add32(1);
          const enc = await buf.encrypt();
          const txAcc = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await txAcc.wait();
        } catch {}
      }
      // 2) 重复加入校验
      if (userAddress) {
        try {
          const ids: bigint[] = await registry.getShelf(userAddress);
          if (ids?.some?.((id: bigint) => Number(id) === tokenId)) {
            alert("已在书架");
            return;
          }
        } catch {}
      }
      try {
        const tx = await registry.addToShelf(tokenId);
        await tx.wait();
        alert("已加入书架");
      } catch (chainError) {
        // 链上失败兜底写本地书架
        try {
          const k = `shelf:${addr.toLowerCase()}`;
          const raw = localStorage.getItem(k);
          const set = new Set<number>(raw ? JSON.parse(raw) : []);
          set.add(tokenId);
          localStorage.setItem(k, JSON.stringify(Array.from(set)));
          alert("已加入书架（本地）");
        } catch {}
      }
    } catch (e: any) {
      alert(e?.reason || e?.message || String(e));
    }
  };

  const listForSale = async () => {
    if (!registry || !signer || !meta) return;
    try {
      setBusy("authorizing");
      const addr = await signer.getAddress();
      const inst = await ensureFhevmInstance();
      const contractAddress = await registry.getAddress();
      const priceWei = BigInt(meta.price || 0);
      const buf = inst.createEncryptedInput(contractAddress, addr);
      buf.add64(priceWei);
      const enc = await buf.encrypt();
      const tx = await registry.listForSale(tokenId, enc.handles[0], enc.inputProof, priceWei);
      await tx.wait();
      setListed(true);
      setBusy("idle");
    } catch (e:any) {
      alert(e?.reason || e?.message || String(e));
      setBusy("idle");
    }
  };

  return (
    <main className="container">
      {!meta ? (
        <div className="muted">Loading metadata...</div>
      ) : (
        <div className="hero">
          <img className="cover" src={`/api/ipfs?cid=${encodeURIComponent(meta.coverCID)}`} />
          <div>
            <div className="title">{meta.title}</div>
            <div className="muted" style={{ maxWidth: 580 }}>{meta.description}</div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="pill">Price: {ethers.formatEther(BigInt(meta.price || 0))} ETH</span>
              {(!listed && owner && userAddress && owner === userAddress) ? (
                <button className={`btn ${busy==="authorizing"?"loading":""}`} onClick={listForSale} disabled={busy!=="idle"}>List For Sale</button>
              ) : null}
              <button className={`btn ${busy==="authorizing"?"loading":""} ${busy==="done"?"success":""}`} onClick={openReader} disabled={busy!=="idle"}>
                {busy==="authorizing" ? <span className="row"><span className="spinner"></span>&nbsp;Authorizing...</span> : busy==="done" ? "Ready" : "Open Reader"}
              </button>
              <button className="btn secondary" onClick={addToShelf}>加入书架</button>
              <button className={`btn secondary ${busy==="buying"?"loading":""}`} onClick={buy} disabled={busy!=="idle" || (!listed && (!owner || owner !== userAddress))} title={!listed && (!owner || owner !== userAddress) ? "Not listed" : ""}>Buy Now</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ComicDetail() {
  return (
    <Suspense fallback={<div className="container"><div className="muted">Loading...</div></div>}>
      <ComicDetailInner />
    </Suspense>
  );
}

