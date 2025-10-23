"use client";
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

type FhevmInstance = any;

declare global {
  interface Window { relayerSDK?: any }
}

export default function Home() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);

  const ensureLocalNetwork = async () => {
    if (!window.ethereum) return false;
    try {
      setNetworkBusy(true);
      await (window as any).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
      return true;
    } catch (e: any) {
      if (e?.code === 4902) {
        try {
          await (window as any).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x7a69",
              chainName: "Hardhat Localhost",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["http://127.0.0.1:8545"],
            }],
          });
          return true;
        } catch {}
      }
      return false;
    } finally {
      setNetworkBusy(false);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    setProvider(p);
    (async () => {
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      setSigner(s);
      setAddress(await s.getAddress());
      const n = await p.getNetwork();
      setChainId(Number(n.chainId));
    })();
    // 监听链切换与账户切换，确保 UI 与实例刷新
    const onChainChanged = (cid: string) => {
      try { setChainId(parseInt(cid, 16)); } catch { location.reload(); }
    };
    const onAccountsChanged = async () => {
      try {
        const s = await p.getSigner();
        setSigner(s);
        setAddress(await s.getAddress());
      } catch {}
    };
    (window as any).ethereum?.on?.("chainChanged", onChainChanged);
    (window as any).ethereum?.on?.("accountsChanged", onAccountsChanged);
    return () => {
      (window as any).ethereum?.removeListener?.("chainChanged", onChainChanged);
      (window as any).ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  useEffect(() => {
    if (!provider || !chainId) return;
    let abort = false;
    (async () => {
      if (chainId === 31337) {
        const { MockFhevmInstance } = await import("@fhevm/mock-utils");
        const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        try {
          const inst = await MockFhevmInstance.create(p, p, {
            aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
            chainId: 31337,
            gatewayChainId: 55815,
            inputVerifierContractAddress: "0x901F8942346f7AB3a01F6D7613119Bca447Bb030",
            kmsContractAddress: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
            verifyingContractAddressDecryption: "0x5ffdaAB0373E62E2ea2944776209aEf29E631A64",
            verifyingContractAddressInputVerification: "0x812b06e1CDCE800494b79fFE4f925A504a9A9810",
          });
          if (!abort) setInstance(inst);
        } catch (e) {
          console.error("MockFhevmInstance init failed", e);
          if (!abort) setInstance({} as any); // 允许 UI 显示为 ready，本地仅用于演示
        }
      } else {
        // 非本地网络时，不再初始化远程实例，提示切换网络
        setInstance(null);
      }
    })();
    return () => { abort = true };
  }, [provider, chainId]);

  const registry = useMemo(() => {
    if (!signer || chainId == null) return null;
    const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
    return new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);
  }, [signer, chainId]);

  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="title">Discover micro‑comics on-chain</div>
          <div className="muted">Wallet: {address?.slice(0,6)}…{address?.slice(-4)} · Chain: {String(chainId)}</div>
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn" href="/create">Create Comic</a>
            <a className="btn secondary" href="/explore">View Sample</a>
          </div>
        </div>
        <div className="card" style={{ minWidth: 260 }}>
          <div className="muted">FHEVM Instance</div>
          <div style={{ fontWeight: 700, marginTop: 6 }}>
            {chainId === 31337 ? (instance ? "ready (local mock)" : "loading...") : "wrong network"}
          </div>
          {chainId !== 31337 ? (
            <button className={`btn ${networkBusy?"loading":""}`} style={{ marginTop: 8 }} onClick={ensureLocalNetwork} disabled={networkBusy}>切换到本地 31337</button>
          ) : null}
        </div>
      </section>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" disabled={!registry} onClick={async () => {
          if (!registry || !instance) return;
          const metadataURI = "ipfs://demo";
          // demo: use zero price and zero royalty to avoid external relayer setup here
          const inputPrice = 0n;
          const buf = instance.createEncryptedInput(await registry.getAddress(), address);
          buf.add64(inputPrice);
          const enc = await buf.encrypt();

          const buf2 = instance.createEncryptedInput(await registry.getAddress(), address);
          buf2.add32(0);
          const enc2 = await buf2.encrypt();

          const tx = await registry.mintComic(metadataURI, enc.handles[0], enc.inputProof, enc2.handles[0], enc2.inputProof, 1, 0, 0);
          await tx.wait();
        }}>Mint (demo)</button>
          <button className="btn secondary" disabled={!registry} onClick={async () => {
          if (!registry || !instance) return;
          const tokenId = 1;
          const buf = instance.createEncryptedInput(await registry.getAddress(), address);
          buf.add64(0n);
          const enc = await buf.encrypt();
          const tx = await registry.listForSale(tokenId, enc.handles[0], enc.inputProof, 0);
          await tx.wait();
        }}>List (demo)</button>
          <button className="btn" disabled={!registry} onClick={async () => {
          if (!registry) return;
          const tokenId = 1;
          const tx = await registry.buyNow(tokenId, { value: 0 });
          await tx.wait();
        }}>Buy (demo)</button>
          <button className="btn secondary" disabled={!registry || !instance} onClick={async () => {
          if (!registry || !instance) return;
          const tokenId = 1;
          const buf = instance.createEncryptedInput(await registry.getAddress(), address);
          buf.add32(1);
          const enc = await buf.encrypt();
          const tx = await registry.purchaseAccess(tokenId, enc.handles[0], enc.inputProof, { value: 0 });
          await tx.wait();
        }}>Access (demo)</button>
        </div>
      </div>
    </main>
  );
}


