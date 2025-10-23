"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

async function uploadToIPFS(files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append(f.name, f));
  const res = await fetch("/api/ipfs", { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  const j = await res.json();
  return j.cid as string;
}

export default function Create() {
  const [cover, setCover] = useState<File | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priceEth, setPriceEth] = useState("0");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!window.ethereum) return;
    setBusy(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const n = await provider.getNetwork();
      const info = MiniComicRegistryAddresses[String(Number(n.chainId)) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
      const reg = new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);

      // 1) 上传封面/页到 IPFS
      const coverCid = cover ? await uploadToIPFS([cover]) : "";
      const pageCids: string[] = [];
      if (pages.length) {
        for (const p of pages) {
          const cid = await uploadToIPFS([p]);
          pageCids.push(cid);
        }
      }

      // 2) 生成 metadata 并上传
      const metadata = {
        title,
        description: desc,
        coverCID: coverCid,
        pages: pageCids,
        payModel: (Number(priceEth) || 0) > 0 ? "payPerChapter" : "free",
        price: ethers.parseUnits(String(priceEth || "0"), "ether").toString(),
        royaltyPercent: 0,
      };
      const blob = new Blob([JSON.stringify(metadata)], { type: "application/json" });
      const metadataCid = await uploadToIPFS([new File([blob], "metadata.json")]);
      const metadataURI = `ipfs://${metadataCid}`;

      // 3) FHE 输入（price、royalty）+ 调用 mint
      let instance: any = null;
      if (Number(n.chainId) === 31337) {
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

      const addr = await reg.getAddress();
      const user = await signer.getAddress();
      const priceWei = ethers.parseUnits(String(priceEth || "0"), "ether");
      const buf = instance.createEncryptedInput(addr, user);
      buf.add64(priceWei);
      const enc = await buf.encrypt();

      const buf2 = instance.createEncryptedInput(addr, user);
      buf2.add32(0);
      const enc2 = await buf2.encrypt();

      const tx = await reg.mintComic(
        metadataURI,
        enc.handles[0], enc.inputProof,
        enc2.handles[0], enc2.inputProof,
        1,
        priceWei,
        0
      );
      await tx.wait();
      alert("Mint success");
    } catch (e: any) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <div className="hero">
        <div>
          <div className="title">Create a new micro‑comic</div>
          <div className="muted">Upload cover and pages, generate metadata, mint on Sepolia.</div>
        </div>
      </div>
      <div className="grid">
        <div className="card">
          <div className="muted">Title</div>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Comic" />
          <div className="muted" style={{ marginTop: 10 }}>Description</div>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short summary" />
          <div className="row" style={{ marginTop: 10 }}>
            <div className="muted">Price (ETH)</div>
            <input className="input" style={{ maxWidth: 220 }} type="text" value={priceEth} onChange={(e) => setPriceEth(e.target.value)} placeholder="0.0001" />
          </div>
        </div>
        <div className="card">
          <div className="muted">Cover</div>
          <input type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] || null)} />
          {cover ? <img className="cover" src={URL.createObjectURL(cover)} /> : null}
        </div>
        <div className="card">
          <div className="muted">Pages</div>
          <input type="file" accept="image/*" multiple onChange={(e) => setPages(Array.from(e.target.files || []))} />
          <div className="muted" style={{ marginTop: 8 }}>{pages.length} page(s) selected</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy} onClick={onSubmit}>{busy ? "Minting..." : "Upload & Mint"}</button>
        <a className="btn secondary" href="/">Back</a>
      </div>
    </main>
  );
}


